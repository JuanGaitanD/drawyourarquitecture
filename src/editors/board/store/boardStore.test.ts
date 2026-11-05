import { describe, expect, it } from 'vitest';
import { makeNode } from '../model/board';
import { fixtureBoard } from '../model/fixtures';
import { toAbsolute } from '../model/geometry';
import { validateBoardContent } from '../model/validate';
import { createBoardStore } from './boardStore';
import { reparentNodes } from './reparent';

const loaded = () => {
  const s = createBoardStore();
  s.getState().load(fixtureBoard());
  return s;
};
const past = (s: ReturnType<typeof createBoardStore>) => s.temporal.getState().pastStates.length;
const move = (s: ReturnType<typeof createBoardStore>, id: string, dx: number) =>
  s
    .getState()
    .setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, position: { x: n.position.x + dx, y: n.position.y } } : n)),
    );

describe('store por instancia', () => {
  it('dos stores no comparten estado', () => {
    const a = loaded();
    const b = createBoardStore();
    expect(b.getState().nodes).toHaveLength(0);
    a.getState().addNodes([makeNode('text', { x: 0, y: 0 })]);
    expect(b.getState().nodes).toHaveLength(0);
  });

  it('load limpia el historial y toContent no persiste el estado de runtime', () => {
    const s = loaded();
    move(s, 'user', 10);
    expect(past(s)).toBe(1);
    s.getState().setNodes((ns) =>
      ns.map((n) => ({ ...n, selected: true, measured: { width: 1, height: 1 } })),
    );
    const c = s.getState().toContent({ x: 0, y: 0, zoom: 1 });
    expect(JSON.stringify(c)).not.toMatch(/"selected"|"measured"|"dragging"/);
    s.getState().load(fixtureBoard());
    expect(past(s)).toBe(0);
  });
});

describe('historial por gesto', () => {
  it('un arrastre con muchos movimientos es un solo paso y se deshace de una vez', () => {
    const s = loaded();
    const start = s.getState().nodes.find((n) => n.id === 'user')!.position.x;
    s.getState().beginGesture();
    for (let i = 0; i < 20; i++) move(s, 'user', 5);
    s.getState().endGesture();
    expect(past(s)).toBe(1);
    expect(s.getState().nodes.find((n) => n.id === 'user')!.position.x).toBe(start + 100);
    s.temporal.getState().undo();
    expect(s.getState().nodes.find((n) => n.id === 'user')!.position.x).toBe(start);
    s.temporal.getState().redo();
    expect(s.getState().nodes.find((n) => n.id === 'user')!.position.x).toBe(start + 100);
  });

  it('un gesto sin cambios no deja paso', () => {
    const s = loaded();
    s.getState().beginGesture();
    s.getState().endGesture();
    expect(past(s)).toBe(0);
  });

  it('cambiar solo la selección no entra al historial', () => {
    const s = loaded();
    s.getState().setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
    expect(past(s)).toBe(0);
  });

  it('un cambio nuevo tras deshacer descarta el futuro; el límite es 100', () => {
    const s = loaded();
    move(s, 'user', 1);
    s.temporal.getState().undo();
    expect(s.temporal.getState().futureStates).toHaveLength(1);
    move(s, 'user', 2);
    expect(s.temporal.getState().futureStates).toHaveLength(0);
    for (let i = 0; i < 120; i++) move(s, 'user', 1);
    expect(past(s)).toBe(100);
  });

  it('deshacer conserva la selección de los nodos', () => {
    const s = loaded();
    s.getState().setNodes((ns) => ns.map((n) => (n.id === 'user' ? { ...n, selected: true } : n)));
    move(s, 'user', 10);
    s.temporal.getState().undo();
    expect(s.getState().nodes.find((n) => n.id === 'user')!.selected).toBe(true);
  });
});

