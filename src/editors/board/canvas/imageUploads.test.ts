import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PendingFile, PendingStore } from '@/application/pendingFiles';
import { createBoardStore } from '../store/boardStore';
import { createImageUploads } from './imageUploads';

const blob = new Blob(['x'], { type: 'image/png' });
const meta = { x: 10, y: 20, width: 100, height: 50, label: 'foto.png' };
const settle = () => new Promise((r) => setTimeout(r, 0));

// Sin Web Locks: los casos reutilizan `f1` y la cola retiene el bloqueo hasta `release`; en Node 24 serían reales y se pisarían.
beforeAll(() => void Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));

/** IndexedDB falso: lo que sobrevive a «cerrar la pestaña». */
function fakeDisk(): PendingStore & { files: Map<string, PendingFile> } {
  const files = new Map<string, PendingFile>();
  return {
    files,
    put: async (f) => void files.set(f.fileId, f),
    list: async (p) => [...files.values()].filter((f) => f.projectId === p),
    remove: async (_p, id) => void files.delete(id),
  };
}

function setup(opts: { disk?: PendingStore; fail?: () => boolean; published?: string[] } = {}) {
  const store = createBoardStore();
  const onFail = vi.fn();
  const uploaded: string[] = [];
  const failing = { on: opts.fail ?? (() => false) };
  const uploads = createImageUploads({
    store,
    files: {
      upload: async (_p, id) => {
        if (failing.on()) throw new Error('sin red');
        uploaded.push(id);
      },
    },
    projectId: 'p',
    persist: opts.disk ?? fakeDisk(),
    published: (id) => (opts.published ?? []).includes(id),
    onFail,
    sleep: async () => undefined,
  });
  const images = () => store.getState().nodes.filter((n) => n.data.kind === 'image');
  return { store, uploads, onFail, uploaded, images };
}

describe('D23 · imágenes del board en cola con copia en disco', () => {
  it('el nodo entra al confirmarse la subida y la copia en disco se borra al guardar el contenido con él', async () => {
    const disk = fakeDisk();
    const s = setup({ disk });
    s.uploads.add('f1', blob, meta);
    await settle();
    const [n] = s.images();
    expect(n?.data.fileId).toBe('f1');
    expect([n?.position, n?.width, n?.height]).toEqual([{ x: 10, y: 20 }, 100, 50]);
    expect(disk.files.has('f1')).toBe(true); // aún no está guardado en el contenido
    s.uploads.saved('{"sin":"la imagen"}');
    await settle();
    expect(disk.files.has('f1')).toBe(true);
    s.uploads.saved(JSON.stringify(s.store.getState().nodes));
    await settle();
    expect(disk.files.has('f1')).toBe(false);
  });

  it('si los reintentos se agotan no hay nodo, el binario sigue en disco y retryFailed lo sube', async () => {
    const disk = fakeDisk();
    let down = true;
    const s = setup({ disk, fail: () => down });
    s.uploads.add('f1', blob, meta);
    await settle();
    expect(s.onFail).toHaveBeenCalledTimes(1);
    expect(s.images()).toHaveLength(0);
    expect(disk.files.has('f1')).toBe(true);
    down = false; // vuelve la conexión
    s.uploads.retryFailed();
    await settle();
    expect(s.images()).toHaveLength(1);
    expect(s.uploaded).toEqual(['f1']);
  });

  it('al volver a montar se repone lo que quedó en disco: se sube y el nodo aparece con su posición', async () => {
    const disk = fakeDisk();
    await disk.put({ projectId: 'p', fileId: 'viejo', blob, meta });
    await disk.put({ projectId: 'p', fileId: 'ya', blob, meta });
    const s = setup({ disk, published: ['ya'] }); // 'ya' ya va en el contenido cargado
    await s.uploads.resume();
    await settle();
    expect(s.uploaded).toEqual(['viejo']);
    const [n] = s.images();
    expect([n?.data.fileId, n?.position]).toEqual(['viejo', { x: 10, y: 20 }]);
    expect(disk.files.has('ya')).toBe(false); // solo se limpió
  });

  it('un meta corrupto en disco no rompe la reposición', async () => {
    const disk = fakeDisk();
    await disk.put({ projectId: 'p', fileId: 'raro', blob, meta: { x: 'a', width: NaN } });
    const s = setup({ disk });
    await s.uploads.resume();
    await settle();
    expect(s.images()).toHaveLength(1);
    expect(s.images()[0]?.width).toBe(240);
  });

  it('si el nodo se borra antes de guardar, la copia en disco se libera igualmente', async () => {
    const disk = fakeDisk();
    const s = setup({ disk });
    s.uploads.add('f1', blob, meta);
    await settle();
    s.store.getState().setNodes(() => []);
    s.uploads.saved('{}');
    await settle();
    expect(disk.files.has('f1')).toBe(false);
  });
});
