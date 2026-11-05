import { describe, expect, it, vi } from 'vitest';
import { createUploadQueue, diffNewFiles, type BinaryLike } from './files';

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

describe('createUploadQueue', () => {
  const blob = new Blob(['x']);
  const sleep = vi.fn((_ms: number) => Promise.resolve());

  it('reintenta con 1-2-4 s y termina si el 4.º intento sale', async () => {
    sleep.mockClear();
    const upload = vi
      .fn<(p: string, id: string, b: Blob) => Promise<void>>()
      .mockRejectedValueOnce(new Error('red'))
      .mockRejectedValueOnce(new Error('red'))
      .mockRejectedValueOnce(new Error('red'))
      .mockResolvedValueOnce();
    const done = vi.fn();
    const q = createUploadQueue({ store: { upload }, projectId: 'p', onFail: vi.fn(), onDone: done, sleep });
    q.add('f', blob);
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith('f'));
    expect(upload).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
    expect(q.pending()).toBe(0);
  });

  it('avisa al agotar los reintentos, conserva el binario y «Reintentar» lo sube', async () => {
    const upload = vi
      .fn<(p: string, id: string, b: Blob) => Promise<void>>()
      .mockRejectedValue(new Error('red'));
    const onFail = vi.fn();
    const done = vi.fn();
    const q = createUploadQueue({ store: { upload }, projectId: 'p', onFail, onDone: done, sleep });
    q.add('f', blob);
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledTimes(4);
    expect(q.pending()).toBe(1);

    upload.mockResolvedValue();
    q.retryFailed();
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith('f'));
    expect(q.pending()).toBe(0);
  });

  it('no duplica una subida en curso', async () => {
    const upload = vi.fn(() => Promise.resolve());
    const q = createUploadQueue({ store: { upload }, projectId: 'p', onFail: vi.fn(), sleep });
    q.add('f', blob);
    q.add('f', blob);
    await vi.waitFor(() => expect(q.pending()).toBe(0));
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
