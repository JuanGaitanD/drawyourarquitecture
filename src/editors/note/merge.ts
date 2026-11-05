import { reconcileElements } from '@excalidraw/excalidraw';
import type { AppState } from '@excalidraw/excalidraw/types';
import type { ContentMerger } from '@/application/ports';
import { decodeNote, encodeNote, unionFiles, type NoteContent } from './codec';

type Els = Parameters<typeof reconcileElements>;

/**
 * Fusión por elemento de dos versiones de una nota (cada elemento lleva su `version`/`versionNonce`; los
 * borrados viajan como elementos `isDeleted`). `local` manda en los empates de edición de la persona.
 */
export function mergeNoteContent(local: NoteContent, remote: NoteContent): NoteContent {
  // `reconcileElements` solo mira del appState lo que se está editando; en un guardado no hay nada en curso.
  const elements = reconcileElements(local.elements as Els[0], remote.elements as Els[1], {} as AppState);
  return { ...local, elements, files: unionFiles(local.files, remote.files) };
}

export const mergeNoteData: ContentMerger = (local, remote) =>
  encodeNote(mergeNoteContent(decodeNote(local), decodeNote(remote)));

/** Reconcilia la escena viva con lo recibido (lo hace el lienzo con `updateScene`). */
export const reconcileScene = reconcileElements;
