import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIZE,
  ICONS,
  SHAPES,
  STICKY_COLORS,
  emptyBoard,
  makeEdge,
  makeNode,
  type BoardNode,
  type NodeKind,
} from './board';
import { fixtureBoard, fixtureNode } from './fixtures';
import { descendantsOf, nodeAtPoint, nodeSize, sortParentsFirst, toAbsolute, toRelative } from './geometry';
import { MAX_EDGES, MAX_NODES, validateBoardContent } from './validate';

describe('makeNode / makeEdge', () => {
  it.each(['shape', 'text', 'sticky', 'frame', 'icon', 'image'] as NodeKind[])(
    'makeNode(%s) fija type = data.kind, tamaño y estilo',
    (kind) => {
      const n = makeNode(kind, { x: 5, y: 6 });
      expect(n.type).toBe(kind);
      expect(n.data.kind).toBe(kind);
      expect(n.position).toEqual({ x: 5, y: 6 });
      expect({ width: n.width, height: n.height }).toEqual(DEFAULT_SIZE[kind]);
      expect(n.data.style.fontSize).toBeGreaterThan(0);
      expect(n.id).toMatch(/^[\w-]{21}$/);
    },
  );

  it('genera ids distintos', () => {
    expect(makeNode('shape', { x: 0, y: 0 }).id).not.toBe(makeNode('shape', { x: 0, y: 0 }).id);
  });

  it('las formas y los iconos tienen valor por defecto y se pueden elegir', () => {
    expect(makeNode('shape', { x: 0, y: 0 }).data.shape).toBe('rectangle');
    expect(makeNode('shape', { x: 0, y: 0 }, { shape: 'cloud' }).data.shape).toBe('cloud');
    expect(makeNode('icon', { x: 0, y: 0 }).data.icon).toBe('server');
    expect(makeNode('text', { x: 0, y: 0 }).data.shape).toBeUndefined();
  });

  it('mezcla el estilo parcial sobre el estilo por defecto del tipo', () => {
    const n = makeNode(
      'sticky',
      { x: 0, y: 0 },
      { label: 'hola', style: { fill: STICKY_COLORS.blue } as BoardNode['data']['style'] },
    );
    expect(n.data.label).toBe('hola');
    expect(n.data.style.fill).toBe(STICKY_COLORS.blue);
    expect(n.data.style.fontSize).toBe(14);
  });

  it('makeEdge crea una arista labeled con handles y datos por defecto', () => {
    const e = makeEdge('a', 'b');
    expect(e.type).toBe('labeled');
    expect(e).toMatchObject({ source: 'a', target: 'b', sourceHandle: 'r', targetHandle: 'l' });
    expect(e.data).toMatchObject({ path: 'bezier', markerEnd: true, markerStart: false, dashed: false });
  });

  it('makeEdge respeta lo que se le pasa', () => {
    const e = makeEdge('a', 'b', {
      label: 'x',
      path: 'step',
      sourceHandle: 't',
      targetHandle: 'b',
      markerStart: true,
    });
    expect(e.sourceHandle).toBe('t');
    expect(e.targetHandle).toBe('b');
    expect(e.data).toMatchObject({ label: 'x', path: 'step', markerStart: true });
  });

  it('el catálogo cumple el contrato', () => {
    expect(SHAPES).toHaveLength(14);
    expect(ICONS).toHaveLength(15);
    expect(Object.keys(STICKY_COLORS)).toHaveLength(16);
    expect(emptyBoard()).toEqual({
      schemaVersion: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
  });
});

describe('geometry', () => {
  const { nodes } = fixtureBoard();

  it('toAbsolute suma la posición de los padres', () => {
    expect(toAbsolute(fixtureNode('api'), nodes)).toEqual({ x: 140, y: 160 });
    expect(toAbsolute(fixtureNode('frame'), nodes)).toEqual({ x: 100, y: 100 });
    expect(toAbsolute(fixtureNode('note'), nodes)).toEqual({ x: 100, y: 500 });
  });

  it('toRelative es la inversa de toAbsolute', () => {
    const abs = toAbsolute(fixtureNode('db'), nodes);
    expect(toRelative(abs, 'frame', nodes)).toEqual({ x: 280, y: 60 });
    expect(toRelative({ x: 7, y: 8 }, undefined, nodes)).toEqual({ x: 7, y: 8 });
  });

  it('soporta anidamiento de varios niveles y no se cuelga con ciclos', () => {
    const a = { ...makeNode('frame', { x: 10, y: 10 }), id: 'a' };
    const b = { ...makeNode('frame', { x: 20, y: 20 }), id: 'b', parentId: 'a' };
    const c = { ...makeNode('shape', { x: 1, y: 1 }), id: 'c', parentId: 'b' };
    expect(toAbsolute(c, [a, b, c])).toEqual({ x: 31, y: 31 });
    const x = { ...makeNode('frame', { x: 1, y: 1 }), id: 'x', parentId: 'y' };
    const y = { ...makeNode('frame', { x: 2, y: 2 }), id: 'y', parentId: 'x' };
    expect(toAbsolute(x, [x, y])).toEqual({ x: 3, y: 3 });
  });

  it('sortParentsFirst pone al padre antes que sus hijos y conserva el resto del orden', () => {
    const [frame, api, db, user, note, title] = nodes;
    const sorted = sortParentsFirst([api, user, db, frame, note, title]);
    expect(sorted.map((n) => n.id)).toEqual(['frame', 'api', 'user', 'db', 'note', 'title']);
  });

  it('sortParentsFirst no pierde nodos con ciclos', () => {
    const x = { ...makeNode('frame', { x: 0, y: 0 }), id: 'x', parentId: 'y' };
    const y = { ...makeNode('frame', { x: 0, y: 0 }), id: 'y', parentId: 'x' };
    expect(sortParentsFirst([x, y])).toHaveLength(2);
  });

  it('nodeAtPoint encuentra el frame que contiene el punto y respeta exclude', () => {
    expect(nodeAtPoint({ x: 150, y: 150 }, nodes)?.id).toBe('frame');
    expect(nodeAtPoint({ x: 5000, y: 5000 }, nodes)).toBeUndefined();
    expect(nodeAtPoint({ x: 150, y: 150 }, nodes, { exclude: new Set(['frame']) })).toBeUndefined();
  });

  it('nodeAtPoint devuelve el frame más interior (el último)', () => {
    const outer = { ...makeNode('frame', { x: 0, y: 0 }), id: 'outer' };
    const inner = {
      ...makeNode('frame', { x: 50, y: 50 }),
      id: 'inner',
      parentId: 'outer',
      width: 100,
      height: 100,
    };
    expect(nodeAtPoint({ x: 100, y: 100 }, [outer, inner])?.id).toBe('inner');
  });

  it('nodeSize prefiere lo medido, luego lo declarado, luego el defecto', () => {
    const n = makeNode('shape', { x: 0, y: 0 });
    expect(nodeSize(n)).toEqual(DEFAULT_SIZE.shape);
    expect(nodeSize({ ...n, measured: { width: 10, height: 20 } })).toEqual({ width: 10, height: 20 });
    expect(nodeSize({ ...n, width: undefined, height: undefined })).toEqual(DEFAULT_SIZE.shape);
  });

  it('descendantsOf devuelve hijos y nietos', () => {
    const a = { ...makeNode('frame', { x: 0, y: 0 }), id: 'a' };
    const b = { ...makeNode('frame', { x: 0, y: 0 }), id: 'b', parentId: 'a' };
    const c = { ...makeNode('shape', { x: 0, y: 0 }), id: 'c', parentId: 'b' };
    expect([...descendantsOf('a', [a, b, c])].sort()).toEqual(['b', 'c']);
  });
});

describe('validateBoardContent', () => {
  const clone = () => structuredClone(fixtureBoard()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const err = (x: unknown) => {
    const r = validateBoardContent(x);
    return r.ok ? null : r.error;
  };

  it('acepta el fixture y el tablero vacío', () => {
    expect(validateBoardContent(fixtureBoard()).ok).toBe(true);
    expect(validateBoardContent(emptyBoard()).ok).toBe(true);
  });

  it('rechaza lo que no es un contenido', () => {
    expect(err(null)).toMatch(/objeto/);
    expect(err([])).toMatch(/objeto/);
    expect(err({ schemaVersion: 1 })).toMatch(/nodes/);
  });

  it('rechaza schemaVersion ≠ 1', () => {
    const c = clone();
    c.schemaVersion = 2;
    expect(err(c)).toMatch(/schemaVersion/);
  });

  it('rechaza una forma, un icono o un fileId que los renderizadores no pueden pintar', () => {
    const c = clone();
    const shape = c.nodes.find((n: any) => n.data.kind === 'shape'); // eslint-disable-line @typescript-eslint/no-explicit-any
    shape.data.shape = 'no-existe';
    expect(err(c)).toMatch(/data\.shape/);
    shape.data.shape = 'rectangle';
    shape.data.kind = 'icon';
    shape.type = 'icon';
    shape.data.icon = 'no-existe';
    expect(err(c)).toMatch(/data\.icon/);
    shape.data.kind = 'image';
    shape.type = 'image';
    delete shape.data.fileId;
    expect(err(c)).toMatch(/fileId/);
  });

  it('rechaza estilos que los renderizadores no pueden consumir', () => {
    const c = clone();
    c.nodes[0].data.style.fontSize = '12';
    expect(err(c)).toMatch(/style\.fontSize/);
    const d = clone();
    d.nodes[0].data.style.fill = 7;
    expect(err(d)).toMatch(/style\.fill/);
  });

  it('rechaza ids duplicados', () => {
    const c = clone();
    c.nodes[1].id = 'frame';
    expect(err(c)).toMatch(/duplicado/);
    const d = clone();
    d.edges[1].id = d.edges[0].id;
    expect(err(d)).toMatch(/arista duplicado/);
  });

  it('rechaza aristas colgantes', () => {
    const c = clone();
    c.edges[0].target = 'fantasma';
    expect(err(c)).toMatch(/no existe/);
  });

  it('rechaza parentId inexistente o cíclico', () => {
    const c = clone();
    c.nodes[1].parentId = 'fantasma';
    expect(err(c)).toMatch(/parentId inexistente/);
    const d = clone();
    d.nodes[0].parentId = 'api'; // frame → api → frame
    expect(err(d)).toMatch(/cíclico/);
  });

  it('rechaza números no finitos', () => {
    const c = clone();
    c.nodes[0].position.x = Infinity;
    expect(err(c)).toMatch(/no finit/);
    const d = clone();
    d.nodes[2].data.style.fontSize = NaN;
    expect(err(d)).toMatch(/no finito/);
    const e = clone();
    e.viewport.zoom = NaN;
    expect(err(e)).toMatch(/viewport/);
  });

  it('rechaza type distinto de kind', () => {
    const c = clone();
    c.nodes[0].type = 'shape';
    expect(err(c)).toMatch(/distinto de data\.kind/);
  });

  it('rechaza una arista que no es labeled o con path desconocido', () => {
    const c = clone();
    c.edges[0].type = 'default';
    expect(err(c)).toMatch(/labeled/);
    const d = clone();
    d.edges[0].data.path = 'zigzag';
    expect(err(d)).toMatch(/path/);
  });

  it('rechaza más de 5 000 nodos o 10 000 aristas', () => {
    const c = clone();
    c.nodes = Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ ...c.nodes[0], id: `n${i}` }));
    expect(err(c)).toMatch(/Demasiados nodos/);
    const d = clone();
    d.edges = Array.from({ length: MAX_EDGES + 1 }, (_, i) => ({ ...d.edges[0], id: `e${i}` }));
    expect(err(d)).toMatch(/Demasiadas aristas/);
  });

  it('devuelve los padres antes que los hijos aunque lleguen desordenados', () => {
    const c = clone();
    c.nodes = [c.nodes[1], c.nodes[0], ...c.nodes.slice(2)];
    const r = validateBoardContent(c);
    expect(r.ok && r.value.nodes.map((n) => n.id).slice(0, 2)).toEqual(['frame', 'api']);
  });
});
