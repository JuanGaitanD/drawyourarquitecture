import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeEdge, makeNode, type BoardNode } from '../model/board';
import { parseFlowchart } from '../model/mermaid';
import { createBoardStore } from '../store/boardStore';
import { createBoardActions } from './actions';
import {
  clipFromSelection,
  clipMermaid,
  copyImages,
  parseClip,
  readSystemClipboard,
  writeSystemClipboard,
} from './clipboard';

const node = (kind: 'shape' | 'frame', id: string, x: number, y: number, extra: Partial<BoardNode> = {}) =>
  ({ ...makeNode(kind, { x, y }, kind === 'shape' ? { label: id } : {}), id, width: 100, height: 50, ...extra }) as BoardNode;

const frame = node('frame', 'f', 1000, 500);
const child = node('shape', 'c', 20, 30, { parentId: 'f' });
const loose = node('shape', 'l', 0, 0);
const other = node('shape', 'o', 400, 0);
const edges = [makeEdge('c', 'l'), makeEdge('l', 'o')];

/** Portapapeles del sistema falso; `web` = admite formatos propios («web …»). */
function fakeSystem(web: boolean) {
  class Item {
    types: string[];
    constructor(private data: Record<string, Blob>) {
      if (!web && Object.keys(data).some((k) => k.startsWith('web '))) throw new TypeError('no admitido');
      this.types = Object.keys(data);
    }
    getType = (t: string) => Promise.resolve(this.data[t]!);
  }
  let items: Item[] = [];
  const clipboard = {
    write: (l: Item[]) => ((items = l), Promise.resolve()),
    writeText: (t: string) => ((items = [new Item({ 'text/plain': new Blob([t]) })]), Promise.resolve()),
    read: () => Promise.resolve(items),
    readText: async () => {
      const t = items.find((i) => i.types.includes('text/plain'));
      return t ? await (await t.getType('text/plain')).text() : '';
    },
  };
  vi.stubGlobal('navigator', { clipboard });
  vi.stubGlobal('ClipboardItem', Item);
  return clipboard;
}
const settle = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => vi.unstubAllGlobals());

describe('clipFromSelection', () => {
  const all = [frame, child, loose, other];

  it('un hijo suelto sale como raíz con su posición absoluta y solo con las aristas internas', () => {
    const c = clipFromSelection(all, edges, ['c', 'l']);
    const cc = c.nodes.find((n) => n.id === 'c')!;
    expect(cc.parentId).toBeUndefined();
    expect(cc.position).toEqual({ x: 1020, y: 530 });
    expect(c.edges).toHaveLength(1); // c→l; l→o sale del grupo
  });

  it('copiar un padre incluye a sus descendientes y los mantiene dentro', () => {
    const c = clipFromSelection(all, edges, ['f']);
    expect(c.nodes.map((n) => n.id)).toEqual(['f', 'c']);
    expect(c.nodes.find((n) => n.id === 'c')!.parentId).toBe('f');
  });

  it('no arrastra estado de runtime', () => {
    const sel = { ...loose, selected: true, measured: { width: 1, height: 1 } } as BoardNode;
    expect(JSON.stringify(clipFromSelection([sel], [], ['l']))).not.toMatch(/selected|measured/);
  });
});

describe('parseClip · el portapapeles es entrada externa', () => {
  const good = JSON.stringify(clipFromSelection([loose, other], edges.slice(1), ['l', 'o']));

  it('acepta lo propio', () => {
    expect(parseClip(good)?.nodes).toHaveLength(2);
  });

  it.each([
    ['texto cualquiera', 'hola'],
    ['JSON ajeno', '{"a":1}'],
    ['otra versión', good.replace('"version":1', '"version":2')],
    ['sin nodos', JSON.stringify({ format: 'dya-clipboard', version: 1, nodes: [], edges: [] })],
    ['nodos que no validan', JSON.stringify({ format: 'dya-clipboard', version: 1, nodes: [{ id: 1 }], edges: [] })],
    ['demasiado grande', ' '.repeat(5 * 1024 * 1024)],
  ])('rechaza %s', (_n, text) => expect(parseClip(text)).toBeNull());
});

