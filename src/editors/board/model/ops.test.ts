import { describe, expect, it } from 'vitest';
import { makeEdge, makeNode, type BoardNode } from './board';
import { fixtureBoard } from './fixtures';
import { toAbsolute } from './geometry';
import {
  align,
  bringToFront,
  distribute,
  duplicate,
  nudge,
  patchStyle,
  rootsOf,
  selectOnly,
  sendToBack,
  setLocked,
  wrapInFrame,
  type AlignMode,
} from './ops';
import { validateBoardContent } from './validate';

/** Nodo con id, posición y tamaño fijos (sin medir) para razonar con números redondos. */
function n(id: string, x: number, y: number, w = 100, h = 50, parentId?: string): BoardNode {
  const node = { ...makeNode('shape', { x, y }), id, width: w, height: h };
  if (parentId) node.parentId = parentId;
  return node;
}
const ids = (nodes: readonly BoardNode[]) => nodes.map((x) => x.id);
const pos = (nodes: readonly BoardNode[], id: string) => nodes.find((x) => x.id === id)!.position;
const abs = (nodes: readonly BoardNode[], id: string) =>
  toAbsolute(
    nodes.find((x) => x.id === id)!,
    nodes,
  );

describe('align', () => {
  // a: x 0..100 y 0..50 · b: x 200..260 y 100..220 (60×120) · c: x 50..250 y 300..330 (200×30)
  const base = () => [n('a', 0, 0), n('b', 200, 100, 60, 120), n('c', 50, 300, 200, 30)];

  const casos: [AlignMode, Record<string, { x?: number; y?: number }>][] = [
    ['left', { a: { x: 0 }, b: { x: 0 }, c: { x: 0 } }],
    ['right', { a: { x: 160 }, b: { x: 200 }, c: { x: 60 } }],
    ['center', { a: { x: 80 }, b: { x: 100 }, c: { x: 30 } }],
    ['top', { a: { y: 0 }, b: { y: 0 }, c: { y: 0 } }],
    ['bottom', { a: { y: 280 }, b: { y: 210 }, c: { y: 300 } }],
    ['middle', { a: { y: 140 }, b: { y: 105 }, c: { y: 150 } }],
  ];
  it.each(casos)('%s', (mode, esperado) => {
    const out = align(base(), ['a', 'b', 'c'], mode);
    for (const [id, p] of Object.entries(esperado)) {
      expect(abs(out, id).x).toBe(p.x ?? abs(base(), id).x);
      expect(abs(out, id).y).toBe(p.y ?? abs(base(), id).y);
    }
  });

  it('no muta la entrada ni los nodos que no participan', () => {
    const input = base();
    const snapshot = structuredClone(input);
    const out = align(input, ['a', 'b'], 'left');
    expect(input).toEqual(snapshot);
    expect(out).not.toBe(input);
    expect(out[2]).toBe(input[2]);
  });

  it('con menos de dos nodos no cambia nada', () => {
    const input = base();
    expect(align(input, ['a'], 'left')).toEqual(input);
    expect(align(input, [], 'left')).toEqual(input);
  });

  it('alinea en absolutas y guarda relativas: hijos de distintos padres', () => {
    // frame f1 en (100,100); hijo h1 en relativa (10,10) → absoluta (110,110). Suelto s en (500,0).
    const nodes = [n('f1', 100, 100, 300, 300), n('h1', 10, 10, 50, 50, 'f1'), n('s', 500, 0, 50, 50)];
    const out = align(nodes, ['h1', 's'], 'left');
    expect(abs(out, 'h1').x).toBe(110);
    expect(abs(out, 's').x).toBe(110);
    expect(pos(out, 'h1')).toEqual({ x: 10, y: 10 }); // sin cambios: ya estaba en el borde izquierdo
    expect(pos(out, 's')).toEqual({ x: 110, y: 0 });
    const arriba = align(nodes, ['h1', 's'], 'top');
    expect(abs(arriba, 'h1').y).toBe(0);
    expect(pos(arriba, 'h1')).toEqual({ x: 10, y: -100 }); // relativa al padre
  });

  it('un hijo cuyo padre también está seleccionado no se mueve dos veces', () => {
    const nodes = [n('p', 100, 100, 200, 200), n('c', 20, 20, 50, 50, 'p'), n('x', 0, 0, 50, 50)];
    const out = align(nodes, ['p', 'c', 'x'], 'left');
    expect(abs(out, 'p').x).toBe(0);
    expect(pos(out, 'c')).toEqual({ x: 20, y: 20 });
    expect(abs(out, 'c').x).toBe(20);
  });

  it('los bloqueados ni se mueven ni cuentan para los límites', () => {
    const nodes = [
      n('a', 100, 0),
      n('b', 300, 0),
      { ...n('l', -500, 0), data: { ...n('l', 0, 0).data, locked: true } },
    ];
    const out = align(nodes, ['a', 'b', 'l'], 'left');
    expect(abs(out, 'a').x).toBe(100);
    expect(abs(out, 'b').x).toBe(100);
    expect(abs(out, 'l').x).toBe(-500);
  });

  it('usa el tamaño medido si existe', () => {
    const nodes = [
      n('a', 0, 0, 100, 50),
      { ...n('b', 0, 100, 100, 50), measured: { width: 40, height: 50 } },
    ];
    expect(abs(align(nodes, ['a', 'b'], 'right'), 'b').x).toBe(60);
  });
});

