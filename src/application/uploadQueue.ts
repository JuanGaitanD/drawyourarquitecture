import type { PendingFile, PendingStore } from './pendingFiles';
import type { FileStore } from './ports';

// Cola de subidas de archivos (nota y board): reintentos, copia en disco (IndexedDB, inyectada) y reposición de lo
// pendiente al volver a cargar. Los dos editores la consumen; ninguno importa del otro.

/** Esperas antes de cada reintento: 3 reintentos tras el primer intento. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

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
  /** Avisa de cada subida confirmada (varios oyentes; devuelve la baja). */
  whenDone(cb: (fileId: string) => void): () => void;
  /** Reintenta lo que falló (botón «Reintentar» o vuelta de la conexión). */
  retryFailed(): void;
  /** La imagen se borró antes de guardarse: se olvida del todo (cola, reintentos y copia en disco). */
  discard(ids: Iterable<string>): void;
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
  const listeners = new Set<(id: string) => void>();
  const onDisk = new Set<string>(); // con copia en disco (ahí se queda hasta `release`)

  async function run(id: string) {
    const blob = blobs.get(id);
    if (!blob || running.has(id)) return;
    running.add(id);
    failed.delete(id);
    let lastError = new Error('La subida falló.');
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (!blobs.has(id)) return void running.delete(id); // descartada mientras esperaba
      try {
        await opts.store.upload(opts.projectId, id, blob);
        blobs.delete(id);
        running.delete(id);
        opts.onDone?.(id);
        listeners.forEach((cb) => cb(id));
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
        .then(() => {
          if (blobs.has(id)) return run(id);
          // Descartada mientras se escribía en disco: la copia recién creada sobra.
          if (onDisk.delete(id)) void store.remove(opts.projectId, id).catch(() => undefined);
        });
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
    discard(ids) {
      for (const id of ids) {
        blobs.delete(id);
        failed.delete(id);
        if (onDisk.delete(id)) void store?.remove(opts.projectId, id).catch(() => undefined);
      }
    },
    whenDone(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    retryFailed() {
      for (const id of [...failed]) void run(id);
    },
    pending: () => [...blobs.keys()].filter((id) => !onDisk.has(id)).length,
  };
}

