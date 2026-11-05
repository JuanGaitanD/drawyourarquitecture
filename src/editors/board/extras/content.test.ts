import { describe, expect, it } from 'vitest';
import { fixtureBoard } from '../model/fixtures';
import { validateBoardContent } from '../model/validate';
import { absoluteBounds, placeBelow, remapIds } from './content';

describe('remapIds', () => {
  it('cambia todos los ids y conserva padres y extremos; el resultado valida', () => {
    const src = fixtureBoard();
    const out = remapIds(src);
    expect(validateBoardContent(out).ok).toBe(true);
    const old = new Set(src.nodes.map((n) => n.id));
    expect(out.nodes.every((n) => !old.has(n.id))).toBe(true);
    const frame = out.nodes[src.nodes.findIndex((n) => n.id === 'frame')];
    expect(out.nodes[src.nodes.findIndex((n) => n.id === 'api')]?.parentId).toBe(frame?.id);
    expect(out.edges.map((e) => e.data?.label)).toEqual(src.edges.map((e) => e.data?.label));
  });

  it('no muta la entrada', () => {
    const src = fixtureBoard();
    const snap = JSON.stringify(src);
    remapIds(src);
    expect(JSON.stringify(src)).toBe(snap);
  });
});

describe('absoluteBounds / placeBelow', () => {
  it('null sin nodos; con hijos usa posiciones absolutas', () => {
    expect(absoluteBounds([])).toBeNull();
    const b = absoluteBounds(fixtureBoard().nodes);
    expect(b?.x).toBe(-200); // user
    expect(b?.y).toBe(40); // title
  });

  it('coloca lo entrante bajo lo existente, alineado a la izquierda, sin tocar a los hijos', () => {
    const existing = fixtureBoard().nodes;
    const incoming = remapIds(fixtureBoard());
    const moved = placeBelow(incoming, existing);
    const eb = absoluteBounds(existing);
    const mb = absoluteBounds(moved.nodes);
    expect(mb?.x).toBeCloseTo(eb?.x ?? NaN);
    expect(mb?.y).toBeGreaterThan((eb?.y ?? 0) + (eb?.height ?? 0));
    const child = (c: typeof incoming) => c.nodes.find((n) => n.parentId);
    expect(child(moved)?.position).toEqual(child(incoming)?.position);
  });

  it('sin contenido previo no mueve nada', () => {
    const incoming = fixtureBoard();
    expect(placeBelow(incoming, [])).toBe(incoming);
  });
});
