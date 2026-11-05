import type { BoardNode } from '../model/board';
import {
  descendantsOf,
  nodeAtPoint,
  nodeSize,
  sortParentsFirst,
  toAbsolute,
  toRelative,
} from '../model/geometry';

/**
 * Reparentar al soltar (invariante 4): el contenedor lo decide el centro del nodo y la posición se convierte
 * para que la absoluta no cambie (sin saltos). Solo los frames contienen nodos. Los nodos cuyo padre se mueve
 * con ellos (ambos en `ids`) no se tocan. Devuelve el mismo array si nada cambia.
 */
export function reparentNodes(nodes: BoardNode[], ids: ReadonlySet<string>): BoardNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const next = new Map<string, BoardNode>();

  for (const n of nodes) {
    if (!ids.has(n.id) || n.data.locked) continue;
    if (n.parentId && ids.has(n.parentId)) continue;
    const abs = toAbsolute(n, byId);
    const { width, height } = nodeSize(n);
    const exclude = descendantsOf(n.id, nodes);
    exclude.add(n.id);
    const target = nodeAtPoint({ x: abs.x + width / 2, y: abs.y + height / 2 }, nodes, { exclude });
    if (target?.id === n.parentId) continue;
    const moved: BoardNode = { ...n, position: toRelative(abs, target?.id, byId) };
    if (target) moved.parentId = target.id;
    else delete moved.parentId;
    next.set(n.id, moved);
  }

  if (next.size === 0) return nodes;
  return sortParentsFirst(nodes.map((n) => next.get(n.id) ?? n));
}
