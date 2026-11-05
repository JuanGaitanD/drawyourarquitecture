// Imágenes del board (invariante 3): PNG, JPEG, GIF y WebP de hasta 4 MiB; subida con 3 reintentos (1-2-4 s).

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Mensaje de error si el archivo no vale, o `null`. */
export function imageProblem(file: { type: string; size: number }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type))
    return 'Solo se admiten PNG, JPEG, GIF y WebP.';
  if (file.size > MAX_IMAGE_BYTES) return 'La imagen pesa más de 4 MiB.';
  return null;
}

/** Abre el selector de archivos. Devuelve `null` si se cancela. */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_TYPES.join(',');
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** Tamaño del nodo: ancho máximo 320 conservando la proporción. */
export async function imageNodeSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 320 / bmp.width);
    const size = { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) };
    bmp.close();
    return size;
  } catch {
    return { width: 240, height: 160 };
  }
}

const DELAYS = [1000, 2000, 4000];

export async function uploadWithRetry(
  upload: (blob: Blob) => Promise<void>,
  blob: Blob,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await upload(blob);
    } catch (e) {
      if (i >= DELAYS.length) throw e;
      await wait(DELAYS[i]!);
    }
  }
}
