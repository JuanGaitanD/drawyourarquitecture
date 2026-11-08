import { describe, expect, it } from 'vitest';
import { makeNode } from '../model/board';
import { createBoardStore } from '../store/boardStore';
import { computeEncoded } from './useEncodedContent';

const vp = { x: 0, y: 0, zoom: 1 };

describe('computeEncoded · nunca se codifica contenido inválido', () => {
  it('contenido válido: lo codifica', () => {
    const s = createBoardStore();
    s.getState().addNodes([makeNode('shape', { x: 0, y: 0 })]);
    const r = computeEncoded(s, vp);
    expect(r.encoded).not.toBeNull();
    expect(r.invalid).toBeNull();
  });

  it('un ciclo de padres no se codifica y se informa', () => {
    const s = createBoardStore();
    const a = { ...makeNode('frame', { x: 0, y: 0 }), id: 'a', parentId: 'b' };
    const b = { ...makeNode('frame', { x: 0, y: 0 }), id: 'b', parentId: 'a' };
    s.getState().setNodes(() => [a, b]);
    const r = computeEncoded(s, vp);
    expect(r.encoded).toBeNull();
    expect(r.invalid).toMatch(/cíclico/);
  });
});
