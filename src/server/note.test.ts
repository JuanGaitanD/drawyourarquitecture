import { describe, expect, it } from 'vitest';
import { decodeNote as decodeEditorNote } from '../editors/note/codec';
import {
  buildNote,
  EMBED_SHIFT,
  decodeNote,
  embedInNote,
  encodeNote,
  hasBoardEmbed,
  noteEmbeds,
  noteImages,
  noteSummary,
  noteText,
  orderKey,
  replaceNoteText,
  textToElements,
  type NoteContent,
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

describe('replaceNoteText', () => {
  const img: Record<string, unknown> = {
    id: 'img',
    type: 'image',
    fileId: 'f1',
    x: 0,
    y: 500,
    width: 100,
    height: 100,
    isDeleted: false,
    index: 'a5',
  };
  const emb: Record<string, unknown> = {
    id: 'emb',
    type: 'embeddable',
    link: 'https://x.test/embed/board/b1',
    x: 300,
    y: 0,
    isDeleted: false,
    index: 'a6',
  };
  const base = () => {
    const n = buildNote('# Semana del 9/10/2026\n\n- [ ] Pendiente\n\nIgual', 1);
    return {
      ...n,
      elements: [...n.elements, img, emb],
      files: { f1: { mimeType: 'image/png', created: 1 } },
    };
  };
  const live = (els: Record<string, unknown>[]) => els.filter((e) => e.isDeleted !== true);

  it('edita en su sitio lo que cambia; no toca lo igual ni lo que no es texto', () => {
    const before = base();
    const after = replaceNoteText(before, 'Semana del 9/11/2026\n\n- [x] Pendiente\n\nIgual', 99);
    const [t0, t1, t2] = before.elements;
    const [n0, n1, n2] = after.elements;
    expect(n0).toMatchObject({
      id: t0.id,
      x: t0.x,
      y: t0.y,
      fontSize: 36,
      text: 'Semana del 9/11/2026',
      originalText: 'Semana del 9/11/2026',
      version: 2,
      updated: 99,
    });
    expect(n0.versionNonce).not.toBe(t0.versionNonce);
    expect(n1).toMatchObject({ id: t1.id, text: '- [x] Pendiente', version: 2 });
    expect(n2).toBe(t2);
    expect(after.elements).toContain(img);
    expect(after.elements).toContain(emb);
    expect(after.files).toEqual(before.files);
    expect(noteText(after.elements)).toBe('Semana del 9/11/2026\n\n- [x] Pendiente\n\nIgual');
  });

  it('los bloques de más van debajo de todo con índices posteriores; los que sobran quedan como borrados', () => {
    const more = replaceNoteText(base(), 'a\n\nb\n\nc\n\nd', 5);
    const added = more.elements[more.elements.length - 1];
    expect(added).toMatchObject({ type: 'text', text: 'd', isDeleted: false });
    expect(added.y as number).toBeGreaterThan(600);
    expect((added.index as string) > 'a6').toBe(true);
    expect(noteText(more.elements)).toBe('a\n\nb\n\nc\n\nd');

    const less = replaceNoteText(base(), 'solo uno', 5);
    expect(live(less.elements)).toHaveLength(3);
    expect(less.elements.filter((e) => e.isDeleted === true)).toHaveLength(2);
    expect(less.elements.find((e) => e.isDeleted === true)).toMatchObject({ version: 2, updated: 5 });
    expect(noteText(less.elements)).toBe('solo uno');
  });

  it('texto vacío borra todo el texto y conserva imágenes y diagramas', () => {
    const r = replaceNoteText(base(), '', 5);
    expect(live(r.elements).map((e) => e.id)).toEqual(['img', 'emb']);
  });

  it('lo añadido va debajo de los textos ya editados aunque hayan crecido', () => {
    const r = replaceNoteText(buildNote('corto', 1), `${Array(10).fill('línea').join('\n')}\n\nnuevo`, 5);
    const [first, added] = r.elements;
    expect(added.y as number).toBeGreaterThanOrEqual((first.y as number) + (first.height as number));
  });

  it('una etiqueta de forma se ajusta al ancho del contenedor y se centra, sin tocar el contenedor', () => {
    const rect = {
      id: 'r',
      type: 'rectangle',
      x: 100,
      y: 100,
      width: 120,
      height: 40,
      version: 1,
      isDeleted: false,
    };
    const [label] = textToElements('Hola', 1);
    const bound = {
      ...label,
      containerId: 'r',
      x: 140,
      y: 108,
      verticalAlign: 'middle',
      textAlign: 'center',
    };
    const r = replaceNoteText(
      { ...buildNote('', 1), elements: [rect, bound] },
      'una frase bastante larga para la caja',
      5,
    );
    const [c, t] = r.elements;
    const lines = (t.text as string).split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length * 20 * 0.6 <= 110)).toBe(true);
    expect(t.originalText).toBe('una frase bastante larga para la caja');
    expect(c).toBe(rect); // el contenedor (y sus flechas conectadas) no se tocan
    expect((t.x as number) + (t.width as number) / 2).toBeCloseTo(160);
    expect((t.y as number) + (t.height as number) / 2).toBeCloseTo(
      (c.y as number) + (c.height as number) / 2,
    );
    expect(noteText(r.elements)).toBe(t.text);
  });

  it('un texto de ancho fijo conserva el ancho y ajusta las líneas a él', () => {
    const [t] = textToElements('corto', 1);
    const fixed = { ...t, width: 120, autoResize: false };
    const r = replaceNoteText(
      { ...buildNote('', 1), elements: [fixed] },
      'una corrección algo más larga que antes',
      5,
    );
    const [n] = r.elements;
    expect(n.width).toBe(120);
    expect((n.text as string).split('\n').length).toBeGreaterThan(1);
    expect(n.originalText).toBe('una corrección algo más larga que antes');
  });

  it('el ajuste no parte emojis ni quita la sangría de las líneas que caben', () => {
    const [t] = textToElements('x', 1);
    const fixed = { ...t, width: 120, autoResize: false }; // 120 / (20 × 0,6) = 10 grafemas por línea
    const at = (text: string) =>
      replaceNoteText({ ...buildNote('', 1), elements: [fixed] }, text, 5).elements[0].text as string;
    const emoji = at('123456789😀👩‍💻abc');
    expect(emoji.split('\n')).toEqual(['123456789😀', '👩‍💻abc']);
    expect(at('inicio\n    codigo')).toBe('inicio\n    codigo');
    expect(at('x\n  una línea bastante larga')).toBe('x\n  una\nlínea\nbastante\nlarga');
  });

  it('devolver el texto ya ajustado que muestra read_note no cambia nada', () => {
    const [t] = textToElements('x', 1);
    const wrapped = { ...t, text: 'una frase\nlarga', originalText: 'una frase larga', autoResize: false };
    const note = { ...buildNote('', 1), elements: [wrapped] };
    expect(replaceNoteText(note, noteText(note.elements), 5).elements[0]).toBe(wrapped);
  });
});

