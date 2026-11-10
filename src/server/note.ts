import { decode, encode } from '../domain/codec';
import {
  EMBED_SIZE,
  SITE_ORIGINS,
  boardEmbedLink,
  newEmbeddable,
  parseBoardLink,
} from '../editors/note/embed';

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
    width: Math.ceil(Math.max(...lines.map((l) => graphemes(l).length), 1) * fontSize * CHAR_W),
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
      // Se cuenta por grafemas (un emoji no se parte); una línea que cabe queda tal cual, con su sangría.
      if (graphemes(line).length <= max) return line;
      const indent = line.length - line.trimStart().length;
      const words = line
        .slice(indent)
        .split(' ')
        .flatMap((word) => {
          const g = graphemes(word);
          const parts: string[][] = [];
          for (let i = 0; i < g.length; i += max) parts.push(g.slice(i, i + max));
          return parts.length ? parts : [[]];
        });
      const out: string[] = [];
      let cur = graphemes(line.slice(0, indent));
      words.forEach((w, i) => {
        if (i === 0) cur.push(...w);
        else if (cur.length + 1 + w.length <= max) cur.push(' ', ...w);
        else {
          out.push(cur.join(''));
          cur = [...w];
        }
      });
      out.push(cur.join(''));
      return out.join('\n');
    })
    .join('\n');
}

const segmenter = new Intl.Segmenter();
const graphemes = (s: string): string[] => Array.from(segmenter.segment(s), (x) => x.segment);

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
      // Etiqueta de forma: se ajusta al ancho del contenedor y se centra en él. El contenedor no se toca: agrandarlo
      // dejaría sus flechas conectadas en la geometría anterior. ponytail: si no cabe en alto, desborda hasta que
      // Excalidraw lo ajusta al editar la etiqueta; en elipses y rombos se usa el ancho útil del rectángulo.
      const wrapped = wrap(body, size, num(container.width) - 2 * BOUND_PADDING);
      const box = measure(wrapped, size);
      const ch = num(container.height);
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
  const elements = note.elements.map((e) => changed.get(e) ?? e);
  const { left, bottom, nextIndex } = appendAt(elements);
  const added = extra.map((b, i) => ({
    ...b,
    x: left,
    y: bottom + (b.y as number) - (extra[0].y as number),
    index: nextIndex(i),
  }));
  return { ...note, elements: [...elements, ...added] };
}

/**
 * Dónde se añade algo al final: debajo de todo lo vivo, alineado con el texto más a la izquierda, con índices
 * fraccionarios después del mayor existente (un sufijo que no acaba en «0» deja una clave válida).
 */
function appendAt(elements: readonly Record<string, unknown>[]) {
  const live = elements.filter((e) => e.isDeleted !== true);
  const texts = readingOrder(elements);
  const maxIndex = elements.reduce<string>(
    (m, e) => (typeof e.index === 'string' && e.index > m ? e.index : m),
    '',
  );
  return {
    left: texts.length ? Math.min(...texts.map((e) => Number(e.x) || 0)) : 0,
    bottom: live.length
      ? Math.max(...live.map((e) => (Number(e.y) || 0) + (Number(e.height) || 0))) + GAP
      : 0,
    nextIndex: (i: number) => `${maxIndex}${orderKey(i)}V`,
  };
}

/** Origen con el que el servidor escribe los enlaces de los diagramas incrustados (lo acepta `parseBoardLink`). */
const EMBED_ORIGIN = SITE_ORIGINS[0];

/** ¿La nota ya tiene incrustado ese diagrama? Misma política que la interfaz (`parseBoardLink`). */
export function hasBoardEmbed(note: NoteContent, boardId: string): boolean {
  return note.elements.some(
    (e) =>
      e.type === 'embeddable' &&
      e.isDeleted !== true &&
      typeof e.link === 'string' &&
      parseBoardLink(e.link, EMBED_ORIGIN) === boardId,
  );
}

/** Lo que baja el contenido al hacer hueco: el alto del embed más tres filas de 20 (múltiplo de 20: ver `readingOrder`). */
export const EMBED_SHIFT = EMBED_SIZE.height + 60;

type El = Record<string, unknown>;
const num = (v: unknown) => Number(v) || 0;

/**
 * Caja en la escena: con los puntos de las flechas y líneas, y girada si tiene `angle` (giro sobre su centro).
 * ponytail: una flecha o línea curva puede salirse un poco de sus puntos; calcular los extremos de la Bézier si eso
 * llega a tapar algo.
 */
