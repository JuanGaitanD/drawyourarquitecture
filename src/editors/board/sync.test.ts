import { describe, expect, it } from 'vitest';
import { encode } from '@/domain/codec';
import { makeNode, type BoardContent, type BoardNode } from './model/board';
import { validateBoardContent } from './model/validate';
import { boardSame, createBoardSync } from './sync';
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
    expect(sync.onRemote({ data: encode(remote), schemaVersion: 1, revision: 2, updatedAt: 0 })).not.toBeNull();
    expect(validateBoardContent(store.getState().toContent(view)).ok).toBe(true);
    expect(() => sync.merge('', encode(remote))).not.toThrow(); // la transacción de guardado también valida
  });

  describe('viewport (D11)', () => {
    const moved = { x: 120, y: -40, zoom: 1.5 };

    it('un contenido igual salvo el viewport ya no es «el mismo»: pan y zoom se guardan', () => {
      const a = encode(content([frame('A', 0, 0)]));
      const b = encode({ ...content([frame('A', 0, 0)]), viewport: moved });
      expect(boardSame(a, b)).toBe(false);
      expect(boardSame(a, encode(content([frame('A', 0, 0)])))).toBe(true);
    });

    it('el viewport de otra persona no ensucia: lo remoto se acepta con el viewport propio', () => {
      const base = content([frame('A', 0, 0)]);
      const store = createBoardStore();
      store.getState().load(base);
      const sync = createBoardSync(store, base, 1);
      const theirs = encode({ ...content([frame('A', 0, 0), frame('B', 50, 50)]), viewport: moved });
      const accepted = sync.onRemote({ data: theirs, schemaVersion: 1, revision: 2, updatedAt: 0 })!;
      expect(JSON.parse(accepted).viewport).toEqual(view);
      // Lo que esta pestaña codificaría ahora (con su viewport) es lo mismo que lo aceptado: nada pendiente.
      expect(boardSame(accepted, encode(store.getState().toContent(view)))).toBe(true);
    });

    it('tras guardar un viewport nuevo, ese es el propio', () => {
      const base = content([frame('A', 0, 0)]);
      const store = createBoardStore();
      store.getState().load(base);
      const sync = createBoardSync(store, base, 1);
      sync.onSaved({ data: encode({ ...base, viewport: moved }), revision: 2 });
      const theirs = encode({ ...content([frame('A', 0, 0), frame('B', 1, 1)]), viewport: view });
      const accepted = sync.onRemote({ data: theirs, schemaVersion: 1, revision: 3, updatedAt: 0 })!;
      expect(JSON.parse(accepted).viewport).toEqual(moved);
    });
  });
});
