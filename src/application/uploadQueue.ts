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
  /** Por defecto `navigator.locks`. Con `null` (o sin él) se repone sin coordinar entre pestañas. */
  locks?: LockManagerLike | null;
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
  /** Suelta el derecho sobre los pendientes en disco (al desmontar el editor) para que otra pestaña los reponga. */
  dispose(): void;
}

/** Puerto mínimo de la Web Locks API (`navigator.locks`); en Vitest o navegadores sin ella no hay bloqueo (D38). */
export type LockManagerLike = Pick<LockManager, 'request'>;

const defaultLocks = (): LockManagerLike | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as { locks?: LockManagerLike }).locks;

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
  const locks = opts.locks === undefined ? defaultLocks() : opts.locks;
  const holds = new Map<string, () => void>(); // pendientes que esta pestaña se encarga de reponer y subir
  // Generación de la cola: `dispose` la avanza. Lo que empezó antes del cierre no adquiere bloqueos ni sube (D53);
  // lo que empieza después sí: StrictMode desmonta y vuelve a montar el efecto sobre la misma cola.
  let gen = 0;

  /**
   * D38: el pendiente en disco es de una sola pestaña. El bloqueo `dya-pending:<fileId>` se mantiene hasta
   * `release`, `discard` o `dispose` (o hasta que la pestaña muere: entonces otra lo recoge). `false`: otra pestaña
   * ya se encarga, o la cola está cerrada (un bloqueo que cruza el cierre se suelta en el acto; el pendiente queda
   * en disco para otra cola). Sin Web Locks `true` salvo cerrada.
   */
  function claim(id: string, g: number): Promise<boolean> {
    const closed = () => g !== gen;
    if (closed()) return Promise.resolve(false);
    if (!locks) return Promise.resolve(true);
    if (holds.has(id)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      void locks
        .request(`dya-pending:${id}`, { ifAvailable: true }, (lock) =>
          lock
            ? new Promise<void>((free) => {
                if (closed()) return void (free(), resolve(false));
                holds.set(id, free);
                resolve(true);
              })
            : void resolve(false),
        )
        .catch(() => resolve(!closed())); // el bloqueo falló por otra razón: mejor reponer que perder la imagen
    });
  }
  function unclaim(id: string) {
    holds.get(id)?.();
    holds.delete(id);
  }

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
      const g = gen;
      void (async () => {
        let lost = false; // otra pestaña tomó el bloqueo (D52) o la cola se cerró (D53): esta no sube
        try {
          await store.put({ projectId: opts.projectId, fileId: id, blob, meta });
          if (!(await claim(id, g))) lost = true;
          else if (g === gen) onDisk.add(id);
        } catch {
          /* el disco falló: se sube igual */
        }
        if (lost || g !== gen) return void blobs.delete(id); // el pendiente queda en disco para quien lo tenga
        if (blobs.has(id)) return run(id);
        // Descartada mientras se escribía en disco: la copia recién creada sobra.
        if (onDisk.delete(id)) void store.remove(opts.projectId, id).catch(() => undefined);
        unclaim(id);
      })();
    },
    async resume(published, restore) {
      if (!store) return;
      const g = gen;
      const files = await store.list(opts.projectId).catch(() => []);
      for (const f of files) {
        if (g !== gen) return;
        if (published(f.fileId)) {
          void store.remove(opts.projectId, f.fileId).catch(() => undefined);
        } else if (!blobs.has(f.fileId)) {
          if (!(await claim(f.fileId, g))) continue; // otra pestaña la repone
          // Dentro del bloqueo se vuelve a leer: la otra pestaña pudo borrarla mientras tanto.
          const fresh = (await store.list(opts.projectId).catch(() => [])).find((x) => x.fileId === f.fileId);
          if (g !== gen || !fresh || blobs.has(f.fileId)) {
            if (!blobs.has(f.fileId)) unclaim(f.fileId);
            continue;
          }
          blobs.set(fresh.fileId, fresh.blob);
          onDisk.add(fresh.fileId);
          restore(fresh);
          void run(fresh.fileId);
        }
      }
    },
    release(ids) {
      for (const id of ids) {
        if (blobs.has(id) || !onDisk.delete(id)) continue; // aún sin subir: la copia en disco sigue siendo la red
        void store?.remove(opts.projectId, id).catch(() => undefined);
        unclaim(id);
      }
    },
    discard(ids) {
      for (const id of ids) {
        blobs.delete(id);
        failed.delete(id);
        if (onDisk.delete(id)) void store?.remove(opts.projectId, id).catch(() => undefined);
        unclaim(id);
      }
    },
    dispose() {
      gen++;
      [...holds.keys()].forEach(unclaim);
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
