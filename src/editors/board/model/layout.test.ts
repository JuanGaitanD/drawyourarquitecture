import { describe, expect, it } from 'vitest';
import { emptyBoard, makeEdge, makeNode, type BoardContent, type BoardNode } from './board';
import { fixtureBoard } from './fixtures';
import { toAbsolute, nodeSize } from './geometry';
import { FRAME_HEADER, FRAME_PADDING, autoLayout } from './layout';
import { parseFlowchart } from './mermaid';
import { validateBoardContent } from './validate';

const node = (id: string, x = 0, y = 0, partial: Partial<BoardNode['data']> = {}): BoardNode => ({
  ...makeNode('shape', { x, y }, { label: id, ...partial }),
  id,
});
const edge = (s: string, t: string) => ({ ...makeEdge(s, t), id: `${s}-${t}` });
const board = (nodes: BoardNode[], edges: ReturnType<typeof edge>[] = []): BoardContent => ({
  ...emptyBoard(),
  nodes,
  edges,
});
const abs = (c: BoardContent, id: string) => {
  const n = c.nodes.find((x) => x.id === id) as BoardNode;
  return { ...toAbsolute(n, c.nodes), ...nodeSize(n) };
};
const overlap = (a: ReturnType<typeof abs>, b: ReturnType<typeof abs>) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('autoLayout', () => {
  it('LR: cada nodo queda a la derecha de su origen; TB: debajo', async () => {
    const c = board([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c')]);
    const lr = await autoLayout(c, 'LR');
    expect(abs(lr, 'a').x).toBeLessThan(abs(lr, 'b').x);
    expect(abs(lr, 'b').x).toBeLessThan(abs(lr, 'c').x);
    const tb = await autoLayout(c, 'TB');
    expect(abs(tb, 'a').y).toBeLessThan(abs(tb, 'b').y);
    expect(abs(tb, 'b').y).toBeLessThan(abs(tb, 'c').y);
  });

  it('no mueve nada fuera del contrato: no muta la entrada y conserva datos, viewport y ids', async () => {
    const c = board([node('a', 500, 500), node('b', 9, 9)], [edge('a', 'b')]);
    const snapshot = JSON.stringify(c);
    const out = await autoLayout(c, 'LR');
    expect(JSON.stringify(c)).toBe(snapshot);
    expect(out.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(out.nodes[0]?.data).toEqual(c.nodes[0]?.data);
    expect(out.viewport).toEqual(c.viewport);
    expect(out.edges.map((e) => e.id)).toEqual(['a-b']);
  });

  it('los nodos sueltos no se solapan', async () => {
    const nodes = Array.from({ length: 9 }, (_, i) => node(`n${i}`));
    const out = await autoLayout(board(nodes), 'LR');
    for (const a of out.nodes)
      for (const b of out.nodes) if (a !== b) expect(overlap(abs(out, a.id), abs(out, b.id))).toBe(false);
  });

  it('conserva la esquina superior izquierda del tablero (no «salta»)', async () => {
    const out = await autoLayout(board([node('a', 300, 200), node('b', 700, 200)], [edge('a', 'b')]), 'LR');
    const xs = out.nodes.map((n) => n.position.x);
    const ys = out.nodes.map((n) => n.position.y);
    expect(Math.min(...xs)).toBe(300);
    expect(Math.min(...ys)).toBe(200);
  });

  it('asas según el flujo: LR r→l, TB b→t; una arista hacia atrás invierte las asas', async () => {
    const c = board([node('a'), node('b')], [edge('a', 'b')]);
    const lr = await autoLayout(c, 'LR');
    expect(lr.edges[0]).toMatchObject({ sourceHandle: 'r', targetHandle: 'l' });
    const tb = await autoLayout(c, 'TB');
    expect(tb.edges[0]).toMatchObject({ sourceHandle: 'b', targetHandle: 't' });
    const cycle = await autoLayout(board([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]), 'LR');
    const handles = cycle.edges.map((e) => `${e.sourceHandle}${e.targetHandle}`).sort();
    expect(handles).toEqual(['lr', 'rl']);
  });

  it('ciclos, autoaristas y aristas duplicadas no rompen el layout', async () => {
    const out = await autoLayout(
      board(
        [node('a'), node('b')],
        [edge('a', 'b'), { ...edge('a', 'b'), id: 'dup' }, edge('b', 'a'), edge('a', 'a')],
      ),
      'LR',
    );
    expect(validateBoardContent(out).ok).toBe(true);
  });

  it('contenido vacío y un solo nodo', async () => {
    expect((await autoLayout(emptyBoard(), 'LR')).nodes).toEqual([]);
    const one = await autoLayout(board([node('a', 40, 50)]), 'TB');
    expect(one.nodes[0]?.position).toEqual({ x: 40, y: 50 });
  });
});

describe('autoLayout · frames', () => {
  it('el frame se dimensiona con sus hijos (relleno y cabecera) y los hijos salen en relativas', async () => {
    const out = await autoLayout(fixtureBoard(), 'LR');
    const frame = out.nodes.find((n) => n.id === 'frame') as BoardNode;
    const api = out.nodes.find((n) => n.id === 'api') as BoardNode;
    const db = out.nodes.find((n) => n.id === 'db') as BoardNode;
    expect(api.parentId).toBe('frame');
    // Relativas: están dentro del tamaño del frame, no en coordenadas de tablero.
    for (const child of [api, db]) {
      expect(child.position.x).toBeGreaterThanOrEqual(FRAME_PADDING);
      expect(child.position.y).toBeGreaterThanOrEqual(FRAME_PADDING + FRAME_HEADER);
      expect(child.position.x + (child.width ?? 0)).toBeLessThanOrEqual(
        (frame.width ?? 0) - FRAME_PADDING + 0.001,
      );
      expect(child.position.y + (child.height ?? 0)).toBeLessThanOrEqual(
        (frame.height ?? 0) - FRAME_PADDING + 0.001,
      );
    }
    // El frame es lo bastante pequeño: no conserva el 480×320 por defecto de makeNode.
    const widest = Math.max(...[api, db].map((c) => c.position.x + (c.width ?? 0)));
    expect(frame.width).toBe(widest + FRAME_PADDING);
  });

  it('los padres siguen antes que los hijos y el resultado valida', async () => {
    const out = await autoLayout(fixtureBoard(), 'TB');
    expect(validateBoardContent(out).ok).toBe(true);
    const order = out.nodes.map((n) => n.id);
    expect(order.indexOf('frame')).toBeLessThan(order.indexOf('api'));
  });

  it('tolera aristas con un frame como extremo (note → frame del fixture)', async () => {
    const out = await autoLayout(fixtureBoard(), 'LR');
    expect(out.edges.find((e) => e.id === 'e-note-frame')).toBeDefined();
  });

  it('una arista que cruza hacia un nodo dentro de un frame ordena el frame respecto al externo', async () => {
    const out = await autoLayout(fixtureBoard(), 'LR');
    // user → api (dentro de frame): user queda a la izquierda del frame.
    expect(abs(out, 'user').x + abs(out, 'user').width).toBeLessThan(abs(out, 'frame').x);
    // Dentro del frame: api → db.
    expect(abs(out, 'api').x).toBeLessThan(abs(out, 'db').x);
  });

  it('los nodos raíz y los frames no se solapan entre sí', async () => {
    const out = await autoLayout(fixtureBoard(), 'LR');
    const roots = out.nodes.filter((n) => !n.parentId);
    for (const a of roots)
      for (const b of roots) if (a !== b) expect(overlap(abs(out, a.id), abs(out, b.id))).toBe(false);
  });

  it('frames anidados: el exterior contiene al interior', async () => {
    const parsed = parseFlowchart(
      ['flowchart LR', 'subgraph a[A]', 'subgraph b[B]', 'X --> Y', 'end', 'Z', 'end', 'X --> Z'].join('\n'),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const out = await autoLayout(parsed.value, parsed.direction);
    expect(validateBoardContent(out).ok).toBe(true);
    const ids = new Map(out.nodes.map((n) => [n.data.label, n.id]));
    const [a, b, x, z] = ['A', 'B', 'X', 'Z'].map((l) => abs(out, ids.get(l) as string)) as [
      ReturnType<typeof abs>,
      ReturnType<typeof abs>,
      ReturnType<typeof abs>,
      ReturnType<typeof abs>,
    ];
    const inside = (inner: typeof a, outer: typeof a) =>
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height;
    expect(inside(b, a)).toBe(true);
    expect(inside(x, b)).toBe(true);
    expect(inside(z, a)).toBe(true);
    expect(overlap(b, z)).toBe(false);
  });

  it('un frame sin hijos conserva su tamaño', async () => {
    const f = { ...makeNode('frame', { x: 0, y: 0 }, { label: 'vacío' }), id: 'f' };
    const out = await autoLayout(board([f, node('a')]), 'LR');
    const nf = out.nodes.find((n) => n.id === 'f');
    expect({ w: nf?.width, h: nf?.height }).toEqual({ w: f.width, h: f.height });
  });
});
