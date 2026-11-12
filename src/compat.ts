// Respaldos mínimos para el suelo de navegadores declarado (Safari 14.1, Chrome/Edge/Firefox 90, Samsung Internet 15):
// APIs de ES2022 / HTML que usan el código propio y las librerías (Excalidraw, Mermaid) y que esos navegadores aún no
// traen. Cada una se instala solo si falta, así que en navegadores modernos no hace nada. Sin dependencias.
// Se importa primero en `main.tsx`.

/** `structuredClone` para datos JSON (el contenido del diagrama se persiste como texto, así que la copia es exacta). */
export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function hasOwn(obj: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** `Array.prototype.at` y `String.prototype.at`: un índice negativo cuenta desde el final. */
export function at(this: ArrayLike<unknown> | string, index: number): unknown {
  const n = Math.trunc(index) || 0;
  const i = n < 0 ? this.length + n : n;
  return i < 0 || i >= this.length ? undefined : this[i];
}

if (typeof globalThis.structuredClone !== 'function') globalThis.structuredClone = cloneJson;
if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', { value: hasOwn, configurable: true, writable: true });
}
for (const ctor of [Array, String] as const) {
  if (typeof ctor.prototype.at !== 'function') {
    Object.defineProperty(ctor.prototype, 'at', { value: at, configurable: true, writable: true });
  }
}
