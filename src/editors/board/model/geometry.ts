import type { BoardNode, XY } from './board';
import { DEFAULT_SIZE } from './board';

// Invariante 4: los hijos guardan su posición relativa al padre; las operaciones geométricas
// trabajan en absolutas con toAbsolute/toRelative.

type NodeIndex = readonly BoardNode[] | ReadonlyMap<string, BoardNode>;

const asMap = (nodes: NodeIndex): ReadonlyMap<string, BoardNode> =>
  nodes instanceof Map ? nodes : new Map((nodes as readonly BoardNode[]).map((n) => [n.id, n]));

/** Posición absoluta: suma las posiciones de la cadena de padres. */
export function toAbsolute(node: BoardNode, nodes: NodeIndex): XY {
  const byId = asMap(nodes);
  let x = node.position.x;
  let y = node.position.y;
  const seen = new Set<string>([node.id]);
  let p = node.parentId ? byId.get(node.parentId) : undefined;
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    x += p.position.x;
    y += p.position.y;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return { x, y };
}

/** Posición relativa a `parentId` (o la misma absoluta si no hay padre). */
export function toRelative(abs: XY, parentId: string | undefined, nodes: NodeIndex): XY {
  const byId = asMap(nodes);
  const parent = parentId ? byId.get(parentId) : undefined;
  if (!parent) return { x: abs.x, y: abs.y };
  const pa = toAbsolute(parent, byId);
  return { x: abs.x - pa.x, y: abs.y - pa.y };
}

/** Tamaño efectivo: medido por React Flow, o el declarado, o el por defecto del tipo. */
export function nodeSize(node: BoardNode): { width: number; height: number } {
  const d = DEFAULT_SIZE[node.data.kind];
  return {
    width: node.measured?.width ?? node.width ?? d.width,
    height: node.measured?.height ?? node.height ?? d.height,
  };
}

/** Ordena con los padres antes que sus hijos conservando el orden relativo del resto. Estable y sin recursión infinita. */
export function sortParentsFirst(nodes: readonly BoardNode[]): BoardNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: BoardNode[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (n: BoardNode) => {
    if (done.has(n.id) || visiting.has(n.id)) return;
    visiting.add(n.id);
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) visit(parent);
    visiting.delete(n.id);
    done.add(n.id);
    out.push(n);
  };
  nodes.forEach(visit);
  return out;
}

/** Ids de todos los descendientes de `id` (útil para no reparentar un frame dentro de sí mismo). */
export function descendantsOf(id: string, nodes: readonly BoardNode[]): Set<string> {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId && (n.parentId === id || out.has(n.parentId)) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

export interface NodeAtPointOptions {
  /** Ids que no cuentan (el nodo arrastrado y sus descendientes). */
  exclude?: ReadonlySet<string>;
  /** Por defecto solo los frames pueden contener nodos. */
  accepts?: (n: BoardNode) => boolean;
}

/** El contenedor más al frente (último del array) que contiene el punto absoluto, o `undefined`. */
export function nodeAtPoint(
  point: XY,
  nodes: readonly BoardNode[],
  opts: NodeAtPointOptions = {},
): BoardNode | undefined {
  const accepts = opts.accepts ?? ((n: BoardNode) => n.data.kind === 'frame');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let hit: BoardNode | undefined;
  for (const n of nodes) {
    if (opts.exclude?.has(n.id) || !accepts(n)) continue;
    const { x, y } = toAbsolute(n, byId);
    const { width, height } = nodeSize(n);
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) hit = n;
  }
  return hit;
}
