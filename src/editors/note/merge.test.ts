// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildNoteContent, decodeNote, emptyNote, encodeNote, type NoteContent } from './codec';

// Fusión por elemento de la nota (Excalidraw `reconcileElements` real, sin mocks). Excalidraw necesita `window`
// (de ahí jsdom) y al cargarse sondea el contexto 2D del lienzo (`"filter" in ctx`), que jsdom devuelve null: se
// parchea antes de importar `./merge`, de ahí el `import()` dinámico.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
});
const { mergeNoteContent, mergeNoteData } = await import('./merge');

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

/** Elemento mínimo válido para `reconcileElements`: id, versión y un índice fraccionario. */
const rect = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  index: `a${id.length}${id}`,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  updated: NOW,
  ...over,
});
const note = (elements: unknown[], over: Partial<NoteContent> = {}): NoteContent => ({
  ...emptyNote(),
  elements,
  ...over,
});
type El = { id: string; isDeleted: boolean; version: number };
const byId = (c: NoteContent) => Object.fromEntries((c.elements as El[]).map((e) => [e.id, e]));

describe('mergeNoteContent · elementos', () => {
  it('un cliente que vuelve tras 2 h con el elemento vivo no resucita lo que el servidor ya borró', () => {
    // El otro cliente borró «b» (tombstone con versión mayor); el cliente dormido sigue con «b» vivo.
    const remote = note([rect('a'), rect('b', { isDeleted: true, version: 3, updated: NOW })]);
    const stale = note([rect('a'), rect('b', { version: 2, updated: NOW - 2 * HOUR })]);

    const merged = byId(mergeNoteContent(stale, remote));

    expect(merged.b?.isDeleted).toBe(true);
    expect(merged.a?.isDeleted).toBe(false);
  });

  it('el borrado que se hace ahora (versión mayor) gana a la copia remota viva', () => {
    const remote = note([rect('b', { version: 2 })]);
    const local = note([rect('b', { isDeleted: true, version: 3 })]);

    expect(byId(mergeNoteContent(local, remote)).b?.isDeleted).toBe(true);
  });

  it('une los elementos nuevos de ambos lados y gana la versión mayor de uno editado', () => {
    const remote = note([rect('a', { version: 4, x: 99 }), rect('r')]);
    const local = note([rect('a', { version: 2, x: 5 }), rect('l')]);

    const merged = mergeNoteContent(local, remote);

    expect(Object.keys(byId(merged)).sort()).toEqual(['a', 'l', 'r']);
    expect((merged.elements as { id: string; x: number }[]).find((e) => e.id === 'a')?.x).toBe(99);
  });

  it('un tombstone de hace menos de 30 días sobrevive al guardado y llega al cliente dormido', () => {
    // Del guardado de la nota al merge: lo borrado hace 2 h se conserva (buildNoteContent) y ahí gana al vivo.
    const saved = buildNoteContent(
      [rect('b', { isDeleted: true, version: 3, updated: NOW - 2 * HOUR })],
      {},
      {},
      NOW,
    );
    const stale = note([rect('b', { version: 2 })]);

    expect(byId(mergeNoteContent(stale, saved)).b?.isDeleted).toBe(true);
  });
});

describe('mergeNoteContent · archivos', () => {
  const png = { mimeType: 'image/png', created: 1 };

  it('une content.files de los dos lados y en un choque manda el local', () => {
    const remote = note([], { files: { r: png, c: { mimeType: 'image/png', created: 2 } } });
    const local = note([], {
      files: { l: { mimeType: 'image/webp', created: 3 }, c: { mimeType: 'image/gif', created: 9 } },
    });

    const { files } = mergeNoteContent(local, remote);

    expect(Object.keys(files).sort()).toEqual(['c', 'l', 'r']);
    expect(files.c).toEqual({ mimeType: 'image/gif', created: 9 });
  });
});

describe('mergeNoteContent · fondo', () => {
  const bg = (c: string) => ({ viewBackgroundColor: c });

  it('sin base manda el fondo local', () => {
    const merged = mergeNoteContent(
      note([], { appState: bg('#111111') }),
      note([], { appState: bg('#222222') }),
    );
    expect(merged.appState).toEqual(bg('#111111'));
  });

  it('con base y sin cambio local se toma el fondo remoto', () => {
    const merged = mergeNoteContent(
      note([], { appState: bg('#ffffff') }),
      note([], { appState: bg('#222222') }),
      '#ffffff',
    );
    expect(merged.appState).toEqual(bg('#222222'));
  });

  it('con base y cambio local pendiente no se pisa el fondo propio', () => {
    const merged = mergeNoteContent(
      note([], { appState: bg('#111111') }),
      note([], { appState: bg('#222222') }),
      '#ffffff',
    );
    expect(merged.appState).toEqual(bg('#111111'));
  });
});

describe('mergeNoteData', () => {
  it('funciona sobre el string guardado: decodifica, fusiona y vuelve a codificar', () => {
    const merge = mergeNoteData();
    const out = decodeNote(
      merge(
        encodeNote(note([rect('l')])),
        encodeNote(note([rect('r')], { files: { f: { mimeType: 'image/png', created: 1 } } })),
      ),
    );
    expect(Object.keys(byId(out)).sort()).toEqual(['l', 'r']);
    expect(Object.keys(out.files)).toEqual(['f']);
  });
});
