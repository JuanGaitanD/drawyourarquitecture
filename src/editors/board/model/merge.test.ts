import { describe, expect, it } from 'vitest';
import { makeEdge, makeNode, type BoardContent, type BoardNode } from './board';
import { fixtureBoard } from './fixtures';
import { canon, deepEqual, diffById, mergeBoards } from './merge';
import { validateBoardContent } from './validate';

const base = (): BoardContent => fixtureBoard();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const relabel = (c: BoardContent, id: string, label: string): BoardContent => {
  const out = clone(c);
  out.nodes.find((n) => n.id === id)!.data.label = label;
  return out;
};
const without = (c: BoardContent, id: string): BoardContent => ({
  ...c,
  nodes: c.nodes.filter((n) => n.id !== id),
  edges: c.edges.filter((e) => e.source !== id && e.target !== id),
});
const labelOf = (c: BoardContent, id: string) => c.nodes.find((n) => n.id === id)?.data.label;
const has = (c: BoardContent, id: string) => c.nodes.some((n) => n.id === id);

describe('mergeBoards · tres bandas', () => {
  it('sin cambios en ningún lado devuelve lo mismo', () => {
    const m = mergeBoards(base(), base(), base());
    expect(canon(m.nodes)).toBe(canon(base().nodes));
    expect(canon(m.edges)).toBe(canon(base().edges));
  });

  it('cambios en elementos distintos se suman sin pérdidas', () => {
    const m = mergeBoards(relabel(base(), 'api', 'mi API'), relabel(base(), 'db', 'su DB'), base());
    expect(labelOf(m, 'api')).toBe('mi API');
    expect(labelOf(m, 'db')).toBe('su DB');
  });

  it('lo añadido por cada lado se conserva', () => {
    const a = makeNode('sticky', { x: 1, y: 1 }, { label: 'A' });
    const c = makeNode('sticky', { x: 2, y: 2 }, { label: 'C' });
    const mine = base();
    mine.nodes.push(a);
    const theirs = base();
    theirs.nodes.push(c);
    const m = mergeBoards(mine, theirs, base());
    expect(m.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([a.id, c.id]));
  });

  it('si solo cambió el remoto, gana el remoto', () => {
    expect(labelOf(mergeBoards(base(), relabel(base(), 'api', 'remoto'), base()), 'api')).toBe('remoto');
  });

  it('si cambió en los dos lados, gana el local', () => {
    const m = mergeBoards(relabel(base(), 'api', 'local'), relabel(base(), 'api', 'remoto'), base());
    expect(labelOf(m, 'api')).toBe('local');
  });

  it('un borrado remoto se aplica y el local intacto no lo resucita', () => {
    const m = mergeBoards(base(), without(base(), 'note'), base());
    expect(has(m, 'note')).toBe(false);
    expect(m.edges.some((e) => e.id === 'e-note-frame')).toBe(false);
  });

  it('un borrado local no lo resucita el remoto intacto', () => {
    expect(has(mergeBoards(without(base(), 'note'), base(), base()), 'note')).toBe(false);
  });

  it('editar algo que el otro borró: gana el local (se conserva)', () => {
    const m = mergeBoards(relabel(base(), 'title', 'editado'), without(base(), 'title'), base());
    expect(labelOf(m, 'title')).toBe('editado');
  });

  it('el orden de las claves no cuenta como cambio', () => {
    const reordered = base();
    reordered.nodes = reordered.nodes.map(
      (n) => ({ ...n, data: Object.fromEntries(Object.entries(n.data).reverse()) }) as BoardNode,
    );
    const m = mergeBoards(reordered, relabel(base(), 'db', 'su DB'), base());
    expect(labelOf(m, 'db')).toBe('su DB');
  });

  it('borrar un nodo que el otro conectó no deja aristas colgando y el resultado valida', () => {
    const mine = base();
    mine.edges.push(makeEdge('user', 'note')); // arista nueva hacia el nodo que el otro borró
    const m = mergeBoards(mine, without(base(), 'user'), base());
    expect(m.edges.every((e) => e.source !== 'user' && e.target !== 'user')).toBe(true);
    expect(validateBoardContent(m).ok).toBe(true);
  });

  it('si se borra un frame, sus hijos editados pasan a la raíz en su posición absoluta', () => {
    const m = mergeBoards(relabel(base(), 'api', 'sigue'), without(base(), 'frame'), base());
    const api = m.nodes.find((n) => n.id === 'api')!;
    expect(api.parentId).toBeUndefined();
    expect(api.position).toEqual({ x: 140, y: 160 }); // 100 + 40, 100 + 60
    expect(validateBoardContent(m).ok).toBe(true);
  });

  it('conserva el viewport local; sin base todo lo local cuenta como cambio propio', () => {
    const mine = base();
    mine.viewport = { x: 5, y: 6, zoom: 2 };
    const m = mergeBoards(mine, base(), base());
    expect(m.viewport).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(labelOf(mergeBoards(relabel(base(), 'api', 'L'), relabel(base(), 'api', 'R'), null), 'api')).toBe('L');
  });
});

