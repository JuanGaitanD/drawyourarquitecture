import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, joinBytes, planBatches, splitBytes } from './fileChunks';

const seq = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('splitBytes / joinBytes', () => {
  it('parte en trozos de ≤ 900 000 y recompone idéntico', () => {
    const data = seq(2 * CHUNK_BYTES + 5);
    const parts = splitBytes(data);
    expect(parts.map((p) => p.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 5]);
    expect(joinBytes(parts)).toEqual(data);
  });
  it('900 000 bytes justos son un trozo; uno más son dos', () => {
    expect(splitBytes(seq(CHUNK_BYTES))).toHaveLength(1);
    expect(splitBytes(seq(CHUNK_BYTES + 1))).toHaveLength(2);
  });
  it('4 MiB caben en 5 trozos', () => {
    expect(splitBytes(new Uint8Array(4 * 1024 * 1024))).toHaveLength(5);
  });
});

describe('planBatches', () => {
  it('un archivo normal va en un solo lote', () => {
    expect(planBatches([900_000, 900_000, 5])).toEqual([[0, 1, 2]]);
  });
  it('parte por número de operaciones dejando sitio para la meta', () => {
    const plan = planBatches([1, 1, 1, 1, 1], 4);
    expect(plan).toEqual([[0, 1, 2], [3, 4]]);
    expect(plan.at(-1)!.length + 1).toBeLessThanOrEqual(4); // el último lleva además la meta
  });
  it('parte por bytes', () => {
    expect(planBatches([6, 6, 6], 450, 10)).toEqual([[0], [1], [2]]);
  });
  it('no deja lotes vacíos ni pierde trozos', () => {
    const plan = planBatches(Array(10).fill(5), 450, 12);
    expect(plan.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.every((b) => b.length > 0)).toBe(true);
  });
});
