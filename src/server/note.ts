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

/** Caja aproximada de un texto (Excalidraw la recalcula al abrir, con `autoResize`). */
function measure(body: string, fontSize: number): { width: number; height: number } {
  const lines = body.split('\n');
  return {
    width: Math.ceil(Math.max(...lines.map((l) => l.length), 1) * fontSize * CHAR_W),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
}

/** Margen interior de una etiqueta en su contenedor (`BOUND_TEXT_PADDING` de Excalidraw). */
const BOUND_PADDING = 5;

/** Ajusta cada línea a `maxWidth` por palabras (aprox. con `CHAR_W`); corta las palabras que no caben. */
function wrap(body: string, fontSize: number, maxWidth: number): string {
  const max = Math.max(1, Math.floor(maxWidth / (fontSize * CHAR_W)));
  return body
    .split('\n')
    .map((line) => {
      const out: string[] = [];
      let cur = '';
      for (let w of line.split(' ')) {
        while (w.length > max) {
          if (cur) out.push(cur);
          cur = '';
          out.push(w.slice(0, max));
          w = w.slice(max);
        }
        if (!cur) cur = w;
        else if (cur.length + 1 + w.length <= max) cur += ` ${w}`;
        else {
          out.push(cur);
          cur = w;
        }
      }
      out.push(cur);
      return out.join('\n');
    })
    .join('\n');
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
    const { width, height } = measure(body, fontSize);
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
  return readingOrder(elements)
    .map((e) => e.text as string)
    .join('\n\n');
}

/** Elementos `text` vivos y no vacíos en orden de lectura. */
function readingOrder(elements: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const row = (e: Record<string, unknown>) => Math.round((Number(e.y) || 0) / 20);
  return elements
    .filter((e) => e.type === 'text' && e.isDeleted !== true && typeof e.text === 'string' && e.text !== '')
    .sort((a, b) => row(a) - row(b) || (Number(a.x) || 0) - (Number(b.x) || 0));
}

/**
 * Reemplaza el texto de la nota y conserva lo demás. Los textos vivos (en el orden de `noteText`) se emparejan por
 * posición con los bloques nuevos: igual → intacto; distinto → se edita en su sitio (posición, estilo, contenedor);
 * de más → se apilan debajo de todo; los que sobran → borrados (tombstone, como hace Excalidraw). Imágenes, diagramas
 * incrustados, formas y `files` no se tocan. ponytail: empareja por posición; insertar un bloque en medio corre el
 * texto de los siguientes un hueco (el orden de lectura no cambia). Un diff por contenido si eso molesta.
 */
export function replaceNoteText(note: NoteContent, text: string, now = Date.now()): NoteContent {
  const blocks = textToElements(text, now);
  const old = readingOrder(note.elements);
  const bump = (e: Record<string, unknown>, over: Record<string, unknown>) => ({
    ...e,
    ...over,
    version: (Number(e.version) || 1) + 1,
    versionNonce: rand(),
    updated: now,
  });
  const changed = new Map<Record<string, unknown>, Record<string, unknown>>();
  const num = (v: unknown) => Number(v) || 0;
  old.forEach((e, i) => {
    const b = blocks[i];
    if (!b) return void changed.set(e, bump(e, { isDeleted: true }));
    const body = b.text as string;
    // Sin «# » el bloque sale con el cuerpo normal: se respeta el tamaño que ya tenía.
    const fontSize = b.fontSize === FONT_SIZE ? e.fontSize : b.fontSize;
    // `read_note` devuelve `text` (ya ajustado en líneas); el original sin ajustar es `originalText`.
    if ((body === e.text || body === e.originalText) && fontSize === e.fontSize) return;
    const size = Number(fontSize) || FONT_SIZE;
    const container =
      e.containerId == null
        ? undefined
        : note.elements.find((c) => c.id === e.containerId && c.isDeleted !== true);
    let geometry: Record<string, unknown>;
    if (container && container.type !== 'arrow') {
      // Etiqueta de forma: se ajusta al ancho del contenedor y se centra; si no cabe, el contenedor crece en alto.
      // ponytail: ancho útil de rectángulo también en elipses y rombos (Excalidraw lo afina al editar la etiqueta).
      const wrapped = wrap(body, size, num(container.width) - 2 * BOUND_PADDING);
      const box = measure(wrapped, size);
      const ch = Math.max(num(container.height), box.height + 2 * BOUND_PADDING);
      if (ch !== num(container.height)) changed.set(container, bump(container, { height: ch }));
      const y =
        e.verticalAlign === 'top'
          ? num(container.y) + BOUND_PADDING
          : e.verticalAlign === 'bottom'
            ? num(container.y) + ch - BOUND_PADDING - box.height
            : num(container.y) + (ch - box.height) / 2;
      geometry = { text: wrapped, ...box, x: num(container.x) + (num(container.width) - box.width) / 2, y };
    } else if (container) {
      // Etiqueta de flecha: mismo centro (Excalidraw la recoloca en el punto medio de la flecha).
      const box = measure(body, size);
      const cx = num(e.x) + num(e.width) / 2;
      const cy = num(e.y) + num(e.height) / 2;
      geometry = { text: body, ...box, x: cx - box.width / 2, y: cy - box.height / 2 };
    } else if (e.autoResize === false) {
      // Ancho fijado por la persona: se conserva y el texto se ajusta a él.
      const wrapped = wrap(body, size, num(e.width));
      geometry = { text: wrapped, height: measure(wrapped, size).height };
    } else {
      geometry = { text: body, ...measure(body, size) };
    }
    changed.set(e, bump(e, { ...geometry, originalText: body, fontSize }));
  });
  const extra = blocks.slice(old.length);
  // Lo añadido va debajo de todo, medido ya con los textos editados (pueden haber crecido).
  const live = note.elements.map((e) => changed.get(e) ?? e).filter((e) => e.isDeleted !== true);
  const left = old.length ? Math.min(...old.map((e) => Number(e.x) || 0)) : 0;
  const bottom = live.length
    ? Math.max(...live.map((e) => (Number(e.y) || 0) + (Number(e.height) || 0))) + GAP
    : 0;
  // Índices fraccionarios después del mayor existente (un sufijo que no acaba en «0» deja una clave válida).
  const maxIndex = note.elements.reduce<string>(
    (m, e) => (typeof e.index === 'string' && e.index > m ? e.index : m),
    '',
  );
  const added = extra.map((b, i) => ({
    ...b,
    x: left,
    y: bottom + (b.y as number) - (extra[0].y as number),
    index: `${maxIndex}${orderKey(i)}V`,
  }));
  return { ...note, elements: [...note.elements.map((e) => changed.get(e) ?? e), ...added] };
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