describe('removeSelected', () => {
  it('borra un frame con sus hijos y las aristas colgantes en un solo paso', () => {
    const s = loaded();
    s.getState().setNodes((ns) => ns.map((n) => (n.id === 'frame' ? { ...n, selected: true } : n)));
    s.getState().removeSelected();
    expect(
      s
        .getState()
        .nodes.map((n) => n.id)
        .sort(),
    ).toEqual(['note', 'title', 'user']);
    expect(s.getState().edges).toHaveLength(0);
    expect(past(s)).toBe(1);
    s.temporal.getState().undo();
    expect(s.getState().nodes).toHaveLength(6);
    expect(s.getState().edges).toHaveLength(3);
  });

  it('no borra lo bloqueado', () => {
    const s = loaded();
    s.getState().updateNodeData(['note'], { locked: true });
    s.getState().setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === 'note' })));
    s.getState().removeSelected();
    expect(s.getState().nodes.some((n) => n.id === 'note')).toBe(true);
  });
});

describe('removeSelected · descendientes bloqueados', () => {
  it('un hijo bloqueado de un frame borrado se conserva con la misma posición absoluta', () => {
    const s = loaded();
    s.getState().updateNodeData(['api'], { locked: true });
    const before = toAbsolute(
      s.getState().nodes.find((n) => n.id === 'api')!,
      s.getState().nodes,
    );
    s.getState().setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === 'frame' })));
    s.getState().removeSelected();
    const ns = s.getState().nodes;
    expect(ns.some((n) => n.id === 'frame')).toBe(false);
    expect(ns.some((n) => n.id === 'db')).toBe(false); // el hijo sin bloquear sí se borra
    const api = ns.find((n) => n.id === 'api')!;
    expect(api.parentId).toBeUndefined();
    expect(api.position).toEqual(before);
  });

  it('con un frame anidado superviviente, el bloqueado pasa a ese ancestro', () => {
    const outer = { ...makeNode('frame', { x: 10, y: 10 }), id: 'outer' };
    const mid = { ...makeNode('frame', { x: 20, y: 20 }), id: 'mid', parentId: 'outer' };
    const leaf = { ...makeNode('shape', { x: 5, y: 5 }, { locked: true }), id: 'leaf', parentId: 'mid' };
    const s = createBoardStore();
    s.getState().load({ schemaVersion: 1, nodes: [outer, mid, leaf], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    s.getState().setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === 'mid' })));
    s.getState().removeSelected();
    const l = s.getState().nodes.find((n) => n.id === 'leaf')!;
    expect(l.parentId).toBe('outer');
    expect(l.position).toEqual({ x: 25, y: 25 }); // absoluta (35, 35) − outer (10, 10)
  });
});

describe('updateNodeData', () => {
  it('mezcla el estilo parcial', () => {
    const s = loaded();
    s.getState().updateNodeData(['api'], { style: { fill: '#ff0000' } as never });
    const st = s.getState().nodes.find((n) => n.id === 'api')!.data.style;
    expect(st.fill).toBe('#ff0000');
    expect(st.stroke).toBe('#1f2937');
  });
});

