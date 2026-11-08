import { DOC_CONTENT_BYTES, MAX_CONTENT_BYTES } from '@/domain/codec';

// Contenido troceado (D17). `projects/{id}/content/main` guarda `{ schemaVersion, revision, updatedAt }` y, según el
// tamaño del contenido codificado:
//   · cabe en un documento (≤ 900 000 bytes UTF-8): `data` (el formato de siempre);
//   · no cabe: `chunks: n` (n ≥ 2) y los trozos en `content/main/chunks/{i} = { data: string }` (≤ 900 000 bytes).
// Quien lea o escriba contenido (la app y el servidor MCP) usa estas funciones y la lectura/escritura troceada de
// `infrastructure/firebase/content.ts`: ninguna implementación propia.

/** Trozos que admiten las reglas: 8 MiB / 900 000 B = 10 + margen por trozos cortados en frontera UTF-8. */
export const MAX_CHUNKS = 12;
export const MIN_CHUNKS = 2;

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Parte `data` en trozos de ≤ `size` bytes UTF-8 sin cortar un carácter (cada trozo es UTF-8 válido por sí solo).
 * Un contenido que cabe devuelve un único elemento; uno que pasa de `MAX_CONTENT_BYTES` lanza `RangeError`.
 */
export function splitContent(data: string, size = DOC_CONTENT_BYTES): string[] {
  const bytes = enc.encode(data);
  if (bytes.length <= size) return [data];
  if (bytes.length > MAX_CONTENT_BYTES) {
    throw new RangeError(`El contenido ocupa ${bytes.length} bytes y el tope es ${MAX_CONTENT_BYTES}.`);
  }
  const out: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + size, bytes.length);
    // Retrocede hasta el inicio de un carácter (los bytes de continuación son 10xxxxxx).
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    out.push(dec.decode(bytes.subarray(start, end)));
    start = end;
  }
  return out;
}

export const joinContent = (parts: readonly string[]): string => parts.join('');

/**
 * Une trozos leídos (`undefined` = ausente). Devuelve `null` si falta alguno: otro cliente pudo reducir el contenido
 * (meta a `data`, trozos borrados) entre la lectura de la meta y la de los trozos. No es un error de formato hasta
 * que persiste con la meta estable: quien lee reintenta (`READ_ATTEMPTS`).
 */
export function joinChunks(parts: readonly (string | undefined)[]): string | null {
  return parts.every((p): p is string => typeof p === 'string') ? joinContent(parts) : null;
}

/** Intentos de una lectura o fusión que se topa con trozos ausentes antes de darlos por un formato roto. */
export const READ_ATTEMPTS = 3;

/** `chunks` de la meta de `content/main` si es válido (entero en [MIN_CHUNKS, MAX_CHUNKS]); `null` si no hay troceado. */
export function chunkCount(meta: { chunks?: unknown }): number | null {
  const n = meta.chunks;
  if (n === undefined) return null;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_CHUNKS || n > MAX_CHUNKS) {
    throw new Error('El contenido guardado tiene un formato desconocido.');
  }
  return n;
}
