import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeEdge, makeNode, type BoardNode } from '../model/board';
import { parseFlowchart } from '../model/mermaid';
import { createBoardStore } from '../store/boardStore';
import { createBoardActions } from './actions';
import {
  clipFromSelection,
  clipMermaid,
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
