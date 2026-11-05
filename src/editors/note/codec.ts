import { decode, encode } from '@/domain/codec';

// Contrato de la nota (plan · «Contratos»). El carril B puede añadir helpers, no cambiar esta forma.
export interface NoteContent {
  schemaVersion: 1;
  elements: readonly unknown[];
  appState: { viewBackgroundColor?: string };
  files: Record<string, { mimeType: string; created: number }>;
}

export const emptyNote = (): NoteContent => ({ schemaVersion: 1, elements: [], appState: {}, files: {} });

export type NoteFiles = NoteContent['files'];

/** Lo mínimo que se lee de un elemento de Excalidraw (así el codec no depende del motor). */
export interface SceneElementLike {
  type: string;
  isDeleted?: boolean;
  fileId?: string | null;
  /** Marca de tiempo de la última modificación (Excalidraw). */
  updated?: number;
}

/** Un elemento borrado se conserva un minuto como tombstone: así el borrado llega a quien edita a la vez. */
export const TOMBSTONE_TTL_MS = 60_000;

/** Ids de archivo que usan las imágenes vivas de la escena. */
export function referencedFileIds(elements: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const e of elements as readonly SceneElementLike[]) {
    if (e.type === 'image' && !e.isDeleted && e.fileId) ids.add(e.fileId);
  }
  return [...ids];
}

/**
 * Escena → contenido persistible. Sin borrados ni estado de interfaz (selección, scroll…): solo el
 * color de fondo. `files` conserva únicamente lo que una imagen viva referencia.
 */
export function buildNoteContent(
  elements: readonly unknown[],
  appState: { viewBackgroundColor?: string },
  known: NoteFiles,
  now = Date.now(),
): NoteContent {
  const all = elements as readonly SceneElementLike[];
  const live = all.filter((e) => !e.isDeleted);
  const kept = all.filter((e) => !e.isDeleted || (typeof e.updated === 'number' && now - e.updated <= TOMBSTONE_TTL_MS));
  const files: NoteFiles = {};
  for (const id of referencedFileIds(live)) {
    const meta = known[id];
    if (meta) files[id] = { mimeType: meta.mimeType, created: meta.created };
  }
  const bg = appState.viewBackgroundColor;
  return { schemaVersion: 1, elements: kept, appState: bg ? { viewBackgroundColor: bg } : {}, files };
}

export const encodeNote = (c: NoteContent): string => encode(c);

/** String guardado → contenido. Lanza si no es una nota válida (contenido dañado o de otro tipo). */
export function decodeNote(data: string): NoteContent {
  const raw = decode<Partial<NoteContent> | null>(data);
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 1 || !Array.isArray(raw.elements)) {
    throw new Error('El contenido no es una nota válida.');
  }
  const files: NoteFiles = {};
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
