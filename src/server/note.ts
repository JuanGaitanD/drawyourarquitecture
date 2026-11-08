import { decode, encode } from '../domain/codec';

// Contenido de nota en el servidor. Misma forma que `editors/note/codec.ts` (un test lo comprueba), pero
// sin importar el alias `@/` ni el motor: el servidor se empaqueta aparte (scripts/bundle-mcp.mjs).
// `convertToExcalidrawElements` no corre en Node: aquí se generan elementos `text` mínimos válidos;
// al abrir la nota, Excalidraw los completa con `restoreElements` (índices, versiones).

export interface NoteContent {
  schemaVersion: 1;
  elements: Record<string, unknown>[];
  appState: { viewBackgroundColor?: string };
  files: Record<string, { mimeType: string; created: number }>;
}

export const MAX_NOTE_TEXT = 200_000;
export const MAX_NOTE_BLOCKS = 2000;

const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;
const GAP = 24;
/** Ancho medio de un carácter, en proporción al cuerpo (aprox. para Excalifont/Helvetica). */
const CHAR_W = 0.6;
const HEADING_SIZE: Record<number, number> = { 1: 36, 2: 28, 3: 24 };

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Claves fraccionarias ordenadas (formato de fractional-indexing): a0…az, b00…bzz. Soporta < 3906 bloques. */
export function orderKey(i: number): string {
  if (i < 62) return 'a' + B62[i];
  const j = i - 62;
  return 'b' + B62[Math.floor(j / 62)] + B62[j % 62];
}

const rand = () => Math.floor(Math.random() * 2 ** 31);
const textId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 21);

export function emptyNote(): NoteContent {
  return { schemaVersion: 1, elements: [], appState: {}, files: {} };
}

/** Texto en bloques (separados por línea en blanco) → elementos `text` apilados. `# `…`### ` agranda el cuerpo. */
export function textToElements(text: string, now = Date.now()): Record<string, unknown>[] {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length > MAX_NOTE_BLOCKS)
    throw new RangeError(`Demasiados bloques de texto (máximo ${MAX_NOTE_BLOCKS}).`);
  let y = 0;
  return blocks.map((raw, i) => {
    const h = /^(#{1,3})\s+(.*)$/s.exec(raw);
    const body = h ? h[2] : raw;
    const fontSize = h ? HEADING_SIZE[h[1].length] : FONT_SIZE;
    const lines = body.split('\n');
    const width = Math.ceil(Math.max(...lines.map((l) => l.length), 1) * fontSize * CHAR_W);
    const height = Math.ceil(lines.length * fontSize * LINE_HEIGHT);
    const el = {
      id: textId(),
      type: 'text',
      x: 0,
      y,
      width,
      height,
      angle: 0,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: orderKey(i),
      roundness: null,
      seed: rand(),
      version: 1,
      versionNonce: rand(),
      isDeleted: false,
      boundElements: null,
      updated: now,
      link: null,
      locked: false,
      text: body,
      fontSize,
      fontFamily: 5,
      textAlign: 'left',
      verticalAlign: 'top',
      containerId: null,
      originalText: body,
      autoResize: true,
      lineHeight: LINE_HEIGHT,
    };
    y += height + GAP;
    return el;
  });
}

export function buildNote(text: string, now?: number): NoteContent {
  return { ...emptyNote(), elements: textToElements(text, now) };
}

export const encodeNote = (c: NoteContent): string => encode(c);

/** String guardado → nota. Lanza si el contenido no es una nota válida. */
export function decodeNote(data: string): NoteContent {
  const raw = decode<Partial<NoteContent> | null>(data);
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1 || !Array.isArray(raw.elements)) {
    throw new Error('El contenido no es una nota válida.');
  }
  const files: NoteContent['files'] = {};
  for (const [id, meta] of Object.entries(raw.files ?? {})) {
    if (meta && typeof meta.mimeType === 'string') {
      files[id] = { mimeType: meta.mimeType, created: Number(meta.created) || 0 };
    }
  }
  const bg = raw.appState?.viewBackgroundColor;
  return {
    schemaVersion: 1,
    elements: raw.elements,
    appState: typeof bg === 'string' ? { viewBackgroundColor: bg } : {},
    files,
  };
}

/** Texto de los elementos vivos en orden de lectura (por filas de arriba abajo, y de izquierda a derecha). */
export function noteText(elements: readonly Record<string, unknown>[]): string {
  return elements
    .filter((e) => e.type === 'text' && e.isDeleted !== true && typeof e.text === 'string' && e.text !== '')
    .map((e) => ({ t: e.text as string, x: Number(e.x) || 0, row: Math.round((Number(e.y) || 0) / 20) }))
    .sort((a, b) => a.row - b.row || a.x - b.x)
    .map((e) => e.t)
    .join('\n\n');
}

/** Resumen para el modelo: cuántos elementos vivos hay de cada tipo. */
export function noteSummary(elements: readonly Record<string, unknown>[]): {
  total: number;
  byType: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const e of elements) {
    if (e.isDeleted === true) continue;
    total++;
    const t = typeof e.type === 'string' ? e.type : 'desconocido';
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return { total, byType };
}

export interface NoteImage {
  fileId: string;
  /** Tipo MIME según `files` de la nota; `null` si la nota no lo declara. */
  mimeType: string | null;
}

/** Imágenes vivas (por `fileId`, sin repetir). El binario vive en `projects/{id}/files/{fileId}`. */
export function noteImages(note: Pick<NoteContent, 'elements' | 'files'>): NoteImage[] {
  const seen = new Set<string>();
  const out: NoteImage[] = [];
  for (const e of note.elements) {
    if (e.type !== 'image' || e.isDeleted === true || typeof e.fileId !== 'string' || seen.has(e.fileId))
      continue;
    seen.add(e.fileId);
    out.push({ fileId: e.fileId, mimeType: note.files[e.fileId]?.mimeType ?? null });
  }
  return out;
}

/** `/embed/board/<id>` (misma forma que `editors/note/embed.ts`; el origen no importa: el acceso lo deciden las reglas). */
const BOARD_PATH = /^\/embed\/board\/([\w-]+)\/?$/;

/** Ids de los diagramas incrustados vivos (elementos `embeddable` con enlace a `/embed/board/<id>`), sin repetir. */
export function noteEmbeds(elements: readonly Record<string, unknown>[]): string[] {
  const ids = new Set<string>();
  for (const e of elements) {
    if (e.type !== 'embeddable' || e.isDeleted === true || typeof e.link !== 'string') continue;
    try {
      const u = new URL(e.link);
      const m = BOARD_PATH.exec(u.pathname);
      if (m && !u.search && !u.hash) ids.add(m[1]);
    } catch {
      /* enlace vacío o relativo */
    }
  }
  return [...ids];
}
