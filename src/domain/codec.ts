// Persistencia como string versionado (plan · invariante 1).
// Hasta DOC_CONTENT_BYTES el contenido cabe en un documento (`content/main.data`); por encima se trocea en
// `content/main/chunks/{i}` (application/contentChunks.ts) y el tope práctico es MAX_CONTENT_BYTES.

export const SCHEMA_VERSION = 1 as const;
/** Un documento de Firestore admite 1 MiB: lo que cabe en un solo trozo. */
export const DOC_CONTENT_BYTES = 900_000;
/** Tope práctico del contenido troceado: una transacción admite ~10 MiB. */
export const MAX_CONTENT_BYTES = 8 * 1024 * 1024;

/** El tope escrito para personas («8 MiB»), derivado de `MAX_CONTENT_BYTES` para que los avisos no se desfasen. */
export const MAX_CONTENT_LABEL = `${MAX_CONTENT_BYTES / 1024 / 1024} MiB`;

export class ContentTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(`El contenido ocupa ${bytes} bytes y el tope es ${MAX_CONTENT_BYTES}.`);
    this.name = 'ContentTooLargeError';
    this.bytes = bytes;
  }
}

const utf8 = new TextEncoder();

export function byteLength(s: string): number {
  return utf8.encode(s).length;
}

export function encode(obj: unknown): string {
  const s = JSON.stringify(obj);
  if (s === undefined) throw new TypeError('El valor no es serializable a JSON.');
  const bytes = byteLength(s);
  if (bytes > MAX_CONTENT_BYTES) throw new ContentTooLargeError(bytes);
  return s;
}

export function decode<T>(s: string): T {
  return JSON.parse(s) as T;
}
