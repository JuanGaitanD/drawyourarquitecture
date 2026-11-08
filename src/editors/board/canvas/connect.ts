import { makeEdge, type BoardEdge, type BoardNode } from '../model/board';
import { nodeSize, toAbsolute } from '../model/geometry';

/**
 * Conector por clic: la arista que une `from` con `to`. Los lados son los que se miran (derecho → izquierdo si el
 * destino queda a la derecha, etc.), como los que elegiría quien arrastra desde un handle. `null` si no se puede
 * (mismo nodo, falta alguno o está bloqueado: un bloqueado no es conectable, igual que al arrastrar).
 */
export function connectEdge(from: string, to: string, nodes: readonly BoardNode[]): BoardEdge | null {
  const a = nodes.find((n) => n.id === from);
  const b = nodes.find((n) => n.id === to);
  if (!a || !b || from === to || a.data.locked || b.data.locked) return null;
  const center = (n: BoardNode) => {
    const p = toAbsolute(n, nodes);
    const { width, height } = nodeSize(n);
    return { x: p.x + width / 2, y: p.y + height / 2 };
  };
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const [sourceHandle, targetHandle] = horizontal
    ? dx >= 0 ? ['r', 'l'] : ['l', 'r']
    : dy >= 0 ? ['b', 't'] : ['t', 'b'];
  return makeEdge(from, to, { sourceHandle, targetHandle });
}
