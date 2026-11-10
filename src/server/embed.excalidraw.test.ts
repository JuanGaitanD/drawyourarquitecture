// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { NoteContent as EditorNote } from '../editors/note/codec';
import { parseBoardLink } from '../editors/note/embed';
import { EMBED_SHIFT, buildNote, embedInNote } from './note';

// Lo que escribe `embed_board` pasa por Excalidraw real, por los dos caminos de la app: al abrir la nota
// (`restoreElements`) y al recibirlo una pestaña abierta (`reconcileElements` sin restaurar antes, `mergeNoteContent`).
// Excalidraw necesita `window` y sondea el contexto 2D del lienzo, que jsdom no tiene (como en merge.test.ts).
// El tsconfig del servidor no incluye los tipos del DOM: se toma de `globalThis`.
vi.hoisted(() => {
  const g = globalThis as unknown as { HTMLCanvasElement: { prototype: { getContext: unknown } } };
  g.HTMLCanvasElement.prototype.getContext = () => ({});
});
const { restoreElements } = await import('@excalidraw/excalidraw');
const { mergeNoteContent } = await import('../editors/note/merge');

type Restorable = Parameters<typeof restoreElements>[0];

describe('embed_board · Excalidraw real', () => {
  const T = 1_700_000_000_000;
  const before = buildNote('# Piezas\n\nPlugin\n\nSharePoint\n\nFlujo', T);
  const after = embedInNote(before, 'b1', 'Plugin', T);
  const embedId = after.elements.at(-1)!.id;

  const check = (els: readonly Record<string, unknown>[]) => {
    const embed = els.find((e) => e.id === embedId)!;
    expect(embed).toMatchObject({ type: 'embeddable', isDeleted: false, width: 640, height: 400 });
    expect(parseBoardLink(embed.link as string, 'http://localhost')).toBe('b1');
    // Índice válido y el mayor: Excalidraw no lo reasigna y queda encima del resto.
    expect(embed.index).toBe(after.elements.at(-1)!.index);
    expect(els.every((e) => e === embed || (e.index as string) < (embed.index as string))).toBe(true);
    const y = (text: string) => els.find((e) => e.text === text)!.y;
    expect(y('SharePoint')).toBe((before.elements[2].y as number) + EMBED_SHIFT);
    expect(y('Plugin')).toBe(before.elements[1].y);
  };

  it('al abrir la nota (restoreElements) conserva el embed, su índice y los desplazamientos', () => {
    check(restoreElements(after.elements as unknown as Restorable, null, { repairBindings: true }) as never);
  });

  it('una pestaña abierta lo fusiona sin restaurarlo antes (mergeNoteContent)', () => {
    const merged = mergeNoteContent(before as EditorNote, after as EditorNote);
    check(merged.elements as never);
  });
});
