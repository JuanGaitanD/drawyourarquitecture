import { describe, expect, it } from 'vitest';
import { buildNoteContent, decodeNote, emptyNote, encodeNote, referencedFileIds } from './codec';

const img = (fileId: string, isDeleted = false) => ({ type: 'image', id: fileId, fileId, isDeleted });
const rect = { type: 'rectangle', id: 'r1', isDeleted: false };

describe('codec de nota', () => {
  it('ida y vuelta conserva elementos, fondo y archivos', () => {
    const c = buildNoteContent(
      [rect, img('a')],
      { viewBackgroundColor: '#fff' },
      {
        a: { mimeType: 'image/png', created: 5 },
      },
    );
    expect(decodeNote(encodeNote(c))).toEqual(c);
  });

  it('descarta los borrados y los archivos que ninguna imagen viva usa', () => {
    const c = buildNoteContent(
      [rect, { ...rect, id: 'r2', isDeleted: true }, img('a'), img('b', true)],
      {},
      {
        a: { mimeType: 'image/png', created: 1 },
        b: { mimeType: 'image/gif', created: 2 },
      },
    );
    expect(c.elements).toHaveLength(2);
    expect(Object.keys(c.files)).toEqual(['a']);
  });

  it('una imagen sin registro de archivo no inventa metadatos', () => {
    expect(buildNoteContent([img('x')], {}, {}).files).toEqual({});
  });

  it('referencedFileIds ignora imágenes borradas y otros tipos', () => {
    expect(referencedFileIds([img('a'), img('a'), img('b', true), rect])).toEqual(['a']);
  });

  it('decodeNote rechaza lo que no es una nota y normaliza lo que falta', () => {
    expect(() => decodeNote('{"schemaVersion":2,"elements":[]}')).toThrow();
    expect(() => decodeNote('{"schemaVersion":1,"nodes":[]}')).toThrow();
    expect(() => decodeNote('null')).toThrow();
    expect(decodeNote('{"schemaVersion":1,"elements":[]}')).toEqual(emptyNote());
  });
});