describe('distribute', () => {
  // x: a 0..50, b 60..110 (50 de ancho), c 300..400 (100 de ancho) → total 200, hueco (400-0-200)/2 = 100
  const base = () => [n('a', 0, 0, 50, 50), n('b', 60, 0, 50, 50), n('c', 300, 0, 100, 50)];

  it('x: huecos iguales entre el primero y el último', () => {
    const out = distribute(base(), ['a', 'b', 'c'], 'x');
    expect(abs(out, 'a').x).toBe(0);
    expect(abs(out, 'b').x).toBe(150);
    expect(abs(out, 'c').x).toBe(300);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => abs(out, id).x);
    expect(b - (a + 50)).toBe(c - (b + 50));
  });

  it('y: ordena por posición aunque el array vaya desordenado', () => {
    const nodes = [n('c', 0, 300, 50, 100), n('a', 0, 0, 50, 50), n('b', 0, 60, 50, 50)];
    const out = distribute(nodes, ['a', 'b', 'c'], 'y');
    expect(abs(out, 'a').y).toBe(0);
    expect(abs(out, 'b').y).toBe(150);
    expect(abs(out, 'c').y).toBe(300);
    expect(ids(out)).toEqual(['c', 'a', 'b']); // el orden Z no cambia
  });

  it('no toca el otro eje', () => {
    const nodes = [n('a', 0, 5), n('b', 60, 7), n('c', 400, 9)];
    const out = distribute(nodes, ['a', 'b', 'c'], 'x');
    expect(['a', 'b', 'c'].map((id) => abs(out, id).y)).toEqual([5, 7, 9]);
  });

  it('con menos de tres nodos no cambia nada', () => {
    const input = base();
    expect(distribute(input, ['a', 'b'], 'x')).toEqual(input);
  });

  it('distribuye hijos de un frame en absolutas y guarda relativas', () => {
    const nodes = [
      n('f', 1000, 1000, 600, 100),
      n('a', 0, 0, 50, 50, 'f'),
      n('b', 10, 0, 50, 50, 'f'),
      n('c', 250, 0, 50, 50, 'f'),
    ];
    const out = distribute(nodes, ['a', 'b', 'c'], 'x');
    expect(pos(out, 'b')).toEqual({ x: 125, y: 0 });
    expect(abs(out, 'b').x).toBe(1125);
  });
});

