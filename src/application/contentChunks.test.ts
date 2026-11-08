import { describe, expect, it } from 'vitest';
import { DOC_CONTENT_BYTES, MAX_CONTENT_BYTES, byteLength } from '@/domain/codec';
import { MAX_CHUNKS, chunkCount, joinContent, splitContent } from './contentChunks';

describe('contentChunks', () => {
  it('un contenido que cabe es un solo trozo, intacto', () => {
    expect(splitContent('{"a":1}')).toEqual(['{"a":1}']);
    expect(splitContent('x'.repeat(DOC_CONTENT_BYTES))).toHaveLength(1);
  });

  it('pasado el límite parte en trozos de ≤ 900 000 bytes y recompone idéntico', () => {
    const s = 'x'.repeat(DOC_CONTENT_BYTES * 2 + 5);
    const parts = splitContent(s);
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => byteLength(p) <= DOC_CONTENT_BYTES)).toBe(true);
    expect(joinContent(parts)).toBe(s);
  });

  it('no corta caracteres de varios bytes: cada trozo es UTF-8 válido y se recompone igual', () => {
    const s = 'añ😀€'.repeat(400_000); // 1+2+4+3 = 10 bytes por vuelta, 4 MB
    const parts = splitContent(s, 7_777);
    expect(parts.every((p) => byteLength(p) <= 7_777 && !p.includes('�'))).toBe(true);
    expect(joinContent(parts)).toBe(s);
  });

  it('el tope de 8 MiB cabe en MAX_CHUNKS trozos y uno más lanza', () => {
    expect(splitContent('x'.repeat(MAX_CONTENT_BYTES)).length).toBeLessThanOrEqual(MAX_CHUNKS);
    expect(() => splitContent('x'.repeat(MAX_CONTENT_BYTES + 1))).toThrow(RangeError);
  });

  it('chunkCount: sin campo no hay troceado; fuera de rango es formato desconocido', () => {
    expect(chunkCount({})).toBeNull();
    expect(chunkCount({ chunks: 3 })).toBe(3);
    for (const bad of [1, 13, 2.5, '3']) expect(() => chunkCount({ chunks: bad })).toThrow(/formato/);
  });
});