function bbox(e: El): { x: number; y: number; w: number; h: number } {
  let x = num(e.x);
  let y = num(e.y);
  let w = num(e.width);
  let h = num(e.height);
  if (Array.isArray(e.points) && e.points.length > 0) {
    const xs = (e.points as number[][]).map((p) => num(p[0]));
    const ys = (e.points as number[][]).map((p) => num(p[1]));
    x += Math.min(...xs);
    y += Math.min(...ys);
    w = Math.max(...xs) - Math.min(...xs);
    h = Math.max(...ys) - Math.min(...ys);
  }
  const a = num(e.angle);
  if (!a) return { x, y, w, h };
  const [c, s] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))];
  const [W, H] = [w * c + h * s, w * s + h * c];
  return { x: x + w / 2 - W / 2, y: y + h / 2 - H / 2, w: W, h: H };
}

function overlaps(p: El, q: El): boolean {
  const [a, b] = [bbox(p), bbox(q)];
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Incrusta el diagrama `boardId` con el mismo elemento que «Insertar diagrama» de la app (`newEmbeddable`). Sin
 * `after`, debajo de todo. Con `after`, debajo del único bloque de texto que empieza por él (como lo da `read_note`),
 * y lo de debajo baja `EMBED_SHIFT` por unidades (un hijo con su marco, una etiqueta con su forma). Lanza `RangeError`
 * si el bloque no existe, es ambiguo o está en un marco, y si el hueco taparía algo o cambiaría el orden de lectura.
 * ponytail: se desplaza por `y`; una columna paralela también baja y una flecha de arriba a abajo queda suelta de
 * su destino hasta que se edita en la app. Mover esas flechas si molesta.
 */
export function embedInNote(
  note: NoteContent,
  boardId: string,
  after: string | undefined,
  now = Date.now(),
): NoteContent {
  const { left, bottom, nextIndex } = appendAt(note.elements);
  const embed = (pos: { x: number; y: number }): El => ({
    ...newEmbeddable(pos, boardEmbedLink(boardId, EMBED_ORIGIN)),
    index: nextIndex(0),
    updated: now,
  });
  if (after === undefined) return { ...note, elements: [...note.elements, embed({ x: left, y: bottom })] };

  const prefix = after.trim();
  const texts = readingOrder(note.elements);
  const hits = prefix ? texts.filter((t) => (t.text as string).trim().startsWith(prefix)) : [];
  if (hits.length === 0) throw new RangeError(`No hay ningún bloque que empiece por «${prefix}».`);
  if (hits.length > 1)
    throw new RangeError(`Hay ${hits.length} bloques que empiezan por «${prefix}»: da más texto del bloque.`);

  const byId = new Map(note.elements.map((e) => [e.id, e]));
  /** Unidad que se mueve junta: el marco del elemento, si no su contenedor (etiquetas), si no él mismo. */
  const root = (e: El): El => {
    const box = (e.containerId != null && byId.get(e.containerId)) || e;
    return (box.frameId != null && byId.get(box.frameId)) || box;
  };
  const anchor = (hits[0].containerId != null && byId.get(hits[0].containerId)) || hits[0];
  if (root(anchor) !== anchor)
    throw new RangeError('El bloque está dentro de un marco: usa otro bloque o sin `after`.');

  // El ancla y su etiqueta no se mueven nunca (una flecha horizontal mide 0 de alto); el embed va debajo de las dos.
  const bottomOf = (e: El) => bbox(e).y + bbox(e).h;
  const line = Math.max(bottomOf(anchor), bottomOf(hits[0]));
  const elements = note.elements.map((e): El => {
    if (e.isDeleted === true || root(e) === anchor || bbox(root(e)).y < line) return e;
    const next = {
      ...e,
      y: num(e.y) + EMBED_SHIFT,
      version: num(e.version) + 1,
      versionNonce: rand(),
      updated: now,
    };
    return next;
  });
  const added = embed({ x: bbox(anchor).x, y: line + GAP });
  // Contra todo lo vivo ya desplazado: lo que no se movió y lo que, aun bajando, seguiría invadiéndolo.
  const blocked = elements.some((e) => e.isDeleted !== true && overlaps(e, added));
  const order = (els: readonly El[]) =>
    readingOrder(els)
      .map((e) => e.id)
      .join(' ');
  if (blocked || order(elements) !== order(note.elements))
    throw new RangeError('No hay sitio limpio debajo de ese bloque: usa otro bloque o sin `after`.');
  return { ...note, elements: [...elements, added] };
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
