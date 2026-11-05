import { describe, expect, it } from 'vitest';
import {
  pickBackground,
  buildNoteContent,
  decodeNote,
  emptyNote,
  encodeNote,
  noteSame,
  TOMBSTONE_TTL_MS,
  referencedFileIds,
  unionFiles,
} from './codec';

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

describe('colaboración · archivos y comparación', () => {
  it('unionFiles junta los archivos de los dos lados por fileId', () => {
    const local = { a: { mimeType: 'image/png', created: 1 } };
    const remote = { b: { mimeType: 'image/webp', created: 2 }, a: { mimeType: 'image/gif', created: 9 } };
    expect(unionFiles(local, remote)).toEqual({ a: local.a, b: remote.b });
  });

  it('noteSame ignora el orden de los elementos y distingue versiones y archivos', () => {
    const el = (id: string, version: number) => ({ id, type: 'rectangle', version, versionNonce: 1 });
    const enc = (elements: unknown[], files = {}) =>
      encodeNote({ schemaVersion: 1, elements, appState: {}, files });
    expect(noteSame(enc([el('a', 1), el('b', 1)]), enc([el('b', 1), el('a', 1)]))).toBe(true);
    expect(noteSame(enc([el('a', 1)]), enc([el('a', 2)]))).toBe(false);
    expect(noteSame(enc([el('a', 1)]), enc([el('a', 1)], { f: { mimeType: 'image/png', created: 1 } }))).toBe(false);
  });

  it('un elemento borrado viaja como tombstone 30 días y uno más viejo se descarta', () => {
    const now = 10_000_000_000;
    const gone = (id: string, updated: number) => ({ type: 'rectangle', id, isDeleted: true, updated });
    const c = buildNoteContent([gone('nuevo', now - 1000), gone('2h', now - 2 * 3_600_000), gone('viejo', now - 31 * 86_400_000)], {}, {}, now);
    expect((c.elements as { id: string }[]).map((e) => e.id)).toEqual(['nuevo', '2h']);
  });

  it('D18: tras 2 h el tombstone sigue en lo guardado, con versión mayor que la del cliente que vuelve', () => {
    const t0 = 1_000_000_000_000;
    const rect = { type: 'rectangle', id: 'r', isDeleted: false, version: 1, updated: t0 - 1000 };
    const borrado = { ...rect, isDeleted: true, version: 2, updated: t0 };
    // El autor del borrado vuelve a guardar 2 h después: el tombstone sigue ahí (no se purga por tiempo corto).
    const guardado = buildNoteContent([borrado], {}, {}, t0 + 2 * 3_600_000).elements as (typeof borrado)[];
    expect(guardado).toHaveLength(1);
    // Quien vuelve con la versión 1 viva pierde contra el tombstone en `reconcileElements` (gana la versión mayor).
    expect(guardado[0]!.isDeleted).toBe(true);
    expect(guardado[0]!.version).toBeGreaterThan(rect.version);
  });

  it('D18: el tombstone dura exactamente 30 días', () => {
    const t0 = 1_000_000_000_000;
    const els = [{ type: 'rectangle', id: 'r', isDeleted: true, updated: t0 }];
    expect(buildNoteContent(els, {}, {}, t0 + TOMBSTONE_TTL_MS).elements).toHaveLength(1);
    expect(buildNoteContent(els, {}, {}, t0 + TOMBSTONE_TTL_MS + 1).elements).toHaveLength(0);
  });
});

describe('pickBackground', () => {
  it('toma el fondo remoto si el local no lo cambió', () => {
    expect(pickBackground('#fff', '#fff', '#ffe')).toBe('#ffe');
    expect(pickBackground(undefined, '#ffffff', '#123456')).toBe('#123456');
  });
  it('conserva el local si lo cambió y el remoto no lo cambió o también lo cambió', () => {
    expect(pickBackground('#000', '#fff', '#fff')).toBe('#000');
    expect(pickBackground('#000', '#fff', '#ffe')).toBe('#000');
  });
});
