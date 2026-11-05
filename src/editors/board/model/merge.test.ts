import { describe, expect, it } from 'vitest';
import { makeEdge, makeNode, type BoardContent, type BoardNode } from './board';
import { fixtureBoard } from './fixtures';
import { canon, mergeBoards } from './merge';
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
