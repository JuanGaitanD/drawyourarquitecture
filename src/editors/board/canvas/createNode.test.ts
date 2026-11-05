import { describe, expect, it } from 'vitest';
import { fixtureBoard } from '../model/fixtures';
import { toAbsolute } from '../model/geometry';
import { nodeForTool, isCreateTool } from './createNode';

const opts = { tool: 'shape', shape: 'ellipse', icon: 'server', snapOn: true } as const;

describe('nodeForTool', () => {
  it('crea centrado en el clic, con la forma pendiente y ajustado a la cuadrícula', () => {
    const n = nodeForTool(opts, { x: -500, y: -500 }, fixtureBoard().nodes)!;
    expect(n.data.shape).toBe('ellipse');
    expect(n.type).toBe('shape');
    expect(n.parentId).toBeUndefined();
    expect(Math.abs(n.position.x % 16)).toBe(0);
    expect(Math.abs(n.position.y % 16)).toBe(0);
  });

  it('dentro de un frame es hijo suyo y la posición absoluta se conserva', () => {
    const nodes = fixtureBoard().nodes;
    const n = nodeForTool({ ...opts, snapOn: false }, { x: 300, y: 300 }, nodes)!;
    expect(n.parentId).toBe('frame');
    expect(toAbsolute(n, [...nodes, n])).toEqual({ x: 300 - 80, y: 300 - 48 });
  });

  it('las herramientas que no crean devuelven null', () => {
    expect(nodeForTool({ ...opts, tool: 'select' }, { x: 0, y: 0 }, [])).toBeNull();
    expect(isCreateTool('connector')).toBe(false);
    expect(isCreateTool('sticky')).toBe(true);
  });
});
