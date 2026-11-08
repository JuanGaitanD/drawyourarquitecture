import { describe, expect, it } from 'vitest';
import { encode } from '@/domain/codec';
import { emptyBoard } from '@/editors/board/model/board';
import { emptyNote } from '@/editors/note/codec';
import { parseContent } from './content';

describe('parseContent', () => {
  it('lee una nota y un board vacíos', () => {
    expect(parseContent('note', encode(emptyNote()))?.type).toBe('note');
    expect(parseContent('board', encode(emptyBoard()))?.type).toBe('board');
  });
  it('rechaza JSON roto', () => {
    expect(parseContent('note', '{no es json')).toBeNull();
    expect(parseContent('board', '')).toBeNull();
  });
  it('rechaza contenido con otra forma o versión', () => {
    expect(parseContent('note', encode({ ...emptyNote(), schemaVersion: 2 }))).toBeNull();
    expect(parseContent('note', encode({ schemaVersion: 1, elements: 'x', files: {} }))).toBeNull();
    expect(parseContent('board', encode({ ...emptyBoard(), schemaVersion: 2 }))).toBeNull();
    expect(parseContent('board', encode({ ...emptyBoard(), nodes: [{ id: 'a' }] }))).toBeNull();
  });
  it('un board no se acepta como nota ni al revés', () => {
    expect(parseContent('note', encode(emptyBoard()))).toBeNull();
    expect(parseContent('board', encode(emptyNote()))).toBeNull();
  });
});
