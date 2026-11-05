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
  /** Se agotaron los reintentos: el binario sigue en memoria y `retry` lo vuelve a intentar. */
  onFail: (fileId: string, error: Error) => void;
  onDone?: (fileId: string) => void;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface UploadQueue {
  add(id: string, blob: Blob): void;
  /** Reintenta lo que falló (botón «Reintentar»). */
  retryFailed(): void;
  /** Subidas sin terminar (en curso, esperando reintento o fallidas). */
  pending(): number;
}

/** Cola de subidas: cada archivo se sube a la vez y reintenta 3 veces (1-2-4 s). */
export function createUploadQueue(opts: UploadQueueOptions): UploadQueue {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const blobs = new Map<string, Blob>(); // pendientes: siguen en memoria hasta subirse
  const running = new Set<string>();
  const failed = new Set<string>();

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
    add(id, blob) {
      if (blobs.has(id)) return;
      blobs.set(id, blob);
      void run(id);
    },
    retryFailed() {
      for (const id of [...failed]) void run(id);
    },
    pending: () => blobs.size,
  };
}
