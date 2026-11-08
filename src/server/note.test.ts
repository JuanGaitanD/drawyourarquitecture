import { describe, expect, it } from 'vitest';
import { decodeNote as decodeEditorNote } from '../editors/note/codec';
import {
  buildNote,
  decodeNote,
  encodeNote,
  noteEmbeds,
  noteImages,
  noteSummary,
  noteText,
  orderKey,
  textToElements,
} from './note';

describe('textToElements', () => {
  it('un bloque por párrafo, apilados y con los campos que Excalidraw exige de un text', () => {
    const els = textToElements('Hola\nmundo\n\nSegundo bloque', 1000);
    expect(els).toHaveLength(2);
    const [a, b] = els;
    expect(a).toMatchObject({
      type: 'text',
      text: 'Hola\nmundo',
      originalText: 'Hola\nmundo',
      x: 0,
      y: 0,
      angle: 0,
      isDeleted: false,
      containerId: null,
      textAlign: 'left',
      verticalAlign: 'top',
      autoResize: true,
      groupIds: [],
      boundElements: null,
      updated: 1000,
    });
    for (const k of [
      'id',
      'width',
      'height',
      'seed',
      'versionNonce',
      'version',
      'fontSize',
      'fontFamily',
      'lineHeight',
      'index',
    ]) {
      expect(a).toHaveProperty(k);
    }
    expect(a.width as number).toBeGreaterThan(0);
    expect(b.y as number).toBeGreaterThan((a.y as number) + (a.height as number));
    expect(a.id).not.toBe(b.id);
  });

  it('«# » agranda el cuerpo y quita la marca; el texto vacío no genera elementos', () => {
    const [h, p] = textToElements('## Título\n\nCuerpo');
    expect(h).toMatchObject({ text: 'Título', fontSize: 28 });
    expect(p).toMatchObject({ text: 'Cuerpo', fontSize: 20 });
    expect(textToElements(' \n\n  ')).toEqual([]);
  });

  it('limita el número de bloques', () => {
    expect(() => textToElements(Array.from({ length: 2001 }, (_, i) => `b${i}`).join('\n\n'))).toThrow(
      RangeError,
    );
  });

  it('los índices fraccionarios son crecientes también al pasar de a… a b…', () => {
    const keys = Array.from({ length: 200 }, (_, i) => orderKey(i));
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(200);
  });
});

describe('nota ⇄ texto', () => {
  it('encode → decode del servidor da lo mismo que el codec del editor', () => {
    const data = encodeNote(buildNote('Uno\n\nDos'));
    const server = decodeNote(data);
    const editor = decodeEditorNote(data);
    expect(server).toEqual(editor);
    expect(server.schemaVersion).toBe(1);
  });

  it('decodeNote rechaza lo que no es una nota', () => {
    expect(() => decodeNote('{"schemaVersion":1,"nodes":[]}')).toThrow('nota válida');
    expect(() => decodeNote('no json')).toThrow();
  });

  it('noteText lee en orden de lectura, ignora borrados y no-texto', () => {
    const els = [
      { type: 'text', text: 'derecha', x: 300, y: 0 },
      { type: 'rectangle', x: 0, y: 0 },
      { type: 'text', text: 'abajo', x: 0, y: 100 },
      { type: 'text', text: 'izquierda', x: 0, y: 3 },
      { type: 'text', text: 'borrado', x: 0, y: 50, isDeleted: true },
    ];
    expect(noteText(els)).toBe('izquierda\n\nderecha\n\nabajo');
    expect(noteSummary(els)).toEqual({ total: 4, byType: { text: 3, rectangle: 1 } });
  });
});

describe('noteImages / noteEmbeds', () => {
  const el = (over: Record<string, unknown>) => ({ isDeleted: false, ...over });

  it('lista las imágenes vivas por fileId, con su mimeType y sin repetir', () => {
    const images = noteImages({
      elements: [
        el({ type: 'image', fileId: 'f1' }),
        el({ type: 'image', fileId: 'f1' }),
        el({ type: 'image', fileId: 'f2' }),
        el({ type: 'image', fileId: 'f3', isDeleted: true }),
        el({ type: 'image' }),
        el({ type: 'text', fileId: 'f4' }),
      ],
      files: { f1: { mimeType: 'image/webp', created: 1 } },
    });
    expect(images).toEqual([
      { fileId: 'f1', mimeType: 'image/webp' },
      { fileId: 'f2', mimeType: null },
    ]);
  });

  it('lista los boards incrustados (/embed/board/<id>, de cualquier origen), vivos y sin repetir', () => {
    const embeds = noteEmbeds([
      el({ type: 'embeddable', link: 'https://drawyourarchitecture.vercel.app/embed/board/abc_1' }),
      el({ type: 'embeddable', link: 'http://localhost:5173/embed/board/abc_1/' }),
      el({ type: 'embeddable', link: 'https://x.test/embed/board/def-2' }),
      el({ type: 'embeddable', link: 'https://x.test/embed/board/borrado', isDeleted: true }),
      el({ type: 'embeddable', link: 'https://youtube.com/embed/xyz' }),
      el({ type: 'embeddable', link: 'https://x.test/embed/board/q?x=1' }),
      el({ type: 'embeddable', link: '/embed/board/relativo' }),
      el({ type: 'embeddable', link: null }),
      el({ type: 'text', link: 'https://x.test/embed/board/otro' }),
    ]);
    expect(embeds).toEqual(['abc_1', 'def-2']);
  });
});
