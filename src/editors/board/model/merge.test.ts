import { describe, expect, it } from 'vitest';
import { makeEdge, makeNode, type BoardContent, type BoardNode } from './board';
import { fixtureBoard } from './fixtures';
import { mergeBoards, mergeStamped, purge, stamp, TOMBSTONE_TTL_MS } from './merge';
import { validateBoardContent } from './validate';

const NOW = 1_000_000;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const relabel = (c: BoardContent, id: string, label: string): BoardContent => {
  const out = clone(c);
  out.nodes.find((n) => n.id === id)!.data.label = label;
  return out;
};
const labelOf = (c: BoardContent, id: string) => c.nodes.find((n) => n.id === id)?.data.label;
/** Estado compartido de partida: el fixture sin marcar (todo vale v = 0). */
const base = (): BoardContent => fixtureBoard();

describe('stamp', () => {
  it('sin cambios no sube ningún contador', () => {
    const b = base();
    expect(stamp(fixtureBoard(), b, NOW).sync).toEqual({ v: {}, dead: {} });
  });

  it('un elemento modificado sube a v+1 y uno nuevo nace en 1', () => {
    const b = base();
    const local = relabel(fixtureBoard(), 'api', 'API v2');
    const extra = makeNode('shape', { x: 0, y: 0 }, { label: 'nuevo' });
    local.nodes.push(extra);
    const s = stamp(local, b, NOW).sync!;
    expect(s.v.api).toBe(1);
    expect(s.v[extra.id]).toBe(1);
    expect(s.v.db).toBeUndefined();
  });

  it('lo borrado deja un tombstone con v+1', () => {
    const b = base();
    const local = fixtureBoard();
    local.nodes = local.nodes.filter((n) => n.id !== 'note');
    local.edges = local.edges.filter((e) => e.id !== 'e-note-frame');
    const s = stamp(local, b, NOW).sync!;
    expect(s.dead.note).toEqual({ v: 1, at: NOW });
    expect(s.dead['e-note-frame']).toEqual({ v: 1, at: NOW });
  });

  it('el orden de las claves no cuenta como cambio', () => {
    const b = base();
    const local = fixtureBoard();
    local.nodes = local.nodes.map((n) => ({ ...n, data: Object.fromEntries(Object.entries(n.data).reverse()) }) as BoardNode);
    expect(stamp(local, b, NOW).sync!.v).toEqual({});
  });

  it('los tombstones de más de un minuto se purgan', () => {
    const s = purge({ v: {}, dead: { a: { v: 1, at: 0 }, b: { v: 1, at: NOW + 5 } } }, NOW + TOMBSTONE_TTL_MS + 1);
    expect(Object.keys(s.dead)).toEqual(['b']);
  });
});