describe('portapapeles del sistema', () => {
  const clip = clipFromSelection([loose, other], edges.slice(1), ['l', 'o']);

  it('escribe el formato propio y Mermaid; se lee el propio', async () => {
    const sys = fakeSystem(true);
    expect(await writeSystemClipboard(clip)).toBe('full');
    expect(await sys.readText()).toBe(clipMermaid(clip));
    const r = await readSystemClipboard();
    expect(r.kind === 'dya' && r.clip.nodes.map((n) => n.id)).toEqual(['l', 'o']);
  });

  it('sin formatos propios (Firefox, Safari) queda el texto Mermaid y se puede leer como texto', async () => {
    fakeSystem(false);
    expect(await writeSystemClipboard(clip)).toBe('text');
    const r = await readSystemClipboard();
    expect(r.kind).toBe('text');
    expect(r.kind === 'text' && parseFlowchart(r.text).ok).toBe(true);
  });

  it('sin API: no escribe y la lectura dice «no disponible»', async () => {
    vi.stubGlobal('navigator', {});
    expect(await writeSystemClipboard(clip)).toBe('none');
    expect((await readSystemClipboard()).kind).toBe('unavailable');
  });
});

describe('copiar y pegar entre dos editores (pestañas)', () => {
  const editor = () => {
    const s = createBoardStore();
    s.getState().load({ schemaVersion: 1, nodes: [frame, child, loose, other], edges, viewport: { x: 0, y: 0, zoom: 1 } });
    return { s, actions: createBoardActions(s, () => null) };
  };
  const select = (s: ReturnType<typeof createBoardStore>, ...ids: string[]) =>
    s.getState().setNodes((ns) => ns.map((n) => ({ ...n, selected: ids.includes(n.id) })));

  it('lo copiado en una pestaña se pega en otra, con ids nuevos y un solo paso de historial', async () => {
    fakeSystem(true);
    const a = editor();
    const b = createBoardStore();
    const bActions = createBoardActions(b, () => null);
    select(a.s, 'f');
    a.actions.copy();
    await settle();
    await bActions.paste();
    const ns = b.getState().nodes;
    expect(ns).toHaveLength(2);
    expect(ns.map((n) => n.id)).not.toContain('f');
    expect(ns.find((n) => n.data.kind === 'shape')!.parentId).toBe(ns.find((n) => n.data.kind === 'frame')!.id);
    expect(b.temporal.getState().pastStates).toHaveLength(1);
  });

  it('un texto Mermaid del portapapeles se pega como diagrama; otro texto no hace nada', async () => {
    const sys = fakeSystem(true);
    const b = createBoardStore();
    const actions = createBoardActions(b, () => null);
    await sys.writeText('flowchart LR\n  A --> B');
    await actions.paste();
    expect(b.getState().nodes).toHaveLength(2);
    expect(b.getState().edges).toHaveLength(1);
    await sys.writeText('una receta de cocina');
    await actions.paste();
    expect(b.getState().nodes).toHaveLength(2);
  });

  it('sin portapapeles del sistema se pega la copia en memoria', async () => {
    vi.stubGlobal('navigator', {});
    const a = editor();
    select(a.s, 'l');
    a.actions.copy();
    await a.actions.paste();
    expect(a.s.getState().nodes).toHaveLength(5);
  });

  it('el navegador sin formato propio pega exacto en la misma pestaña (copia en memoria)', async () => {
    fakeSystem(false);
    const a = editor();
    select(a.s, 'l');
    a.actions.copy();
    await settle();
    await a.actions.paste();
    expect(a.s.getState().nodes).toHaveLength(5);
  });
});

