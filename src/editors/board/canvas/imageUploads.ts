import type { PendingFile, PendingStore } from '@/application/pendingFiles';
import type { FileStore } from '@/application/ports';
import { createUploadQueue, type UploadQueue } from '@/editors/note/files';
import { makeNode } from '../model/board';
import type { ImageMeta } from '../nodes/files';
import type { BoardStore } from '../store/boardStore';

// Imágenes del board con la cola de la nota (D23): el binario se copia a IndexedDB antes de subirse y el nodo entra
// en el diagrama cuando la subida se confirma, así que el contenido guardado nunca apunta a un archivo que no
// existe. Si los reintentos se agotan o se cierra la pestaña, el binario sigue en disco: al recuperar la conexión
// (`retryFailed`) o al volver a montar el editor (`resume`) se repone y se sube, y entonces aparece el nodo.
// La copia en disco se borra cuando el contenido con el nodo ya se guardó (`saved`).

const FALLBACK: ImageMeta = { x: 0, y: 0, width: 240, height: 160, label: '' };
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Lo que vuelve de IndexedDB es entrada externa: se normaliza. */
function readMeta(raw: unknown): ImageMeta {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Partial<ImageMeta>;
  return {
    x: num(m.x, FALLBACK.x),
    y: num(m.y, FALLBACK.y),
    width: num(m.width, FALLBACK.width),
    height: num(m.height, FALLBACK.height),
    label: typeof m.label === 'string' ? m.label : '',
  };
}

export interface ImageUploadsOptions {
  store: BoardStore;
  files: Pick<FileStore, 'upload'>;
  projectId: string;
  persist: PendingStore | null;
  /** El contenido cargado ya referencia este archivo: su binario está en el servidor y solo se limpia el disco. */
  published: (fileId: string) => boolean;
  onFail: (fileId: string, error: Error) => void;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface ImageUploads {
  add(fileId: string, blob: Blob, meta: ImageMeta): void;
  /** Al montar: sube lo que quedó pendiente en disco. */
  resume(): Promise<void>;
  retryFailed(): void;
  /** Tras guardar `data` en el servidor: libera las copias en disco de las imágenes que ya van en él (o se borraron). */
  saved(data: string): void;
  queue: UploadQueue;
}

export function createImageUploads(o: ImageUploadsOptions): ImageUploads {
  const metas = new Map<string, ImageMeta>(); // nodos por insertar al confirmarse la subida
  const awaitingSave = new Set<string>(); // ya insertados, aún sin guardar
  const queue = createUploadQueue({
    store: o.files,
    projectId: o.projectId,
    persist: o.persist,
    onFail: o.onFail,
    delays: o.delays,
    sleep: o.sleep,
  });

  queue.whenDone((fileId) => {
    const m = metas.get(fileId);
    if (!m) return;
    metas.delete(fileId);
    const node = makeNode('image', { x: m.x, y: m.y }, { fileId, label: m.label });
    o.store.getState().insertNode({ ...node, width: m.width, height: m.height }, false);
    awaitingSave.add(fileId);
  });

  return {
    queue,
    add(fileId, blob, meta) {
      metas.set(fileId, meta);
      queue.add(fileId, blob, meta);
    },
    resume: () =>
      queue.resume(o.published, (f: PendingFile) => void metas.set(f.fileId, readMeta(f.meta))),
    retryFailed: () => queue.retryFailed(),
    saved(data) {
      const live = new Set<string>();
      for (const n of o.store.getState().nodes) if (n.data.kind === 'image' && n.data.fileId) live.add(n.data.fileId);
      // Con el nodo en lo guardado, o sin nodo (se borró antes de guardar), la copia en disco ya no hace falta.
      const done = [...awaitingSave].filter((id) => data.includes(id) || !live.has(id));
      done.forEach((id) => awaitingSave.delete(id));
      queue.release(done);
    },
  };
}