describe('reparentNodes', () => {
  const nodes = () => fixtureBoard().nodes;

  it('sacar un hijo del frame conserva la posición absoluta y quita el padre', () => {
    const ns = nodes().map((n) => (n.id === 'api' ? { ...n, position: { x: -300, y: 40 } } : n));
    const before = toAbsolute(
      ns.find((n) => n.id === 'api')!,
      ns,
    );
    const out = reparentNodes(ns, new Set(['api']));
    const api = out.find((n) => n.id === 'api')!;
    expect(api.parentId).toBeUndefined();
    expect(api.position).toEqual(before);
  });

  it('meter un nodo suelto en el frame lo vuelve hijo con posición relativa, después del padre', () => {
    const ns = nodes().map((n) => (n.id === 'user' ? { ...n, position: { x: 150, y: 150 } } : n));
    const out = reparentNodes(ns, new Set(['user']));
    const user = out.find((n) => n.id === 'user')!;
    expect(user.parentId).toBe('frame');
    expect(user.position).toEqual({ x: 50, y: 50 });
    expect(out.findIndex((n) => n.id === 'frame')).toBeLessThan(out.findIndex((n) => n.id === 'user'));
  });

  it('un movimiento dentro del mismo frame no cambia nada (misma referencia)', () => {
    const ns = nodes();
    expect(reparentNodes(ns, new Set(['api']))).toBe(ns);
  });

  it('un frame no se mete dentro de sí mismo ni de sus descendientes', () => {
    const ns = nodes();
    expect(reparentNodes(ns, new Set(['frame']))).toBe(ns);
  });

  it('ignora lo bloqueado y a los hijos cuyo padre se mueve con ellos', () => {
    const ns = nodes().map((n) => (n.id === 'api' ? { ...n, position: { x: -300, y: 40 } } : n));
    const locked = ns.map((n) => (n.id === 'api' ? { ...n, data: { ...n.data, locked: true } } : n));
    expect(reparentNodes(locked, new Set(['api']))).toBe(locked);
    expect(reparentNodes(ns, new Set(['api', 'frame']))).toBe(ns);
  });

  it('dos frames superpuestos movidos juntos no se vuelven padre el uno del otro (sin ciclos)', () => {
    const a = { ...makeNode('frame', { x: 0, y: 0 }), id: 'a' };
    const b = { ...makeNode('frame', { x: 0, y: 0 }), id: 'b' };
    const out = reparentNodes([a, b], new Set(['a', 'b']));
    const content = { schemaVersion: 1, nodes: out, edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    expect(validateBoardContent(content).ok).toBe(true);
    expect(out.every((n) => !n.parentId)).toBe(true);
  });

  it('un nodo seleccionado no entra en otro seleccionado, pero sí en un frame que no se mueve', () => {
    const f = { ...makeNode('frame', { x: 0, y: 0 }), id: 'f' };
    const sel = { ...makeNode('frame', { x: 10, y: 10 }, {}), id: 'sel', width: 50, height: 50 };
    const sh = { ...makeNode('shape', { x: 12, y: 12 }), id: 'sh', width: 20, height: 20 };
    const out = reparentNodes([f, sel, sh], new Set(['sel', 'sh']));
    expect(out.find((n) => n.id === 'sel')!.parentId).toBe('f');
    expect(out.find((n) => n.id === 'sh')!.parentId).toBe('f'); // no a «sel», que va en la misma selección
    expect(validateBoardContent({ schemaVersion: 1, nodes: out, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }).ok).toBe(true);
  });
});

describe('historial local y cambios remotos', () => {
  const ids = (s: ReturnType<typeof createBoardStore>) => s.getState().nodes.map((n) => n.id);
  const label = (s: ReturnType<typeof createBoardStore>, id: string) =>
    s.getState().nodes.find((n) => n.id === id)?.data.label;

  it('deshacer y rehacer lo propio no borra ni resucita el alta de otra persona', () => {
    const s = loaded();
    const mine = { ...makeNode('sticky', { x: 1, y: 1 }), id: 'mine' };
    const theirs = { ...makeNode('sticky', { x: 2, y: 2 }), id: 'theirs' };
    s.getState().addNodes([mine]);
    s.getState().applyRemote([...s.getState().nodes, theirs], s.getState().edges);
    s.temporal.getState().undo();
    expect(ids(s)).toContain('theirs');
    expect(ids(s)).not.toContain('mine');
    s.temporal.getState().redo();
    expect(ids(s)).toContain('theirs');
    expect(ids(s)).toContain('mine');
  });

  it('deshacer lo propio no resucita lo que otra persona borró ni revierte su edición', () => {
    const s = loaded();
    move(s, 'user', 10);
    const without = s.getState().nodes.filter((n) => n.id !== 'note').map((n) =>
      n.id === 'api' ? { ...n, data: { ...n.data, label: 'remoto' } } : n,
    );
    s.getState().applyRemote(without, s.getState().edges.filter((e) => e.source !== 'note' && e.target !== 'note'));
    s.temporal.getState().undo();
    expect(ids(s)).not.toContain('note');
    expect(label(s, 'api')).toBe('remoto');
    s.temporal.getState().redo();
    expect(ids(s)).not.toContain('note');
    expect(label(s, 'api')).toBe('remoto');
    expect(validateBoardContent(s.getState().toContent({ x: 0, y: 0, zoom: 1 })).ok).toBe(true);
  });
});
