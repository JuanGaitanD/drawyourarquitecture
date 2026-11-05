import { nanoid } from 'nanoid';
import { makeNode, type BoardEdge, type BoardNode, type XY } from './board';
import { descendantsOf, nodeSize, sortParentsFirst, toAbsolute, toRelative } from './geometry';

// Operaciones puras del board (carril C2). Todas trabajan en coordenadas absolutas con
// toAbsolute/toRelative (invariante 4), no mutan la entrada y devuelven arrays nuevos; los nodos que
// no cambian conservan su referencia. Los nodos con `data.locked` no participan en las operaciones
// geométricas (alinear, distribuir, mover con flechas): ni se mueven ni cuentan para los límites.

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

const indexById = (nodes: readonly BoardNode[]) => new Map(nodes.map((n) => [n.id, n]));

/**
 * Nodos de `ids` sin ningún ancestro también incluido en `ids`. Los demás viajan con su padre
 * (su posición es relativa), así que moverlos otra vez los desplazaría el doble.
 */
export function rootsOf(nodes: readonly BoardNode[], ids: readonly string[]): BoardNode[] {
  const sel = new Set(ids);
  const byId = indexById(nodes);
  const hasSelectedAncestor = (n: BoardNode) => {
    const seen = new Set<string>([n.id]);
    let p = n.parentId ? byId.get(n.parentId) : undefined;
    while (p && !seen.has(p.id)) {
      if (sel.has(p.id)) return true;
      seen.add(p.id);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    return false;
  };
  return nodes.filter((n) => sel.has(n.id) && !hasSelectedAncestor(n));
}

const movable = (nodes: readonly BoardNode[], ids: readonly string[]) =>
  rootsOf(nodes, ids).filter((n) => !n.data.locked);

interface Box {
  node: BoardNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxesOf = (nodes: readonly BoardNode[], roots: readonly BoardNode[]): Box[] => {
  const byId = indexById(nodes);
  return roots.map((node) => ({ node, ...toAbsolute(node, byId), ...nodeSize(node) }));
};

/** Aplica posiciones absolutas nuevas (convertidas a relativas al padre original). */
function moveTo(nodes: readonly BoardNode[], targets: ReadonlyMap<string, XY>): BoardNode[] {
  const byId = indexById(nodes);
  return nodes.map((n) => {
    const abs = targets.get(n.id);
    if (!abs) return n;
    const position = toRelative(abs, n.parentId, byId);
    return position.x === n.position.x && position.y === n.position.y ? n : { ...n, position };
  });
}

export function align(nodes: readonly BoardNode[], ids: readonly string[], mode: AlignMode): BoardNode[] {
  const boxes = boxesOf(nodes, movable(nodes, ids));
  if (boxes.length < 2) return [...nodes];
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  const targets = new Map<string, XY>();
  for (const b of boxes) {
    const to = { x: b.x, y: b.y };
    if (mode === 'left') to.x = minX;
    else if (mode === 'center') to.x = (minX + maxX) / 2 - b.width / 2;
    else if (mode === 'right') to.x = maxX - b.width;
    else if (mode === 'top') to.y = minY;
    else if (mode === 'middle') to.y = (minY + maxY) / 2 - b.height / 2;
    else to.y = maxY - b.height;
    targets.set(b.node.id, to);
  }
  return moveTo(nodes, targets);
}

/** Reparte con huecos iguales entre el primero y el último (por posición); hacen falta 3 o más. */
export function distribute(
  nodes: readonly BoardNode[],
  ids: readonly string[],
  axis: 'x' | 'y',
): BoardNode[] {
  const boxes = boxesOf(nodes, movable(nodes, ids));
  if (boxes.length < 3) return [...nodes];
  const size = (b: Box) => (axis === 'x' ? b.width : b.height);
  const pos = (b: Box) => (axis === 'x' ? b.x : b.y);
  const sorted = [...boxes].sort((a, b) => pos(a) - pos(b));
  const start = pos(sorted[0]);
  const end = Math.max(...sorted.map((b) => pos(b) + size(b)));
  const gap = (end - start - sorted.reduce((s, b) => s + size(b), 0)) / (sorted.length - 1);
  const targets = new Map<string, XY>();
  let cursor = start;
  for (const b of sorted) {
    targets.set(b.node.id, axis === 'x' ? { x: cursor, y: b.y } : { x: b.x, y: cursor });
    cursor += size(b) + gap;
  }
  return moveTo(nodes, targets);
}

/** `ids` y todos sus descendientes: al mover un padre en el orden Z, sus hijos van con él. */
function withDescendants(nodes: readonly BoardNode[], ids: readonly string[]): Set<string> {
  const out = new Set(ids);
  for (const id of ids) descendantsOf(id, nodes).forEach((d) => out.add(d));
  return out;
}

/** Los padres siempre quedan antes que sus hijos. */
export function bringToFront(nodes: readonly BoardNode[], ids: readonly string[]): BoardNode[] {
  const moved = withDescendants(nodes, ids);
  return sortParentsFirst([
    ...nodes.filter((n) => !moved.has(n.id)),
    ...nodes.filter((n) => moved.has(n.id)),
  ]);
}

/** Un hijo no puede quedar detrás de su padre: si se envía solo el hijo, el padre va con él. */
export function sendToBack(nodes: readonly BoardNode[], ids: readonly string[]): BoardNode[] {
  const moved = withDescendants(nodes, ids);
  return sortParentsFirst([
    ...nodes.filter((n) => moved.has(n.id)),
    ...nodes.filter((n) => !moved.has(n.id)),
  ]);
}

/**
 * Crea un frame alrededor de la selección con `padding` (32 por defecto) y la reparenta. El frame se
 * inserta justo antes del primer seleccionado (queda detrás) y hereda el padre común si lo hay.
 * Lanza si la selección está vacía: la interfaz lo comprueba antes.
 */
export function wrapInFrame(
  nodes: readonly BoardNode[],
  ids: readonly string[],
  padding = 32,
): { nodes: BoardNode[]; frameId: string } {
  const boxes = boxesOf(nodes, rootsOf(nodes, ids));
  if (boxes.length === 0) throw new RangeError('wrapInFrame: la selección está vacía.');
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  const origin = { x: minX - padding, y: minY - padding };

  const parents = new Set(boxes.map((b) => b.node.parentId));
  const commonParent = parents.size === 1 ? [...parents][0] : undefined;
  const frame = makeNode('frame', toRelative(origin, commonParent, indexById(nodes)));
  frame.width = maxX - minX + 2 * padding;
  frame.height = maxY - minY + 2 * padding;
  if (commonParent) frame.parentId = commonParent;

  const absById = new Map(boxes.map((b) => [b.node.id, b]));
  const first = nodes.find((n) => absById.has(n.id))?.id;
  const out: BoardNode[] = [];
  for (const n of nodes) {
    if (n.id === first) out.push(frame);
    const b = absById.get(n.id);
    out.push(b ? { ...n, parentId: frame.id, position: { x: b.x - origin.x, y: b.y - origin.y } } : n);
  }
  return { nodes: sortParentsFirst(out), frameId: frame.id };
}

/**
 * Remapea ids, aristas internas y `parentId`. Devuelve solo lo nuevo (para añadir), seleccionado y con
 * los raíz desplazados `offset`. Duplicar un padre duplica también sus descendientes.
 */
export function duplicate(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  ids: readonly string[],
  offset: XY = { x: 16, y: 16 },
): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const included = withDescendants(nodes, ids);
  const source = sortParentsFirst(nodes.filter((n) => included.has(n.id)));
  const idMap = new Map(source.map((n) => [n.id, nanoid()]));

  const newNodes = source.map((n) => {
    const { selected: _s, dragging: _d, measured: _m, parentId, ...rest } = n;
    const copy: BoardNode = {
      ...rest,
      id: idMap.get(n.id)!,
      selected: true,
      data: structuredClone(n.data),
      position: { ...n.position },
    };
    const inside = parentId !== undefined && idMap.has(parentId);
    if (inside) copy.parentId = idMap.get(parentId);
    else {
      if (parentId) copy.parentId = parentId;
      copy.position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
    }
    return copy;
  });

  const newEdges = edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => {
      const { selected: _s, ...rest } = e;
      return {
        ...rest,
        id: nanoid(),
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        data: e.data ? structuredClone(e.data) : e.data,
      } as BoardEdge;
    });
  return { nodes: newNodes, edges: newEdges };
}

/** Desplaza los seleccionados (flechas del teclado). Solo los raíz: los hijos van con su padre. */
export function nudge(
  nodes: readonly BoardNode[],
  ids: readonly string[],
  dx: number,
  dy: number,
): BoardNode[] {
  const roots = new Set(movable(nodes, ids).map((n) => n.id));
  return nodes.map((n) =>
    roots.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n,
  );
}

/** `ids = 'all'` afecta a todos los nodos (para «Desbloquear todo»). */
export function setLocked(
  nodes: readonly BoardNode[],
  ids: readonly string[] | 'all',
  locked: boolean,
): BoardNode[] {
  const sel = ids === 'all' ? null : new Set(ids);
  return nodes.map((n) =>
    (!sel || sel.has(n.id)) && !!n.data.locked !== locked ? { ...n, data: { ...n.data, locked } } : n,
  );
}

/** Marca como seleccionados exactamente los nodos de `ids` (y desmarca el resto). */
export function selectOnly(nodes: readonly BoardNode[], ids: readonly string[]): BoardNode[] {
  const sel = new Set(ids);
  return nodes.map((n) => (!!n.selected === sel.has(n.id) ? n : { ...n, selected: sel.has(n.id) }));
}
