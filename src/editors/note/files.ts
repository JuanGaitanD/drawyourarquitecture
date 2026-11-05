import type { PendingFile, PendingStore } from '@/application/pendingFiles';
import type { FileStore } from '@/application/ports';
import { referencedFileIds, type NoteFiles, type SceneElementLike } from './codec';

// Archivos de la nota (plan · invariante 3): formatos, diff de nuevos y subida en cola. El tope de 4 MiB se
// aplica después de optimizar (`optimizeImage`), no aquí.

export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
/** Esperas antes de cada reintento: 3 reintentos tras el primer intento. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

/** Lo que Excalidraw entrega en `onChange(…, files)` y espera en `addFiles`. */
export interface BinaryLike {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

export type FileRejection = 'formato';

/** `null` si se puede subir; si no, el motivo. */
export function rejectReason(f: Pick<BinaryLike, 'mimeType'>): FileRejection | null {
  return (ALLOWED_MIME as readonly string[]).includes(f.mimeType) ? null : 'formato';
}

/**
 * Archivos de imágenes vivas que Excalidraw conoce y la nota aún no registra: son los que hay que subir.
 * Se reparten en `fresh` (subir) y `rejected` (formato o tamaño no admitidos).
 */
export function diffNewFiles(
  elements: readonly unknown[],
  files: Record<string, BinaryLike | undefined>,
  known: NoteFiles,
): { fresh: BinaryLike[]; rejected: { file: BinaryLike; reason: FileRejection }[] } {
  const fresh: BinaryLike[] = [];
  const rejected: { file: BinaryLike; reason: FileRejection }[] = [];
  for (const id of referencedFileIds(elements as readonly SceneElementLike[])) {
    const file = files[id];
    if (!file || known[id]) continue;
    const reason = rejectReason(file);
    if (reason) rejected.push({ file, reason });
    else fresh.push(file);
  }
  return { fresh, rejected };
}

export async function dataUrlToBlob(dataURL: string): Promise<Blob> {
  return (await fetch(dataURL)).blob();
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(blob);
  });
}

export interface UploadQueueOptions {
  store: Pick<FileStore, 'upload'>;
  projectId: string;
  /** Binarios pendientes en disco (IndexedDB). Sin él la cola solo tiene la memoria de la pestaña. */
  persist?: PendingStore | null;
  /** Se agotaron los reintentos: el binario sigue en la cola (y en disco) y `retryFailed` lo vuelve a intentar. */
  onFail: (fileId: string, error: Error) => void;
  /** La subida se confirmó. El registro en disco se conserva hasta `release` (cuando el contenido ya se guardó). */
  onDone?: (fileId: string) => void;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface UploadQueue {
  /** `meta` se guarda con el binario para reponer la imagen si la pestaña se cierra antes de confirmar. */
  add(id: string, blob: Blob, meta?: unknown): void;
  /**
   * Al volver a cargar: sube lo que quedó pendiente en disco. `restore` se llama con cada registro antes de empezar
   * a subirlo; lo ya publicado (`published`) solo se limpia del disco.
   */
  resume(published: (id: string) => boolean, restore: (file: PendingFile) => void): Promise<void>;
  /** El contenido con estas imágenes ya se guardó en el servidor: se borran de la cola en disco. */
  release(ids: Iterable<string>): void;
  /** Reintenta lo que falló (botón «Reintentar» o vuelta de la conexión). */
  retryFailed(): void;
  /** Subidas que se perderían al cerrar la pestaña: sin terminar y sin copia en disco. */
  pending(): number;
}

/**
 * Cola de subidas: cada archivo se sube a la vez y reintenta 3 veces (1-2-4 s). Con `persist`, cada binario se
 * copia a disco antes de subirse y la copia solo se borra en `release`.
 */
export function createUploadQueue(opts: UploadQueueOptions): UploadQueue {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const store = opts.persist ?? null;
  const blobs = new Map<string, Blob>(); // pendientes: siguen en memoria hasta subirse
  const running = new Set<string>();
  const failed = new Set<string>();
  const onDisk = new Set<string>(); // con copia en disco (ahí se queda hasta `release`)

  async function run(id: string) {
    const blob = blobs.get(id);
    if (!blob || running.has(id)) return;
    running.add(id);
    failed.delete(id);
    let lastError = new Error('La subida falló.');
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        await opts.store.upload(opts.projectId, id, blob);
        blobs.delete(id);
        running.delete(id);
        opts.onDone?.(id);
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < delays.length) await sleep(delays[attempt]);
      }
    }
    running.delete(id);
    failed.add(id);
    opts.onFail(id, lastError);
  }

  return {
    add(id, blob, meta) {
      if (blobs.has(id)) return;
      blobs.set(id, blob);
      if (!store) return void run(id);
      // Primero a disco, luego a subir: así `release` nunca llega antes que el `put`. Si el disco falla se sube igual.
      void store
        .put({ projectId: opts.projectId, fileId: id, blob, meta })
        .then(() => void onDisk.add(id))
        .catch(() => undefined)
        .then(() => run(id));
    },
    async resume(published, restore) {
      if (!store) return;
      const files = await store.list(opts.projectId).catch(() => []);
      for (const f of files) {
        if (published(f.fileId)) {
          void store.remove(opts.projectId, f.fileId).catch(() => undefined);
        } else if (!blobs.has(f.fileId)) {
          blobs.set(f.fileId, f.blob);
          onDisk.add(f.fileId);
          restore(f);
          void run(f.fileId);
        }
      }
    },
    release(ids) {
      for (const id of ids) {
        if (blobs.has(id) || !onDisk.delete(id)) continue; // aún sin subir: la copia en disco sigue siendo la red
        void store?.remove(opts.projectId, id).catch(() => undefined);
      }
    },
    retryFailed() {
      for (const id of [...failed]) void run(id);
    },
    pending: () => [...blobs.keys()].filter((id) => !onDisk.has(id)).length,
  };
}

/**
 * Un colaborador puede recibir el elemento antes de que el autor termine de subir la imagen (optimizar y subir
 * lleva segundos): `attempt` devuelve los ids que no pudo cargar y se reintentan con `delays` antes de darlos
 * por fallidos. Devuelve los que siguen fallando. `alive` corta los reintentos si el lienzo se desmontó.
 */
export async function retryMissing(
  ids: string[],
  attempt: (ids: string[]) => Promise<string[]>,
  delays: readonly number[] = RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  alive: () => boolean = () => true,
): Promise<string[]> {
  let failed = await attempt(ids);
  for (const d of delays) {
    if (!failed.length || !alive()) break;
    await sleep(d);
    if (!alive()) break;
    failed = await attempt(failed);
  }
  return failed;
}
