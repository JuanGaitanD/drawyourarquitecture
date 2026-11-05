import { describe, expect, it } from 'vitest';
import { encode } from '@/domain/codec';
import { makeNode, type BoardContent, type BoardNode } from './model/board';
import { validateBoardContent } from './model/validate';
import { createBoardSync } from './sync';
import { createBoardStore } from './store/boardStore';

describe('createBoardSync · fusión remota', () => {
  const frame = (id: string, x: number, y: number): BoardNode => ({ ...makeNode('frame', { x, y }), id });
  const view = { x: 0, y: 0, zoom: 1 };
  const content = (nodes: BoardNode[]): BoardContent => ({ schemaVersion: 1, nodes, edges: [], viewport: view });

  it('dos reparentados cruzados no dejan un ciclo en el store ni en el texto a guardar', () => {
    const base = content([frame('A', 100, 100), frame('B', 500, 300)]);
    const store = createBoardStore();
    store.getState().load(base);
    const sync = createBoardSync(store, base, 1);
    // local: A dentro de B
    store.getState().setNodes((ns) => [
      ns.find((n) => n.id === 'B')!,
      { ...ns.find((n) => n.id === 'A')!, parentId: 'B', position: { x: -400, y: -200 } },
    ]);
    // remoto: B dentro de A
    const remote = content([
      frame('A', 100, 100),
      { ...frame('B', 500, 300), parentId: 'A', position: { x: 400, y: 200 } },
    ]);
    expect(sync.onRemote({ data: encode(remote), schemaVersion: 1, revision: 2, updatedAt: 0 })).toBe(true);
    expect(validateBoardContent(store.getState().toContent(view)).ok).toBe(true);
    expect(() => sync.merge('', encode(remote))).not.toThrow(); // la transacción de guardado también valida
  });
});
