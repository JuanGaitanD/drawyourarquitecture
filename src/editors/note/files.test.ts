import { describe, expect, it, vi } from 'vitest';
import type { PendingFile, PendingStore } from '@/application/pendingFiles';
import { createUploadQueue, diffNewFiles, retryMissing, type BinaryLike } from './files';

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

describe('createUploadQueue con copia en disco (D8)', () => {
  const sleep = () => Promise.resolve();
  const blob = new Blob(['x']);
  /** IndexedDB en memoria: la cola solo conoce la interfaz. */
  const memStore = () => {
    const m = new Map<string, PendingFile>();
    const store: PendingStore = {
      put: async (f) => void m.set(`${f.projectId}/${f.fileId}`, f),
      list: async (p) => [...m.values()].filter((f) => f.projectId === p),
      remove: async (p, id) => void m.delete(`${p}/${id}`),
    };
    return { store, m };
  };

  it('guarda el binario antes de subir y lo conserva hasta `release` (contenido ya guardado)', async () => {
    const { store, m } = memStore();
    const upload = vi.fn(() => Promise.resolve());
    const done = vi.fn();
    const q = createUploadQueue({ store: { upload }, projectId: 'p', persist: store, onFail: vi.fn(), onDone: done, sleep });
    q.add('f', blob, { elements: [1] });
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith('f'));
    expect(m.get('p/f')?.meta).toEqual({ elements: [1] });
    expect(q.pending()).toBe(0); // con copia en disco, cerrar la pestaña no pierde nada
    q.release(['f']);
    await vi.waitFor(() => expect(m.size).toBe(0));
  });

  it('una subida agotada queda en disco; al volver a cargar `resume` la repone y la sube', async () => {
    const { store, m } = memStore();
    const fail = vi.fn<(p: string, id: string, b: Blob) => Promise<void>>().mockRejectedValue(new Error('sin red'));
    const onFail = vi.fn();
    const q1 = createUploadQueue({ store: { upload: fail }, projectId: 'p', persist: store, onFail, sleep });
    q1.add('f', blob, { created: 7 });
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    expect(m.has('p/f')).toBe(true);

    // Pestaña nueva: cola nueva, el servidor ya responde.
    const upload = vi.fn(() => Promise.resolve());
    const done = vi.fn();
    const restore = vi.fn();
    const q2 = createUploadQueue({ store: { upload }, projectId: 'p', persist: store, onFail: vi.fn(), onDone: done, sleep });
    await q2.resume(() => false, restore);
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'f', meta: { created: 7 } }));
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith('f'));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('`resume` no sube lo que el contenido ya publicó y limpia su copia; ignora otros proyectos', async () => {
    const { store, m } = memStore();
    await store.put({ projectId: 'p', fileId: 'ya', blob });
    await store.put({ projectId: 'otro', fileId: 'x', blob });
    const upload = vi.fn(() => Promise.resolve());
    const q = createUploadQueue({ store: { upload }, projectId: 'p', persist: store, onFail: vi.fn(), sleep });
    await q.resume((id) => id === 'ya', vi.fn());
    await vi.waitFor(() => expect(m.has('p/ya')).toBe(false));
    expect(m.has('otro/x')).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('si el disco falla, sube igual y `pending` cuenta la imagen como perdible', async () => {
    const store: PendingStore = {
      put: () => Promise.reject(new Error('cuota')),
      list: async () => [],
      remove: async () => undefined,
    };
    let release!: () => void;
    const upload = vi.fn(() => new Promise<void>((r) => (release = r)));
    const q = createUploadQueue({ store: { upload }, projectId: 'p', persist: store, onFail: vi.fn(), sleep });
    q.add('f', blob);
    await vi.waitFor(() => expect(upload).toHaveBeenCalled());
    expect(q.pending()).toBe(1);
    release();
  });
});