describe('medida', () => {
  it('el ancho cuenta grafemas: diez emojis miden lo mismo que diez letras', () => {
    const [emoji] = textToElements('😀'.repeat(10));
    const [letters] = textToElements('a'.repeat(10));
    expect(emoji.width).toBe(letters.width);
  });
});

describe('embedInNote', () => {
  const T = 1_700_000_000_000;
  const embedOf = (n: NoteContent) => n.elements.find((e) => e.type === 'embeddable')!;
  const byText = (n: NoteContent, text: string) => n.elements.find((e) => e.text === text)!;
  const box = (id: string, over: Record<string, unknown>) => ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    version: 1,
    index: 'a0',
    isDeleted: false,
    ...over,
  });

  it('sin after: debajo de todo, alineado con el texto, índice posterior y enlace que reconocen noteEmbeds y la UI', () => {
    const note = buildNote('Uno\n\nDos', T);
    const out = embedInNote(note, 'b1', undefined, T);
    const e = embedOf(out);
    const last = byText(note, 'Dos');
    expect(e).toMatchObject({
      type: 'embeddable',
      x: 0,
      width: 640,
      height: 400,
      version: 1,
      isDeleted: false,
    });
    expect(e.y).toBe((last.y as number) + (last.height as number) + 24);
    expect((e.index as string) > (last.index as string)).toBe(true);
    expect(noteEmbeds(out.elements)).toEqual(['b1']);
    expect(hasBoardEmbed(out, 'b1')).toBe(true);
    expect(out.elements.slice(0, 2)).toEqual(note.elements);
  });

  it('con after (prefijo): debajo del bloque; lo de debajo baja EMBED_SHIFT y sube versión; lo de arriba intacto', () => {
    const note = buildNote('# Piezas\n\nPlugin wigi-pmo y más\n\nSharePoint, sitio\n\nFlujo técnico', T);
    const out = embedInNote(note, 'b1', '  Plugin wigi ', T);
    const anchor = byText(out, 'Plugin wigi-pmo y más');
    expect(embedOf(out)).toMatchObject({ x: 0, y: (anchor.y as number) + (anchor.height as number) + 24 });
    for (const t of ['Piezas', 'Plugin wigi-pmo y más']) expect(byText(out, t)).toEqual(byText(note, t));
    for (const t of ['SharePoint, sitio', 'Flujo técnico']) {
      expect(byText(out, t).y).toBe((byText(note, t).y as number) + EMBED_SHIFT);
      expect(byText(out, t).version).toBe(2);
    }
    expect(noteText(out.elements)).toBe(noteText(note.elements));
  });

  it('conserva el orden de lectura de dos textos en la misma fila de 20 a distinta y', () => {
    const [a, b] = textToElements('A\n\nB', T);
    const note = { ...buildNote('Ancla', T) };
    note.elements = [...note.elements, { ...a, x: 100, y: 100 }, { ...b, x: 0, y: 109 }];
    const out = embedInNote(note, 'b1', 'Ancla', T);
    expect(noteText(out.elements)).toBe('Ancla\n\nB\n\nA');
  });

  it('after inexistente, ambiguo o vacío → RangeError', () => {
    const note = buildNote('Uno\n\nUno más', T);
    expect(() => embedInNote(note, 'b1', 'Nada', T)).toThrow(/ningún bloque/);
    expect(() => embedInNote(note, 'b1', 'Uno', T)).toThrow(/2 bloques/);
    expect(() => embedInNote(note, 'b1', '   ', T)).toThrow(RangeError);
  });

  it('unidades: una etiqueta baja con su forma; una forma que cruza la línea y el embed la cortaría → error', () => {
    const [anchor, label] = textToElements('Ancla\n\nEtiqueta', T);
    const below = {
      ...buildNote('', T),
      elements: [
        anchor,
        box('s', { y: 200, boundElements: [{ id: label.id, type: 'text' }] }),
        { ...label, y: 230, containerId: 's' },
      ],
    };
    const out = embedInNote(below, 'b1', 'Ancla', T);
    expect(out.elements.find((e) => e.id === 's')!.y).toBe(200 + EMBED_SHIFT);
    expect(byText(out, 'Etiqueta').y).toBe(230 + EMBED_SHIFT);

    // La forma empieza arriba (y 10) y baja más allá del ancla: no se mueve y el embed la taparía.
    const crossing = { ...below, elements: [anchor, box('s', { x: 0, y: 10, height: 300 })] };
    expect(() => embedInNote(crossing, 'b1', 'Ancla', T)).toThrow(/sitio limpio/);
  });

  it('marcos: un hijo de un marco que cruza la línea no baja, y si el embed corta el marco → error; after en un marco → error', () => {
    const [anchor, child] = textToElements('Ancla\n\nHijo', T);
    const frame = box('f', { type: 'frame', x: 0, y: 10, width: 800, height: 400 });
    const note = { ...buildNote('', T), elements: [anchor, frame, { ...child, y: 300, frameId: 'f' }] };
    expect(() => embedInNote(note, 'b1', 'Ancla', T)).toThrow(/sitio limpio/);

    // El marco queda a la derecha del embed: no lo corta, y su hijo no baja aunque esté por debajo.
    const aside = {
      ...note,
      elements: [anchor, { ...frame, x: 700 }, { ...child, x: 720, y: 300, frameId: 'f' }],
    };
    const out = embedInNote(aside, 'b1', 'Ancla', T);
    expect(byText(out, 'Hijo').y).toBe(300);

    const inFrame = { ...note, elements: [{ ...anchor, frameId: 'f' }, frame] };
    expect(() => embedInNote(inFrame, 'b1', 'Ancla', T)).toThrow(/marco/);
  });

  it('un cambio de orden de lectura → error: un texto suelto bajaría por debajo del hijo de un marco que no se mueve', () => {
    const [anchor, loose, child] = textToElements('Ancla\n\nSuelto\n\nHijo', T);
    const frame = box('f', { type: 'frame', x: 700, y: 10, width: 300, height: 400 });
    const note = {
      ...buildNote('', T),
      elements: [anchor, { ...loose, y: 150 }, frame, { ...child, x: 720, y: 200, frameId: 'f' }],
    };
    expect(() => embedInNote(note, 'b1', 'Ancla', T)).toThrow(/sitio limpio/);
  });

  it('hasBoardEmbed sigue la política de la UI: el enlace de producción cuenta; otro dominio o borrado, no', () => {
    const link = (origin: string, isDeleted = false) => ({
      ...buildNote('', T),
      elements: [box('e', { type: 'embeddable', link: `${origin}/embed/board/b1`, isDeleted })],
    });
    expect(hasBoardEmbed(link('https://drawyourarchitecture.vercel.app'), 'b1')).toBe(true);
    expect(hasBoardEmbed(link('https://otro.example'), 'b1')).toBe(false);
    expect(hasBoardEmbed(link('https://dya.juandgaitan.com', true), 'b1')).toBe(false);
  });
});
