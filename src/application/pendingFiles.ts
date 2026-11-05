// Binarios cuya subida a Firestore aún no se confirmó (D8). Viven en IndexedDB (`dya-pending-files`) para que una
// subida agotada o una pestaña cerrada no pierda la imagen: la cola los reintenta al volver a cargar o al recuperar
// la conexión. Es el único sitio que toca IndexedDB; la cola de subida lo recibe inyectado (en Vitest no existe).

export interface PendingFile {
  projectId: string;
  fileId: string;
  blob: Blob;
  /** Lo que el editor necesita para reponer la imagen al volver (en la nota: los elementos y la fecha). */
  meta?: unknown;
}

export interface PendingStore {
  put(file: PendingFile): Promise<void>;
  list(projectId: string): Promise<PendingFile[]>;
  remove(projectId: string, fileId: string): Promise<void>;
}

const DB_NAME = 'dya-pending-files';
const STORE = 'files';
const keyOf = (projectId: string, fileId: string) => `${projectId}/${fileId}`;

/** Una transacción de IndexedDB como promesa; resuelve con el resultado de la petición al completarse. */
function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'key' });
    open.onerror = () => reject(open.error ?? new Error('No se pudo abrir IndexedDB.'));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error('Falló la transacción de IndexedDB.'));
      };
    };
  });
}

/** `null` si el navegador no tiene IndexedDB (la cola sigue funcionando solo en memoria). */
export function indexedDbPendingStore(): PendingStore | null {
  if (typeof indexedDB === 'undefined') return null;
  return {
    put: (f) => run('readwrite', (s) => s.put({ key: keyOf(f.projectId, f.fileId), ...f })).then(() => undefined),
    list: async (projectId) => {
      const range = IDBKeyRange.bound(`${projectId}/`, `${projectId}/￿`);
      return await run<PendingFile[]>('readonly', (s) => s.getAll(range));
    },
    remove: (projectId, fileId) => run('readwrite', (s) => s.delete(keyOf(projectId, fileId))).then(() => undefined),
  };
}
