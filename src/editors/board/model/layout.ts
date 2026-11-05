import type { BoardContent, BoardEdge, BoardNode } from './board';
import { nodeSize, toAbsolute } from './geometry';

// Autolayout con @dagrejs/dagre, cargado con import() dinámico (no entra en el bundle inicial).
//
// Frames: dagre no deja holgura alrededor de un clúster compound, así que se ordena por niveles,
// de dentro hacia fuera: cada frame se ordena con sus hijos (otro grafo dagre), su tamaño sale del
// recuadro de los hijos más el relleno, y en el nivel superior el frame es un nodo más de ese tamaño.
// Las aristas que cruzan un frame se asignan al frame (o al hermano) del nivel que se ordena.
// Entrada y salida respetan el invariante 4: los hijos van en posiciones relativas al padre.

export const FRAME_PADDING = 32;
export const FRAME_HEADER = 40;
const FRAME_MIN = { width: 160, height: 120 };
const NODE_SEP = 48;
const RANK_SEP = 80;

type Direction = 'LR' | 'TB';
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reordena el contenido con dagre. La salida va en posiciones relativas (hijos respecto a su frame). */
export async function autoLayout(content: BoardContent, direction: Direction): Promise<BoardContent> {
  const dagre = await import('@dagrejs/dagre');
  const byId = new Map(content.nodes.map((n) => [n.id, n]));
  const kids = new Map<string | undefined, BoardNode[]>();
  for (const n of content.nodes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : undefined;
    kids.set(key, [...(kids.get(key) ?? []), n]);
  }

  const ancestors = (id: string): string[] => {
    const out: string[] = [];
    for (let p = byId.get(id)?.parentId; p && out.length <= byId.size; p = byId.get(p)?.parentId) out.push(p);
    return out;
  };

  const placed = new Map<string, Box>(); // posición relativa a su padre y tamaño final de cada nodo

  /** Ordena a los hijos de `container`; devuelve el recuadro que ocupan, con origen en (0,0). */
  const layoutLevel = (container: string | undefined): { width: number; height: number } => {
    const items = kids.get(container) ?? [];
    if (items.length === 0) return { width: 0, height: 0 };
    const size = new Map<string, { width: number; height: number }>();
    for (const n of items) {
      if (n.data.kind === 'frame' && (kids.get(n.id)?.length ?? 0) > 0) {
        const inner = layoutLevel(n.id);
        size.set(n.id, {
          width: Math.max(inner.width + FRAME_PADDING * 2, FRAME_MIN.width),
          height: Math.max(inner.height + FRAME_PADDING * 2 + FRAME_HEADER, FRAME_MIN.height),
        });
      } else size.set(n.id, nodeSize(n));
    }

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of items) g.setNode(n.id, size.get(n.id));
    // Extremo de la arista a la altura de este nivel: el propio nodo o su ancestro hijo de `container`.
    const levelOf = (id: string): string | undefined =>
      size.has(id) ? id : ancestors(id).find((a) => size.has(a));
    const seen = new Set<string>();
    for (const e of content.edges) {
      const s = levelOf(e.source);
      const t = levelOf(e.target);
      if (!s || !t || s === t) continue;
      // Una arista entre un frame y su propio contenido no ordena nada.
      if (ancestors(e.source).includes(e.target) || ancestors(e.target).includes(e.source)) continue;
      if (seen.has(`${s}>${t}`)) continue;
      seen.add(`${s}>${t}`);
      g.setEdge(s, t);
    }
    dagre.layout(g);

    let maxX = 0;
    let maxY = 0;
    for (const n of items) {
      const { x, y } = g.node(n.id);
      const { width, height } = size.get(n.id) as { width: number; height: number };
      placed.set(n.id, { x: x - width / 2, y: y - height / 2, width, height });
      maxX = Math.max(maxX, x + width / 2);
      maxY = Math.max(maxY, y + height / 2);
    }
    // Los hijos de un frame arrancan bajo la cabecera y con relleno; el nivel raíz conserva su origen.
    const dx = container === undefined ? 0 : FRAME_PADDING;
    const dy = container === undefined ? 0 : FRAME_PADDING + FRAME_HEADER;
    for (const n of items) {
      const b = placed.get(n.id) as Box;
      placed.set(n.id, { ...b, x: b.x + dx, y: b.y + dy });
    }
    return { width: maxX, height: maxY };
  };

  layoutLevel(undefined);

  // El tablero no «salta»: el nivel raíz se ancla en la esquina superior izquierda que ya tenía.
  const roots = kids.get(undefined) ?? [];
  const origin = {
    x: Math.min(...roots.map((n) => n.position.x)),
    y: Math.min(...roots.map((n) => n.position.y)),
  };
  const nodes: BoardNode[] = content.nodes.map((n) => {
    const b = placed.get(n.id) as Box;
    const isRoot = !(n.parentId && byId.has(n.parentId));
    const position = isRoot ? { x: b.x + origin.x, y: b.y + origin.y } : { x: b.x, y: b.y };
    return n.data.kind === 'frame'
      ? { ...n, position, width: b.width, height: b.height }
      : { ...n, position };
  });

  // Asas según el sentido del flujo y la posición final (aristas hacia atrás incluidas).
  const abs = new Map(nodes.map((n) => [n.id, toAbsolute(n, nodes)]));
  const center = (n: BoardNode) => {
    const p = abs.get(n.id) as { x: number; y: number };
    const { width, height } = nodeSize(n);
    return { x: p.x + width / 2, y: p.y + height / 2 };
  };
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: BoardEdge[] = content.edges.map((e) => {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) return e;
    const a = center(s);
    const b = center(t);
    const forward = direction === 'LR' ? b.x >= a.x : b.y >= a.y;
    const [out, into] =
      direction === 'LR' ? (forward ? ['r', 'l'] : ['l', 'r']) : forward ? ['b', 't'] : ['t', 'b'];
    return { ...e, sourceHandle: out, targetHandle: into };
  });

  return { ...content, nodes, edges };
}
