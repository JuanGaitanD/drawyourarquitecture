import { decode } from '@/domain/codec';
import type { ProjectType } from '@/domain/project';
import type { BoardContent } from '@/editors/board/model/board';
import { validateBoardContent } from '@/editors/board/model/validate';
import type { NoteContent } from '@/editors/note/codec';

export type ParsedContent = { type: 'note'; content: NoteContent } | { type: 'board'; content: BoardContent };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Convierte el `data` guardado en el contenido de su tipo, o `null` si no es legible.
 * El board pasa por `validateBoardContent` (invariante 8); la nota solo comprueba su forma, porque
 * Excalidraw restaura y sanea sus elementos al cargarlos.
 */
export function parseContent(type: ProjectType, data: string): ParsedContent | null {
  let raw: unknown;
  try {
    raw = decode<unknown>(data);
  } catch {
    return null;
  }
  if (type === 'board') {
    const res = validateBoardContent(raw);
    return res.ok ? { type, content: res.value } : null;
  }
  if (!isObj(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.elements) || !isObj(raw.files))
    return null;
  return { type, content: raw as unknown as NoteContent };
}
