import { describe, expect, it } from 'vitest';
import { cursorIdFor, hueOf } from './cursorColor';

// Réplica del cálculo de Excalidraw 0.18.1 (`getClientColor`): el matiz que pinta para un `id`.
const excalidrawHue = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
  return (Math.abs(h) % 37) * 10;
};
const PALETTE = ['#e11d48', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#4b5563'];

describe('color del cursor de Excalidraw (D26)', () => {
  it('hueOf: rojo, verde y azul puros', () => {
    expect(hueOf('#ff0000')).toBe(0);
    expect(hueOf('#00ff00')).toBe(120);
    expect(hueOf('#0000ff')).toBe(240);
  });

  it('el id elegido hace que Excalidraw pinte el matiz más cercano al del avatar', () => {
    for (const c of PALETTE) {
      const delta = Math.abs(excalidrawHue(cursorIdFor(c)) - hueOf(c));
      expect(Math.min(delta, 360 - delta)).toBeLessThanOrEqual(5);
    }
  });

  it('es estable: mismo color, mismo id', () => {
    expect(cursorIdFor('#2563eb')).toBe(cursorIdFor('#2563eb'));
  });
});