describe('mergeBoards', () => {
  it('cambios en elementos distintos se suman sin pérdidas', () => {
    const b = base();
    const mine = relabel(fixtureBoard(), 'api', 'mi API');
    const theirs = stamp(relabel(fixtureBoard(), 'db', 'su DB'), b, NOW);
    const m = mergeBoards(mine, theirs, b, NOW);
    expect(labelOf(m, 'api')).toBe('mi API');
    expect(labelOf(m, 'db')).toBe('su DB');
  });

  it('lo añadido por cada lado se conserva', () => {
    const b = base();
    const a = makeNode('sticky', { x: 1, y: 1 }, { label: 'A' });
    const c = makeNode('sticky', { x: 2, y: 2 }, { label: 'C' });
    const mine = fixtureBoard();
    mine.nodes.push(a);
    const other = fixtureBoard();
    other.nodes.push(c);
    const m = mergeBoards(mine, stamp(other, b, NOW), b, NOW);
    expect(m.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([a.id, c.id]));
  });

  it('gana el contador mayor aunque sea el remoto', () => {
    const b = base();
    const theirs = stamp(relabel(fixtureBoard(), 'api', 'v1'), b, NOW);
    const theirs2 = stamp(relabel(fixtureBoard(), 'api', 'v2'), theirs, NOW); // v = 2
    const mine = relabel(fixtureBoard(), 'api', 'local'); // v = 1 frente a la base
    expect(labelOf(mergeBoards(mine, theirs2, b, NOW), 'api')).toBe('v2');
  });

  it('un empate se resuelve igual desde los dos lados (convergen)', () => {
    const b = base();
    const sa = stamp(relabel(fixtureBoard(), 'api', 'de A'), b, NOW);
    const sb = stamp(relabel(fixtureBoard(), 'api', 'de B'), b, NOW);
    const ab = mergeStamped(sa, sb);
    const ba = mergeStamped(sb, sa);
    expect(labelOf(ab, 'api')).toBe(labelOf(ba, 'api'));
    expect(ab.sync).toEqual(ba.sync);
  });

  it('un borrado remoto se aplica y no vuelve a aparecer', () => {
    const b = base();
    const del = fixtureBoard();
    del.nodes = del.nodes.filter((n) => n.id !== 'note');
    del.edges = del.edges.filter((e) => e.id !== 'e-note-frame');
    const theirs = stamp(del, b, NOW);
    const m = mergeBoards(fixtureBoard(), theirs, b, NOW);
    expect(m.nodes.some((n) => n.id === 'note')).toBe(false);
    expect(m.sync!.dead.note).toBeDefined();
    // el local que aún lo tenía, vuelto a fusionar con el resultado, tampoco lo recupera
    expect(mergeStamped(stamp(fixtureBoard(), b, NOW), m).nodes.some((n) => n.id === 'note')).toBe(false);
  });

  it('editar algo que el otro borró: gana el borrado en empate, la edición posterior lo resucita', () => {
    const b = base();
    const del = fixtureBoard();
    del.nodes = del.nodes.filter((n) => n.id !== 'title');
    const theirs = stamp(del, b, NOW); // dead v1
    const edited = relabel(fixtureBoard(), 'title', 'editado'); // alive v1
    expect(mergeBoards(edited, theirs, b, NOW).nodes.some((n) => n.id === 'title')).toBe(false);
    const newer = stamp(edited, stamp(fixtureBoard(), theirs, NOW), NOW); // base conoce el tombstone (v1) → v2
    expect(mergeStamped(newer, theirs).nodes.some((n) => n.id === 'title')).toBe(true);
  });

  it('borrar un nodo que el otro conectó no deja aristas colgando y el resultado valida', () => {
    const b = base();
    const del = fixtureBoard();
    del.nodes = del.nodes.filter((n) => n.id !== 'user');
    del.edges = del.edges.filter((e) => e.source !== 'user');
    const theirs = stamp(del, b, NOW);
    const mine = fixtureBoard();
    mine.edges.push(makeEdge('user', 'note')); // arista nueva hacia el nodo que se borró
    const m = mergeBoards(mine, theirs, b, NOW);
    expect(m.edges.every((e) => e.source !== 'user' && e.target !== 'user')).toBe(true);
    expect(validateBoardContent(m).ok).toBe(true);
  });

  it('si se borra un frame, sus hijos editados pasan a la raíz en su posición absoluta', () => {
    const b = base();
    const del = fixtureBoard();
    del.nodes = del.nodes.filter((n) => n.id !== 'frame');
    del.edges = del.edges.filter((e) => e.source !== 'frame' && e.target !== 'frame');
    const theirs = stamp(del, b, NOW);
    const mine = fixtureBoard();
    mine.nodes.find((n) => n.id === 'api')!.data.label = 'sigue';
    const m = mergeBoards(mine, theirs, b, NOW);
    const api = m.nodes.find((n) => n.id === 'api')!;
    expect(api.parentId).toBeUndefined();
    expect(api.position).toEqual({ x: 140, y: 160 }); // 100 + 40, 100 + 60
    expect(validateBoardContent(m).ok).toBe(true);
  });

  it('el contenido fusionado conserva el viewport local y valida', () => {
    const b = base();
    const mine = fixtureBoard();
    mine.viewport = { x: 5, y: 6, zoom: 2 };
    const m = mergeBoards(mine, b, b, NOW);
    expect(m.viewport).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(validateBoardContent(m).ok).toBe(true);
  });
});
