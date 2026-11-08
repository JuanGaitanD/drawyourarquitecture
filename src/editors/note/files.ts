import { RETRY_DELAYS_MS } from '@/application/uploadQueue';
import { referencedFileIds, type NoteFiles, type SceneElementLike } from './codec';

// Archivos de la nota (plan · invariante 3): formatos, diff de nuevos y subida en cola. El tope de 4 MiB se
// aplica después de optimizar (`optimizeImage`), no aquí.

export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

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
