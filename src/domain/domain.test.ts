import { describe, expect, it } from 'vitest';
import { ContentTooLargeError, MAX_CONTENT_BYTES, byteLength, decode, encode } from './codec';
import { DEFAULT_TITLE, MAX_TITLE_LENGTH, isProjectType, normalizeTitle } from './project';

describe('codec', () => {
  it('hace ida y vuelta con JSON', () => {
    const obj = { a: [1, 2, { b: 'ñ' }], c: null };
    expect(decode(encode(obj))).toEqual(obj);
  });

  it('cuenta bytes UTF-8, no caracteres', () => {
    expect(byteLength('ñ')).toBe(2);
    expect(byteLength('😀')).toBe(4);
  });

  it('acepta justo el tope y rechaza uno más', () => {
    // JSON.stringify añade 2 bytes de comillas
    const ok = 'x'.repeat(MAX_CONTENT_BYTES - 2);
    expect(byteLength(encode(ok))).toBe(MAX_CONTENT_BYTES);
    expect(() => encode(ok + 'x')).toThrow(ContentTooLargeError);
  });

  it('el tope se mide en bytes: caracteres de 2 bytes lo superan antes', () => {
    const big = 'ñ'.repeat(MAX_CONTENT_BYTES / 2);
    expect(() => encode(big)).toThrow(ContentTooLargeError);
  });

  it('rechaza valores no serializables', () => {
    expect(() => encode(undefined)).toThrow(TypeError);
  });
});

describe('project', () => {
  it('normaliza títulos', () => {
    expect(normalizeTitle('  Hola ')).toBe('Hola');
    expect(normalizeTitle('   ')).toBe(DEFAULT_TITLE);
    expect(normalizeTitle(undefined)).toBe(DEFAULT_TITLE);
    expect(normalizeTitle('x'.repeat(500))).toHaveLength(MAX_TITLE_LENGTH);
  });

  it('reconoce tipos válidos', () => {
    expect(isProjectType('note')).toBe(true);
    expect(isProjectType('board')).toBe(true);
    expect(isProjectType('doc')).toBe(false);
  });
});