describe('D28 · pegar entre proyectos copia las imágenes', () => {
  const img = (id: string, fileId: string) =>
    ({ ...makeNode('image', { x: 0, y: 0 }, { fileId, label: id }), id, width: 100, height: 50 }) as BoardNode;
  const nodes = [img('i1', 'a'), img('i2', 'b'), img('i3', 'a')];
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const nowait = () => Promise.resolve();
  const target = (loadFrom: (p: string, f: string) => Promise<Blob>, uploaded: string[] = []) => ({
    projectId: 'destino',
    loadFrom,
    upload: async (id: string) => void uploaded.push(id),
  });
  const fileIds = (ns: BoardNode[]) => ns.map((n) => (n.data.kind === 'image' ? n.data.fileId : undefined));

  it('el portapapeles lleva el proyecto de origen y sobrevive a parseClip', () => {
    const c = clipFromSelection(nodes, [], ['i1'], 'origen');
    expect(c.projectId).toBe('origen');
    expect(parseClip(JSON.stringify(c))?.projectId).toBe('origen');
    expect(clipFromSelection(nodes, [], ['i1']).projectId).toBeUndefined();
  });

  it('baja de origen y sube al destino con ids nuevos; la misma imagen se copia una vez', async () => {
    const loaded: string[] = [];
    const uploaded: string[] = [];
    let n = 0;
    const r = await copyImages(
      { nodes, edges: [], projectId: 'origen' },
      target(async (p, f) => (loaded.push(`${p}/${f}`), png), uploaded),
      { newId: () => `nuevo-${++n}`, wait: nowait },
    );
    expect(loaded.sort()).toEqual(['origen/a', 'origen/b']);
    expect(uploaded.sort()).toEqual(['nuevo-1', 'nuevo-2']);
    expect(r.failed).toBe(0);
    expect(new Set(fileIds(r.nodes).slice(0, 1)).size).toBe(1);
    expect(fileIds(r.nodes)[0]).toBe(fileIds(r.nodes)[2]); // i1 e i3 comparten archivo
    expect(fileIds(r.nodes)).not.toContain('a');
  });

  it('en el mismo proyecto, o sin origen conocido, no copia nada', async () => {
    const loadFrom = vi.fn();
    for (const projectId of ['destino', undefined]) {
      const r = await copyImages({ nodes, edges: [], projectId }, target(loadFrom));
      expect(r.nodes).toBe(nodes);
    }
    expect(loadFrom).not.toHaveBeenCalled();
  });

  it('la imagen que no se puede leer conserva su id y se cuenta; las demás se copian', async () => {
    const r = await copyImages(
      { nodes, edges: [], projectId: 'origen' },
      target(async (_p, f) => {
        if (f === 'b') throw new Error('sin permiso');
        return png;
      }),
      { newId: () => 'nuevo', wait: nowait },
    );
    expect(r.failed).toBe(1);
    expect(fileIds(r.nodes)).toEqual(['nuevo', 'b', 'nuevo']);
  });

  it('pegar en otro proyecto inserta los nodos con el binario ya copiado y avisa de los fallos', async () => {
    const sys = fakeSystem(true);
    void sys;
    const a = createBoardStore();
    a.getState().load({ schemaVersion: 1, nodes: [img('i1', 'a'), img('i2', 'b')], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const origen = createBoardActions(a, () => null, { projectId: 'origen', loadFrom: async () => png, upload: async () => undefined });
    a.getState().setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
    origen.copy();
    await settle();

    const b = createBoardStore();
    const uploaded: string[] = [];
    const failed = vi.fn();
    const destino = createBoardActions(b, () => null, {
      projectId: 'destino',
      loadFrom: async (p, f) => {
        expect(p).toBe('origen');
        if (f === 'b') throw new Error('borrada');
        return png;
      },
      upload: async (id) => void uploaded.push(id),
      onImagesFailed: failed,
    });
    await destino.paste();
    const ids = b.getState().nodes.map((n) => (n.data.kind === 'image' ? n.data.fileId : ''));
    expect(ids).toHaveLength(2);
    expect(uploaded).toHaveLength(1);
    expect(ids).toContain(uploaded[0]);
    expect(ids).toContain('b');
    expect(failed).toHaveBeenCalledWith(1);
    expect(b.temporal.getState().pastStates).toHaveLength(1);
  });
});
