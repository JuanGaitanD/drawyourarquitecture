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

/**
 * Un elemento borrado se conserva 30 días (Excalidraw usa `isDeleted` como tombstone): así el borrado llega a quien
 * edita a la vez o vuelve de estar sin conexión. Decisión (D18): purgar por `revision` solo sería correcto si la
 * revisión del borrado fuera ≤ la base confirmada de **todos** los clientes posibles, y eso no se puede demostrar sin
 * registrar la base de cada cliente (miembros que pueden estar desconectados indefinidamente, sin sesión que lo
 * anuncie). Sin ese estado, el tiempo es la cota segura. ponytail: pasados 30 días un cliente que nunca volvió puede
 * resucitar un borrado; si se llevara la base confirmada por miembro, purgar por `revision` en vez de por tiempo.
 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60_000;

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

/** Unión de los archivos de dos versiones de la nota por `fileId` (en un choque manda `local`). */
export const unionFiles = (local: NoteFiles, remote: NoteFiles): NoteFiles => ({ ...remote, ...local });

type Versioned = { id?: string; version?: number; versionNonce?: number };

/** Igualdad semántica de dos notas codificadas: mismos elementos (id, versión) y mismos archivos. */
export function noteSame(a: string, b: string): boolean {
  try {
    const sig = (d: string) => {
      const n = decodeNote(d);
      return JSON.stringify([
        (n.elements as Versioned[]).map((e) => `${e.id}:${e.version}:${e.versionNonce}`).sort(),
        Object.keys(n.files).sort(),
        n.appState.viewBackgroundColor ?? '',
      ]);
    };
    return sig(a) === sig(b);
  } catch {
    return false;
  }
}

const WHITE = '#ffffff';
/**
 * Fondo tras fusionar sin base: si el local cambió desde lo último que se supo del servidor (`known`), gana el
 * local (el cambio propio pendiente no se pisa); si no, se toma el remoto.
 */
export function pickBackground(local?: string, known?: string, remote?: string): string {
  const l = local ?? WHITE;
  return l !== (known ?? WHITE) ? l : (remote ?? WHITE);
}
