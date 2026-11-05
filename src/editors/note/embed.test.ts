import { describe, expect, it } from 'vitest';
import {
  boardEmbedLink,
  embedOrigin,
  newEmbeddable,
  parseBoardLink,
  validateEmbeddable,
  viewportCenter,
} from './embed';

const O = 'https://dya.example';

describe('validateEmbeddable', () => {
  it('true solo para /embed/board/<id> del mismo origen', () => {
    expect(validateEmbeddable(`${O}/embed/board/abc123XYZ`, O)).toBe(true);
    expect(validateEmbeddable(`${O}/embed/board/abc-123_XYZ/`, O)).toBe(true);
  });

  it('undefined para todo lo demás (otro origen, otra ruta, relativo, vacío)', () => {
    for (const l of [
      'https://evil.example/embed/board/abc123',
      `${O}/embed/board/`,
      `${O}/embed/board/a/b`,
      `${O}/board/abc123`,
      `${O}/embed/board/abc?x=1`,
      'http://dya.example/embed/board/abc123',
      '/embed/board/abc123',
      'https://www.youtube.com/watch?v=1',
      '',
    ]) {
      expect(validateEmbeddable(l, O)).toBeUndefined();
    }
  });

  it('el enlace que genera la nota se reconoce', () => {
    expect(parseBoardLink(boardEmbedLink('Zk3-9', O), O)).toBe('Zk3-9');
  });
});

describe('colocación', () => {
  it('centra 640×400 en el viewport, también con scroll y zoom', () => {
    const c = viewportCenter({ scrollX: -100, scrollY: 50, width: 1000, height: 600, zoom: { value: 2 } });
    expect(c).toEqual({ x: 350, y: 100 });
    expect(embedOrigin(c)).toEqual({ x: 30, y: -100 });
  });
});

describe('newEmbeddable', () => {
  it('trae todos los campos base y el enlace absoluto', () => {
    const el = newEmbeddable({ x: 1, y: 2 }, boardEmbedLink('abc', O), 'id1');
    expect(el).toMatchObject({
      id: 'id1',
      type: 'embeddable',
      x: 1,
      y: 2,
      width: 640,
      height: 400,
      isDeleted: false,
    });
    const base = [
      'strokeColor',
      'backgroundColor',
      'fillStyle',
      'strokeWidth',
      'strokeStyle',
      'roundness',
      'roughness',
      'opacity',
      'angle',
      'seed',
      'version',
      'versionNonce',
      'index',
      'groupIds',
      'frameId',
      'boundElements',
      'updated',
      'link',
      'locked',
    ];
    for (const k of base) expect(el).toHaveProperty(k);
    expect(parseBoardLink(el.link, O)).toBe('abc');
  });
});
