import { reconcileElements } from '@excalidraw/excalidraw';
import type { AppState } from '@excalidraw/excalidraw/types';
import type { ContentMerger } from '@/application/ports';
import { decodeNote, encodeNote, pickBackground, unionFiles, type NoteContent } from './codec';

type Els = Parameters<typeof reconcileElements>;

/**
 * Fusión por elemento de dos versiones de una nota (cada elemento lleva su `version`/`versionNonce`; los
 * borrados viajan como elementos `isDeleted`). `local` manda en los empates de edición de la persona. Con
 * `knownBg` (el fondo del último contenido del servidor visto) el fondo también se fusiona; sin él manda el local.
 */
export function mergeNoteContent(local: NoteContent, remote: NoteContent, knownBg?: string): NoteContent {
  // `reconcileElements` solo mira del appState lo que se está editando; en un guardado no hay nada en curso.
  const elements = reconcileElements(local.elements as Els[0], remote.elements as Els[1], {} as AppState);
  const bg = knownBg === undefined ? local.appState.viewBackgroundColor : pickBackground(local.appState.viewBackgroundColor, knownBg, remote.appState.viewBackgroundColor);
  return { ...local, elements, appState: bg ? { viewBackgroundColor: bg } : {}, files: unionFiles(local.files, remote.files) };
}

export const mergeNoteData = (knownBg?: string): ContentMerger => (local, remote) =>
  encodeNote(mergeNoteContent(decodeNote(local), decodeNote(remote), knownBg));

/** Reconcilia la escena viva con lo recibido (lo hace el lienzo con `updateScene`). */
export const reconcileScene = reconcileElements;