describe('orden Z', () => {
  it('bringToFront lleva la selección al final conservando su orden relativo', () => {
    const nodes = [n('a', 0, 0), n('b', 0, 0), n('c', 0, 0), n('d', 0, 0)];
    expect(ids(bringToFront(nodes, ['b', 'a']))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('sendToBack lleva la selección al principio conservando su orden relativo', () => {
    const nodes = [n('a', 0, 0), n('b', 0, 0), n('c', 0, 0), n('d', 0, 0)];
    expect(ids(sendToBack(nodes, ['d', 'c']))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('un padre al frente arrastra a sus hijos y va antes que ellos', () => {
    const nodes = [n('f', 0, 0), n('h1', 0, 0, 10, 10, 'f'), n('h2', 0, 0, 10, 10, 'f'), n('x', 0, 0)];
    const out = ids(bringToFront(nodes, ['f']));
    expect(out).toEqual(['x', 'f', 'h1', 'h2']);
  });

  it('un hijo al frente queda después de su padre', () => {
    const nodes = [n('f', 0, 0), n('h', 0, 0, 10, 10, 'f'), n('x', 0, 0)];
    expect(ids(bringToFront(nodes, ['h']))).toEqual(['f', 'x', 'h']);
  });

  it('un hijo al fondo no pasa por detrás de su padre: el padre va con él', () => {
    const nodes = [n('x', 0, 0), n('f', 0, 0), n('h', 0, 0, 10, 10, 'f')];
    expect(ids(sendToBack(nodes, ['h']))).toEqual(['f', 'h', 'x']);
  });

  it('un padre al fondo arrastra a sus hijos', () => {
    const nodes = [n('x', 0, 0), n('f', 0, 0), n('h', 0, 0, 10, 10, 'f'), n('y', 0, 0)];
    expect(ids(sendToBack(nodes, ['f']))).toEqual(['f', 'h', 'x', 'y']);
  });

  it('sobre el fixture los padres siguen primero en ambos sentidos', () => {
    const nodes = fixtureBoard().nodes;
    for (const out of [
      bringToFront(nodes, ['api']),
      sendToBack(nodes, ['db', 'note']),
      bringToFront(nodes, ['frame', 'title']),
    ]) {
      expect(ids(out).sort()).toEqual(ids(nodes).sort());
      const at = (id: string) => ids(out).indexOf(id);
      expect(at('frame')).toBeLessThan(at('api'));
      expect(at('frame')).toBeLessThan(at('db'));
    }
  });

  it('ids inexistentes o vacíos no cambian el orden', () => {
    const nodes = [n('a', 0, 0), n('b', 0, 0)];
    expect(ids(bringToFront(nodes, []))).toEqual(['a', 'b']);
    expect(ids(sendToBack(nodes, ['zzz']))).toEqual(['a', 'b']);
  });
});

describe('wrapInFrame', () => {
  it('rodea la selección con padding 32 y la reparenta conservando la posición visual', () => {
    const nodes = [n('a', 100, 100, 100, 50), n('b', 300, 200, 100, 50), n('z', 900, 900)];
    const { nodes: out, frameId } = wrapInFrame(nodes, ['a', 'b']);
    const frame = out.find((x) => x.id === frameId)!;
    expect(frame.type).toBe('frame');
    expect(frame.data.kind).toBe('frame');
    expect(frame.position).toEqual({ x: 68, y: 68 });
    expect(frame.width).toBe(300 + 64); // 100..400 + 2·32
    expect(frame.height).toBe(150 + 64); // 100..250 + 2·32
    expect(frame.parentId).toBeUndefined();
    expect(pos(out, 'a')).toEqual({ x: 32, y: 32 });
    expect(pos(out, 'b')).toEqual({ x: 232, y: 132 });
    expect(abs(out, 'a')).toEqual({ x: 100, y: 100 });
    expect(abs(out, 'b')).toEqual({ x: 300, y: 200 });
    expect(out.find((x) => x.id === 'a')!.parentId).toBe(frameId);
    expect(out.find((x) => x.id === 'z')).toBe(nodes[2]);
  });

  it('el frame va justo antes del primer seleccionado y los padres siempre primero', () => {
    const nodes = [n('p', 0, 0), n('a', 100, 100), n('q', 0, 0), n('b', 300, 300)];
    const { nodes: out, frameId } = wrapInFrame(nodes, ['b', 'a']);
    expect(ids(out)).toEqual(['p', frameId, 'a', 'q', 'b']);
  });

  it('acepta otro padding', () => {
    const { nodes: out, frameId } = wrapInFrame([n('a', 0, 0, 100, 50)], ['a'], 10);
    const frame = out.find((x) => x.id === frameId)!;
    expect(frame.position).toEqual({ x: -10, y: -10 });
    expect(frame.width).toBe(120);
    expect(frame.height).toBe(70);
  });

  it('con un padre común, el frame vive dentro de él con posición relativa', () => {
    const nodes = [
      n('f', 1000, 1000, 800, 800),
      n('a', 100, 100, 100, 50, 'f'),
      n('b', 300, 100, 100, 50, 'f'),
    ];
    const { nodes: out, frameId } = wrapInFrame(nodes, ['a', 'b']);
    const frame = out.find((x) => x.id === frameId)!;
    expect(frame.parentId).toBe('f');
    expect(frame.position).toEqual({ x: 68, y: 68 });
    expect(abs(out, 'a')).toEqual({ x: 1100, y: 1100 });
    expect(ids(out).indexOf('f')).toBeLessThan(ids(out).indexOf(frameId));
  });

  it('con padres distintos, el frame va al nivel superior', () => {
    const nodes = [n('f', 1000, 0, 400, 400), n('a', 10, 10, 50, 50, 'f'), n('s', 0, 0, 50, 50)];
    const { nodes: out, frameId } = wrapInFrame(nodes, ['a', 's']);
    expect(out.find((x) => x.id === frameId)!.parentId).toBeUndefined();
    expect(abs(out, 'a')).toEqual({ x: 1010, y: 10 });
    expect(abs(out, 's')).toEqual({ x: 0, y: 0 });
  });

  it('los hijos de un seleccionado no se reparentan: viajan con su padre', () => {
    const nodes = [n('p', 50, 50, 200, 200), n('c', 20, 20, 50, 50, 'p')];
    const { nodes: out, frameId } = wrapInFrame(nodes, ['p', 'c']);
    expect(out.find((x) => x.id === 'c')!.parentId).toBe('p');
    expect(out.find((x) => x.id === 'p')!.parentId).toBe(frameId);
    expect(abs(out, 'c')).toEqual({ x: 70, y: 70 });
  });

  it('el resultado valida contra validateBoardContent', () => {
    const board = fixtureBoard();
    const { nodes } = wrapInFrame(board.nodes, ['user', 'title']);
    expect(validateBoardContent({ ...board, nodes }).ok).toBe(true);
  });

  it('lanza con la selección vacía', () => {
    expect(() => wrapInFrame([n('a', 0, 0)], [])).toThrow(RangeError);
  });
});

describe('duplicate', () => {
  it('duplica un nodo suelto: id nuevo, desplazado, seleccionado, sin tocar el original', () => {
    const board = fixtureBoard();
    const snapshot = structuredClone(board);
    const { nodes, edges } = duplicate(board.nodes, board.edges, ['note']);
    expect(board).toEqual(snapshot);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
    expect(nodes[0].id).not.toBe('note');
    expect(nodes[0].position).toEqual({ x: 116, y: 516 });
    expect(nodes[0].selected).toBe(true);
    expect(nodes[0].data).toEqual(board.nodes.find((x) => x.id === 'note')!.data);
    expect(nodes[0].data).not.toBe(board.nodes.find((x) => x.id === 'note')!.data);
    expect(nodes[0].data.style).not.toBe(board.nodes.find((x) => x.id === 'note')!.data.style);
  });

  it('acepta un offset propio', () => {
    const board = fixtureBoard();
    const { nodes } = duplicate(board.nodes, board.edges, ['note'], { x: 0, y: 0 });
    expect(nodes[0].position).toEqual({ x: 100, y: 500 });
  });

  it('un frame arrastra a sus hijos: remapea parentId y mantiene posiciones relativas', () => {
    const board = fixtureBoard();
    const { nodes } = duplicate(board.nodes, board.edges, ['frame']);
    expect(nodes).toHaveLength(3);
    const [frame, ...kids] = nodes;
    expect(frame.data.kind).toBe('frame');
    expect(frame.position).toEqual({ x: 116, y: 116 });
    expect(kids.every((k) => k.parentId === frame.id)).toBe(true);
    expect(kids.map((k) => k.position)).toEqual([
      { x: 40, y: 60 },
      { x: 280, y: 60 },
    ]); // relativas: no se desplazan, viajan con el frame
    const all = new Set(nodes.map((x) => x.id));
    expect(all.size).toBe(3);
    for (const id of ['frame', 'api', 'db']) expect(all.has(id)).toBe(false);
  });

  it('duplica solo las aristas internas, con extremos remapeados y datos copiados', () => {
    const board = fixtureBoard();
    const { nodes, edges } = duplicate(board.nodes, board.edges, ['frame']);
    // api→db (interna); user→api y note→frame cruzan la selección y se descartan.
    expect(edges).toHaveLength(1);
    const [e] = edges;
    const api = nodes.find((x) => x.data.label === 'API')!;
    const db = nodes.find((x) => x.data.label === 'Base de datos')!;
    expect(e.source).toBe(api.id);
    expect(e.target).toBe(db.id);
    expect(e.id).not.toBe('e-api-db');
    expect(e.type).toBe('labeled');
    expect(e.data).toEqual(board.edges.find((x) => x.id === 'e-api-db')!.data);
    expect(e.data).not.toBe(board.edges.find((x) => x.id === 'e-api-db')!.data);
  });

  it('seleccionar nodos sueltos con una arista entre ellos la duplica', () => {
    const board = fixtureBoard();
    const { nodes, edges } = duplicate(board.nodes, board.edges, ['user', 'api']);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0].data?.label).toBe('HTTPS');
    expect(nodes.map((x) => x.id)).toContain(edges[0].source);
    expect(nodes.map((x) => x.id)).toContain(edges[0].target);
  });

  it('un hijo seleccionado sin su padre conserva el parentId original y se desplaza', () => {
    const board = fixtureBoard();
    const { nodes } = duplicate(board.nodes, board.edges, ['api']);
    expect(nodes[0].parentId).toBe('frame');
    expect(nodes[0].position).toEqual({ x: 56, y: 76 });
  });

  it('lo duplicado, añadido al board, sigue validando', () => {
    const board = fixtureBoard();
    const dup = duplicate(board.nodes, board.edges, ['frame', 'user', 'note']);
    const merged = { ...board, nodes: [...board.nodes, ...dup.nodes], edges: [...board.edges, ...dup.edges] };
    expect(validateBoardContent(merged)).toMatchObject({ ok: true });
    expect(dup.nodes.length).toBe(5);
    expect(dup.edges).toHaveLength(3); // user→api, api→db y note→frame: los dos extremos están incluidos
  });

  it('descarta el estado de interacción (dragging, measured) del original', () => {
    const a = { ...n('a', 0, 0), selected: false, dragging: true, measured: { width: 9, height: 9 } };
    const { nodes } = duplicate([a], [], ['a']);
    expect(nodes[0].dragging).toBeUndefined();
    expect(nodes[0].measured).toBeUndefined();
    expect(nodes[0].selected).toBe(true);
  });

  it('una arista entre dos duplicados con el mismo origen no se une a nodos no duplicados', () => {
    const a = n('a', 0, 0);
    const b = n('b', 200, 0);
    const c = n('c', 400, 0);
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    expect(duplicate([a, b, c], edges, ['a', 'b']).edges).toHaveLength(1);
  });
});

describe('nudge, patchStyle, setLocked, selectOnly, rootsOf', () => {
  it('nudge mueve solo los raíz y no los bloqueados', () => {
    const locked = { ...n('l', 0, 0), data: { ...n('l', 0, 0).data, locked: true } };
    const nodes = [n('p', 10, 10, 100, 100), n('c', 5, 5, 20, 20, 'p'), locked];
    const out = nudge(nodes, ['p', 'c', 'l'], 10, -1);
    expect(pos(out, 'p')).toEqual({ x: 20, y: 9 });
    expect(pos(out, 'c')).toEqual({ x: 5, y: 5 });
    expect(pos(out, 'l')).toEqual({ x: 0, y: 0 });
  });

  it('patchStyle fusiona sin pisar el resto del estilo de cada nodo', () => {
    const a = n('a', 0, 0);
    const b = {
      ...n('b', 0, 0),
      data: { ...n('b', 0, 0).data, style: { ...n('b', 0, 0).data.style, fontSize: 30 } },
    };
    const out = patchStyle([a, b], ['a', 'b'], { fill: '#ff0000' });
    expect(out[0].data.style.fill).toBe('#ff0000');
    expect(out[1].data.style.fontSize).toBe(30);
    expect(out[1].data.style.fill).toBe('#ff0000');
    expect(patchStyle([a, b], ['a'], { bold: true })[1]).toBe(b);
  });

  it('setLocked bloquea, desbloquea y admite «all»', () => {
    const nodes = [n('a', 0, 0), n('b', 0, 0)];
    const l = setLocked(nodes, ['a'], true);
    expect(l[0].data.locked).toBe(true);
    expect(l[1]).toBe(nodes[1]);
    expect(setLocked(l, 'all', false).every((x) => !x.data.locked)).toBe(true);
    expect(setLocked(l, ['a'], true)[0]).toBe(l[0]);
  });

  it('selectOnly deja seleccionados exactamente los ids', () => {
    const nodes = [{ ...n('a', 0, 0), selected: true }, n('b', 0, 0)];
    const out = selectOnly(nodes, ['b']);
    expect(out.map((x) => !!x.selected)).toEqual([false, true]);
  });

  it('rootsOf ignora ancestros no seleccionados y aguanta ciclos', () => {
    const nodes = [n('p', 0, 0), n('c', 0, 0, 10, 10, 'p'), n('g', 0, 0, 10, 10, 'c')];
    expect(ids(rootsOf(nodes, ['c', 'g']))).toEqual(['c']);
    expect(ids(rootsOf(nodes, ['p', 'g']))).toEqual(['p']);
    const ciclo = [n('x', 0, 0, 10, 10, 'y'), n('y', 0, 0, 10, 10, 'x')];
    expect(ids(rootsOf(ciclo, ['x']))).toEqual(['x']);
  });
});
