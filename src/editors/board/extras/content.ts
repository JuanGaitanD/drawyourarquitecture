import { nanoid } from 'nanoid';
import type { BoardContent, BoardEdge, BoardNode } from '../model/board';
import { nodeSize, toAbsolute } from '../model/geometry';

// Helpers puros de BoardMenu (importar, plantillas, insertar). Sin React.

export type ApplyMode = 'replace' | 'insert';

/** «12 elementos y 9 conexiones» para confirmaciones y fichas. */
export function describeContent(c: Pick<BoardContent, 'nodes' | 'edges'>): string {
  const n = c.nodes.length;
  const e = c.edges.length;
  return `${n} ${n === 1 ? 'elemento' : 'elementos'} y ${e} ${e === 1 ? 'conexión' : 'conexiones'}`;
}

/** Nuevos ids para todos los nodos y aristas, conservando padres y extremos. Para insertar sin colisiones. */
export function remapIds(content: BoardContent): BoardContent {
  const ids = new Map(content.nodes.map((n) => [n.id, nanoid()]));
  const nodes: BoardNode[] = content.nodes.map((n) => ({
    ...n,
    id: ids.get(n.id) as string,
    ...(n.parentId ? { parentId: ids.get(n.parentId) } : {}),
  }));
  const edges: BoardEdge[] = content.edges.map((e) => ({
    ...e,
    id: nanoid(),
    source: ids.get(e.source) as string,
    target: ids.get(e.target) as string,
  }));
  return { ...content, nodes, edges };
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Recuadro en coordenadas absolutas de todos los nodos; `null` si no hay ninguno. */
export function absoluteBounds(nodes: readonly BoardNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of nodes) {
    const p = toAbsolute(n, nodes);
    const { width, height } = nodeSize(n);
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x + width);
    y2 = Math.max(y2, p.y + height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Desplaza el contenido entrante para que quede bajo lo que ya hay, alineado a su izquierda.
 * Solo se mueven los nodos raíz: los hijos llevan posición relativa (invariante 4).
 */
export function placeBelow(incoming: BoardContent, existing: readonly BoardNode[], gap = 80): BoardContent {
  const target = absoluteBounds(existing);
  const own = absoluteBounds(incoming.nodes);
  if (!target || !own) return incoming;
  const dx = target.x - own.x;
  const dy = target.y + target.height + gap - own.y;
  return {
    ...incoming,
    nodes: incoming.nodes.map((n) =>
      n.parentId ? n : { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } },
    ),
  };
}
