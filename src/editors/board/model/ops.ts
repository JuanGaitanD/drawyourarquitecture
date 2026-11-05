import type { BoardEdge, BoardNode, XY } from './board';

// STUB de T0 (firma final). Lo implementa el carril C2 con su test (`ops.test.ts`).
// Todas trabajan en coordenadas absolutas (toAbsolute/toRelative) y devuelven arrays nuevos.

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

const pendiente = (nombre: string): never => {
  throw new Error(`ops.${nombre}: not implemented (carril C2)`);
};

export function align(_nodes: readonly BoardNode[], _ids: readonly string[], _mode: AlignMode): BoardNode[] {
  return pendiente('align');
}
export function distribute(
  _nodes: readonly BoardNode[],
  _ids: readonly string[],
  _axis: 'x' | 'y',
): BoardNode[] {
  return pendiente('distribute');
}
/** Los padres siempre quedan antes que sus hijos. */
export function bringToFront(_nodes: readonly BoardNode[], _ids: readonly string[]): BoardNode[] {
  return pendiente('bringToFront');
}
export function sendToBack(_nodes: readonly BoardNode[], _ids: readonly string[]): BoardNode[] {
  return pendiente('sendToBack');
}
/** Crea un frame alrededor de la selección con `padding` (32 por defecto) y la reparenta. */
export function wrapInFrame(
  _nodes: readonly BoardNode[],
  _ids: readonly string[],
  _padding = 32,
): { nodes: BoardNode[]; frameId: string } {
  return pendiente('wrapInFrame');
}
/** Remapea ids, aristas internas y `parentId`. Devuelve solo lo nuevo (para añadir) desplazado `offset`. */
export function duplicate(
  _nodes: readonly BoardNode[],
  _edges: readonly BoardEdge[],
  _ids: readonly string[],
  _offset: XY = { x: 16, y: 16 },
): { nodes: BoardNode[]; edges: BoardEdge[] } {
  return pendiente('duplicate');
}
