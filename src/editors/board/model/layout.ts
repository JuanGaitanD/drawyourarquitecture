import type { BoardContent } from './board';

// STUB de T0 (firma final). Lo implementa el carril D con @dagrejs/dagre (import() dinámico).

/** Reordena el contenido con dagre (compound para frames). La salida va en posiciones relativas. */
export function autoLayout(_content: BoardContent, _direction: 'LR' | 'TB'): Promise<BoardContent> {
  return Promise.reject(new Error('autoLayout: not implemented (carril D)'));
}
