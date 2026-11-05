// Optimización de imágenes antes de subirlas (plan · invariante 3): lado mayor ≤ 2048 px, WebP a calidad 0,82,
// y se conserva el resultado solo si pesa menos. La lógica es pura; las APIs del navegador entran por `ImageCodec`.

export const MAX_SIDE = 2048;
export const WEBP_QUALITY = 0.82;
/** Tope tras optimizar. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super('La imagen pesa más de 4 MiB incluso optimizada.');
    this.name = 'ImageTooLargeError';
  }
}

export interface DecodedImage {
  width: number;
  height: number;
  close(): void;
}

/** Lo único que toca el navegador: decodificar y recodificar. */
export interface ImageCodec {
  decode(blob: Blob): Promise<DecodedImage>;
  /** Devuelve el blob con `type` real: si el navegador no sabe WebP, el `type` no será `image/webp`. */
  encode(img: DecodedImage, width: number, height: number, type: string, quality: number): Promise<Blob>;
}

/** Tamaño de destino: el lado mayor se reduce a `max` conservando la proporción; nunca se amplía. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return k === 1
    ? { width, height }
    : { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Devuelve el blob que se sube: el optimizado si pesa menos que el original; el original si es GIF (animación),
 * si no se puede decodificar o si el navegador no codifica WebP. Lanza `ImageTooLargeError` si pasa de 4 MiB.
 */
export async function optimizeImage(blob: Blob, codec: ImageCodec = browserCodec): Promise<Blob> {
  let best = blob;
  if (blob.type !== 'image/gif') {
    try {
      const img = await codec.decode(blob);
      try {
        const { width, height } = fitWithin(img.width, img.height);
        const out = await codec.encode(img, width, height, 'image/webp', WEBP_QUALITY);
        if (out.type === 'image/webp' && out.size < blob.size) best = out;
      } finally {
        img.close();
      }
    } catch {
      // Sin decodificar o sin WebP: se sube el original.
    }
  }
  if (best.size > MAX_IMAGE_BYTES) throw new ImageTooLargeError(best.size);
  return best;
}

/** Implementación real: `createImageBitmap` + `OffscreenCanvas` (o `<canvas>` si no existe). */
export const browserCodec: ImageCodec = {
  decode: (blob) => createImageBitmap(blob),
  async encode(img, width, height, type, quality) {
    const bmp = img as ImageBitmap;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')?.drawImage(bmp, 0, 0, width, height);
      return canvas.convertToBlob({ type, quality });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen.'))), type, quality),
    );
  },
};
