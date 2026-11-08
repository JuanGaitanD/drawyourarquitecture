import { describe, expect, it } from 'vitest';
import { makeNode } from '../model/board';
import { createBoardStore } from '../store/boardStore';
import { createBoardActions } from '../ui/actions';
import { connectEdge } from './connect';

const at = (id: string, x: number, y: number, locked = false) => ({
  ...makeNode('shape', { x, y }, { locked }),
  id,
  width: 100,
  height: 50,
});

describe('conector por clic (D10)', () => {
  const nodes = [at('a', 0, 0), at('b', 300, 10), at('c', 20, 300), at('d', 0, 600, true)];

  it('elige los lados que se miran', () => {
    const right = connectEdge('a', 'b', nodes)!;
    expect([right.sourceHandle, right.targetHandle]).toEqual(['r', 'l']);
    const left = connectEdge('b', 'a', nodes)!;
    expect([left.sourceHandle, left.targetHandle]).toEqual(['l', 'r']);
    const down = connectEdge('a', 'c', nodes)!;
    expect([down.sourceHandle, down.targetHandle]).toEqual(['b', 't']);
    const up = connectEdge('c', 'a', nodes)!;
    expect([up.sourceHandle, up.targetHandle]).toEqual(['t', 'b']);
    expect(right).toMatchObject({ source: 'a', target: 'b', type: 'labeled' });
  });

  it('no conecta un nodo consigo mismo, con uno bloqueado ni con uno inexistente', () => {
    expect(connectEdge('a', 'a', nodes)).toBeNull();
    expect(connectEdge('a', 'd', nodes)).toBeNull();
    expect(connectEdge('d', 'a', nodes)).toBeNull();
    expect(connectEdge('a', 'zzz', nodes)).toBeNull();
  });

  it('origen pendiente: Esc o cambiar de herramienta lo cancelan; crear la arista es un paso', () => {
    const s = createBoardStore();
    s.getState().load({ schemaVersion: 1, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    s.getState().setTool('connector');
    s.getState().setConnectFrom('a');
    expect(s.getState().connectFrom).toBe('a');
    s.getState().setTool('select');
    expect(s.getState().connectFrom).toBeNull();

    s.getState().setTool('connector');
    s.getState().setConnectFrom('a');
    s.getState().addEdges([connectEdge('a', 'b', s.getState().nodes)!]);
    s.getState().setConnectFrom(null);
    expect(s.getState().edges).toHaveLength(1);
    expect(s.temporal.getState().pastStates).toHaveLength(1);
  });

  it('Esc: primero cancela el origen elegido y después sale de la herramienta', () => {
    const s = createBoardStore();
    s.getState().load({ schemaVersion: 1, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    const actions = createBoardActions(s, () => null);
    s.getState().setTool('connector');
    s.getState().setConnectFrom('a');
    actions.escape();
    expect([s.getState().tool, s.getState().connectFrom]).toEqual(['connector', null]);
    actions.escape();
    expect(s.getState().tool).toBe('select');
  });
});
