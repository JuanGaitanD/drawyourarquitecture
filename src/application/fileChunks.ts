// Troceado de archivos para Firestore: un documento admite 1 MiB, así que cada trozo lleva ≤ 900 000 bytes.

export const CHUNK_BYTES = 900_000;
/** Un batch de Firestore admite 500 operaciones y ~10 MiB; se deja margen. */
export const BATCH_MAX_OPS = 450;
export const BATCH_MAX_BYTES = 8 * 1024 * 1024;

export function splitBytes(bytes: Uint8Array, size = CHUNK_BYTES): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

export function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Reparte los trozos en lotes que respetan los límites de un batch. La meta va en una operación más al final del
 * último lote: si algo falla antes, no queda una meta que apunte a trozos que faltan.
 * Devuelve, por lote, los índices de trozo; `metaIn` es el índice del lote que lleva la meta (el último).
 */
export function planBatches(
  chunkSizes: readonly number[],
  maxOps = BATCH_MAX_OPS,
  maxBytes = BATCH_MAX_BYTES,
): number[][] {
  const batches: number[][] = [[]];
  let bytes = 0;
  chunkSizes.forEach((size, i) => {
    const cur = batches[batches.length - 1]!;
    // +1 reserva la operación de la meta en el último lote.
    if (cur.length > 0 && (cur.length + 2 > maxOps || bytes + size > maxBytes)) {
      batches.push([]);
      bytes = 0;
    }
    batches[batches.length - 1]!.push(i);
    bytes += size;
  });
  return batches;
}
