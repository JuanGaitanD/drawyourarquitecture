import { describe, expect, it } from 'vitest';
import { at, cloneJson, hasOwn } from './compat';

describe('compat · respaldos para navegadores sin la API', () => {
  it('cloneJson copia en profundidad un valor JSON', () => {
    const origen = { a: [1, { b: 'x' }], c: null };
    const copia = cloneJson(origen);
    expect(copia).toEqual(origen);
    expect(copia).not.toBe(origen);
    expect(copia.a[1]).not.toBe(origen.a[1]);
    expect(cloneJson(undefined)).toBeUndefined();
  });

  it('hasOwn distingue propias de heredadas', () => {
    expect(hasOwn({ a: 1 }, 'a')).toBe(true);
    expect(hasOwn({ a: 1 }, 'toString')).toBe(false);
  });

  it('at admite índices negativos y fuera de rango en arrays y cadenas', () => {
    expect(at.call([1, 2, 3], -1)).toBe(3);
    expect(at.call([1, 2, 3], 0)).toBe(1);
    expect(at.call([1, 2, 3], 3)).toBeUndefined();
    expect(at.call([1, 2, 3], -4)).toBeUndefined();
    expect(at.call('abc', -2)).toBe('b');
  });
});
