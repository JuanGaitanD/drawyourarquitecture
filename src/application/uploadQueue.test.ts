import { describe, expect, it, vi } from 'vitest';
import type { PendingFile, PendingStore } from './pendingFiles';
import { createUploadQueue, type LockManagerLike } from './uploadQueue';

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

  it('`whenDone` avisa a los oyentes y se puede dar de baja', async () => {
    const upload = vi.fn(() => Promise.resolve());
    const q = createUploadQueue({ store: { upload }, projectId: 'p', onFail: vi.fn(), sleep });
    const a = vi.fn();
    const b = vi.fn();
    q.whenDone(a);
    q.whenDone(b)();
    q.add('f', blob);
    await vi.waitFor(() => expect(a).toHaveBeenCalledWith('f'));
    expect(b).not.toHaveBeenCalled();
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

    // Pestaña nueva (la anterior se cerró y soltó su bloqueo): cola nueva, el servidor ya responde.
    q1.dispose();
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

describe('createUploadQueue.discard (D24)', () => {
  const sleep = () => Promise.resolve();
  const blob = new Blob(['x']);
  const memStore = () => {
    const m = new Map<string, PendingFile>();
    const store: PendingStore = {
      put: async (f) => void m.set(`${f.projectId}/${f.fileId}`, f),
      list: async (p) => [...m.values()].filter((f) => f.projectId === p),
      remove: async (p, id) => void m.delete(`${p}/${id}`),
    };
    return { store, m };
  };

  it('una imagen borrada tras subirse pero antes de guardarse no vuelve al reabrir', async () => {
    const { store, m } = memStore();
    const done = vi.fn();
    const q = createUploadQueue({ store: { upload: () => Promise.resolve() }, projectId: 'p', persist: store, onFail: vi.fn(), onDone: done, sleep });
    q.add('f', blob);
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(m.has('p/f')).toBe(true);
    q.discard(['f']);
    await vi.waitFor(() => expect(m.size).toBe(0));
    const restore = vi.fn();
    await createUploadQueue({ store: { upload: vi.fn() }, projectId: 'p', persist: store, onFail: vi.fn(), sleep }).resume(() => false, restore);
    expect(restore).not.toHaveBeenCalled();
  });

  it('una subida fallida se olvida: ni se reintenta ni queda en disco', async () => {
    const { store, m } = memStore();
    const upload = vi.fn<(p: string, id: string, b: Blob) => Promise<void>>().mockRejectedValue(new Error('red'));
    const onFail = vi.fn();
    const q = createUploadQueue({ store: { upload }, projectId: 'p', persist: store, onFail, sleep });
    q.add('f', blob);
    await vi.waitFor(() => expect(onFail).toHaveBeenCalled());
    q.discard(['f']);
    upload.mockClear();
    q.retryFailed();
    await vi.waitFor(() => expect(m.size).toBe(0));
    expect(upload).not.toHaveBeenCalled();
  });

  it('descartada mientras se escribe en disco: no se sube y no queda copia', async () => {
    let finish!: () => void;
    const m = new Map<string, PendingFile>();
    const store: PendingStore = {
      put: (f) => new Promise((r) => (finish = () => (m.set(f.fileId, f), r()))),
      list: async () => [],
      remove: async (_p, id) => void m.delete(id),
    };
    const upload = vi.fn(() => Promise.resolve());
    const q = createUploadQueue({ store: { upload }, projectId: 'p', persist: store, onFail: vi.fn(), sleep });
    q.add('f', blob);
    q.discard(['f']);
    finish();
    await vi.waitFor(() => expect(m.size).toBe(0));
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('createUploadQueue.resume entre pestañas (D38)', () => {
  const sleep = () => Promise.resolve();
  const blob = new Blob(['x']);
  const pending: PendingFile = { projectId: 'p', fileId: 'f', blob, meta: {} };

  /** IndexedDB y Web Locks compartidos por «pestañas»; el bloqueo se suelta al resolver su callback. */
  const shared = () => {
    const m = new Map<string, PendingFile>([['p/f', pending]]);
    const held = new Set<string>();
    const locks = {
      request: async (name: string, _o: unknown, cb: (l: unknown) => unknown) => {
        if (held.has(name)) return cb(null);
        held.add(name);
        try {
          return await cb({ name });
        } finally {
          held.delete(name);
        }
      },
    } as unknown as LockManagerLike;
    const store: PendingStore = {
      put: async (f) => void m.set(`${f.projectId}/${f.fileId}`, f),
      list: async (p) => [...m.values()].filter((f) => f.projectId === p),
      remove: async (p, id) => void m.delete(`${p}/${id}`),
    };
    const tab = (list: PendingStore['list'] = store.list) =>
      createUploadQueue({
        store: { upload: vi.fn(() => new Promise<void>(() => undefined)) },
        projectId: 'p',
        persist: { ...store, list },
        onFail: vi.fn(),
        sleep,
        locks,
      });
    return { m, held, store, tab };
  };

  it('dos pestañas que reponen a la vez: solo una inserta la imagen', async () => {
    const { tab } = shared();
    const restoreA = vi.fn();
    const restoreB = vi.fn();
    await Promise.all([tab().resume(() => false, restoreA), tab().resume(() => false, restoreB)]);
    expect(restoreA.mock.calls.length + restoreB.mock.calls.length).toBe(1);
  });

  it('si la otra pestaña ya la borró, la relectura dentro del bloqueo la descarta y suelta el bloqueo', async () => {
    const { held, store, tab } = shared();
    const restore = vi.fn();
    let first = true;
    // Lista obsoleta en la primera lectura (como si se hubiera hecho antes de que la otra pestaña la borrara).
    const stale: PendingStore['list'] = async (p) => {
      const files = await store.list(p);
      if (!first) return [];
      first = false;
      return files;
    };
    await tab(stale).resume(() => false, restore);
    expect(restore).not.toHaveBeenCalled();
    expect(held.size).toBe(0);
  });

  it('mientras la pestaña la tiene, otra no la repone; con `release` queda libre y sin copia', async () => {
    const { m, held, tab } = shared();
    const a = tab();
    const restoreB = vi.fn();
    await a.resume(() => false, vi.fn());
    expect(held.has('dya-pending:f')).toBe(true);
    await tab().resume(() => false, restoreB);
    expect(restoreB).not.toHaveBeenCalled();
    a.discard(['f']);
    await vi.waitFor(() => expect(m.size).toBe(0));
    expect(held.size).toBe(0);
  });

  it('`dispose` suelta el derecho: otra pestaña recoge el pendiente', async () => {
    const { held, tab } = shared();
    const a = tab();
    await a.resume(() => false, vi.fn());
    a.dispose();
    await vi.waitFor(() => expect(held.size).toBe(0));
    const restoreB = vi.fn();
    await tab().resume(() => false, restoreB);
    expect(restoreB).toHaveBeenCalledTimes(1);
  });

  it('sin Web Locks repone como antes', async () => {
    const { store } = shared();
    const restore = vi.fn();
    const q = createUploadQueue({
      store: { upload: () => new Promise<void>(() => undefined) },
      projectId: 'p',
      persist: store,
      onFail: vi.fn(),
      sleep,
      locks: null,
    });
    await q.resume(() => false, restore);
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
