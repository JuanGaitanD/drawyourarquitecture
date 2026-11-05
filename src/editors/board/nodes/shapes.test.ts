import { describe, expect, it } from 'vitest';
import { SHAPES } from '../model/board';
import { LABEL_INSET, shapePath } from './shapes';

describe('shapePath', () => {
  it.each(SHAPES)('%s produce un trazado finito y tiene relleno interior', (kind) => {
    for (const [w, h] of [
      [160, 96],
      [20, 20],
      [400, 40],
    ]) {
      const p = shapePath(kind, w, h);
      expect(p.d).toMatch(/^M/);
      expect(`${p.d}${p.detail ?? ''}`).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect(LABEL_INSET[kind]).toBeTruthy();
  });
});
