// Persistencia como string versionado (plan · invariante 1).
// ponytail: por encima de 900 KB hay error visible; el blob en Storage queda para cuando un board real lo alcance.

export const SCHEMA_VERSION = 1 as const;
export const MAX_CONTENT_BYTES = 900_000;

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