describe('mergeBoards · reparentados concurrentes', () => {
  const frame = (id: string, x: number, y: number): BoardNode => ({ ...makeNode('frame', { x, y }), id });
  const root = (): BoardContent => ({
    schemaVersion: 1,
    nodes: [frame('A', 100, 100), frame('B', 500, 300)],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  /** `child` entra en `parent` conservando su posición absoluta. */
  const nest = (c: BoardContent, child: string, parent: string): BoardContent => {
    const out = clone(c);
    const ch = out.nodes.find((n) => n.id === child)!;
    const pa = out.nodes.find((n) => n.id === parent)!;
    ch.parentId = parent;
    ch.position = { x: ch.position.x - pa.position.x, y: ch.position.y - pa.position.y };
    out.nodes = [...out.nodes.filter((n) => n.id === parent), ...out.nodes.filter((n) => n.id !== parent)];
    return out;
  };
  const abs = (c: BoardContent, id: string) => {
    const n = c.nodes.find((x) => x.id === id)!;
    const p = n.parentId ? c.nodes.find((x) => x.id === n.parentId) : undefined;
    return { x: n.position.x + (p?.position.x ?? 0), y: n.position.y + (p?.position.y ?? 0) };
  };

  for (const [name, mine, theirs] of [
    ['A dentro de B (local) y B dentro de A (remoto)', ['A', 'B'], ['B', 'A']],
    ['B dentro de A (local) y A dentro de B (remoto)', ['B', 'A'], ['A', 'B']],
  ] as const) {
    it(`rompe el ciclo de forma determinista: ${name}`, () => {
      const m = mergeBoards(nest(root(), mine[0], mine[1]), nest(root(), theirs[0], theirs[1]), root());
      expect(validateBoardContent(m).ok).toBe(true);
      expect(m.nodes.filter((n) => !n.parentId)).toHaveLength(1);
      // el nodo con el id menor queda en la raíz; el otro cuelga de él; los dos conservan su posición absoluta
      expect(m.nodes.find((n) => n.id === 'A')!.parentId).toBeUndefined();
      expect(m.nodes.find((n) => n.id === 'B')!.parentId).toBe('A');
      expect(abs(m, 'A')).toEqual({ x: 100, y: 100 });
      expect(abs(m, 'B')).toEqual({ x: 500, y: 300 });
    });
  }
});

describe('deepEqual y diffById (D13)', () => {
  it('compara sin orden de claves y trata undefined como ausente', () => {
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, p: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });

  it('diffById devuelve altas, bajas y ediciones, y nada si solo cambia la referencia', () => {
    const a = [{ id: 'x', v: { n: 1 } }, { id: 'y', v: { n: 2 } }, { id: 'z', v: { n: 3 } }];
    const b = [{ id: 'x', v: { n: 1 } }, { id: 'y', v: { n: 9 } }, { id: 'w', v: { n: 4 } }];
    expect([...diffById(a, b)].sort()).toEqual(['w', 'y', 'z']);
    expect(diffById(a, structuredClone(a)).size).toBe(0);
  });
});
