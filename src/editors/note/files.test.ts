import { describe, expect, it, vi } from 'vitest';
import { diffNewFiles, retryMissing, type BinaryLike } from './files';

const png = (id: string, bytes = 10): BinaryLike => ({
  id,
  mimeType: 'image/png',
  dataURL: 'data:image/png;base64,' + 'A'.repeat(Math.ceil((bytes * 4) / 3)),
  created: 1,
});
const image = (fileId: string, isDeleted = false) => ({ type: 'image', fileId, isDeleted });

describe('diffNewFiles', () => {
  it('devuelve solo lo referenciado por imágenes vivas y aún no registrado', () => {
    const files = { a: png('a'), b: png('b'), c: png('c'), huerfano: png('huerfano') };
    const r = diffNewFiles([image('a'), image('b'), image('c', true)], files, {
      b: { mimeType: 'image/png', created: 1 },
    });
    expect(r.fresh.map((f) => f.id)).toEqual(['a']);
    expect(r.rejected).toEqual([]);
  });

  it('separa los formatos no admitidos; el tamaño se juzga tras optimizar', () => {
    const svg: BinaryLike = { ...png('s'), mimeType: 'image/svg+xml' };
    const big = png('g', 5 * 1024 * 1024);
    const r = diffNewFiles([image('s'), image('g')], { s: svg, g: big }, {});
    expect(r.fresh.map((f) => f.id)).toEqual(['g']);
    expect(r.rejected.map((x) => [x.file.id, x.reason])).toEqual([['s', 'formato']]);
  });

  it('ignora una imagen cuyo archivo Excalidraw aún no tiene', () => {
    expect(diffNewFiles([image('z')], {}, {}).fresh).toEqual([]);
  });
});


describe('retryMissing', () => {
  const sleep = () => Promise.resolve();

  it('reintenta lo que aún no existe y se detiene al conseguirlo (subida lenta del autor)', async () => {
    const calls: string[][] = [];
    const attempt = vi.fn(async (ids: string[]) => {
      calls.push(ids);
      return calls.length < 3 ? ids : [];
    });
    expect(await retryMissing(['a'], attempt, [1, 2, 4], sleep)).toEqual([]);
    expect(calls).toEqual([['a'], ['a'], ['a']]);
  });

  it('con un fallo definitivo reintenta de forma acotada y devuelve lo que falló', async () => {
    const attempt = vi.fn(async (ids: string[]) => ids);
    expect(await retryMissing(['a', 'b'], attempt, [1, 2, 4], sleep)).toEqual(['a', 'b']);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it('no reintenta si el lienzo ya no está', async () => {
    const attempt = vi.fn(async (ids: string[]) => ids);
    await retryMissing(['a'], attempt, [1, 2], sleep, () => false);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
