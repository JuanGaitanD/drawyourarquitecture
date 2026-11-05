import {
  DEFAULT_SIZE,
  makeNode,
  type BoardNode,
  type IconName,
  type NodeKind,
  type ShapeKind,
  type XY,
} from '../model/board';
import { nodeAtPoint, toRelative } from '../model/geometry';
import type { Tool } from '../store/boardStore';

export const GRID = 16;
const KIND: Partial<Record<Tool, NodeKind>> = {
  shape: 'shape',
  text: 'text',
  sticky: 'sticky',
  frame: 'frame',
  icon: 'icon',
};

/** Herramientas que crean un nodo al hacer clic en el lienzo. */
export const isCreateTool = (t: Tool): boolean => t in KIND;

export const snap = (v: number, on: boolean) => (on ? Math.round(v / GRID) * GRID : v);

export interface CreateOptions {
  tool: Tool;
  shape: ShapeKind;
  icon: IconName;
  snapOn: boolean;
}

/**
 * Nodo que crea la herramienta al hacer clic en `point` (coordenadas del lienzo): centrado en el clic y, si cae
 * dentro de un frame, hijo suyo con la posición relativa (invariante 4).
 */
export function nodeForTool(opts: CreateOptions, point: XY, nodes: readonly BoardNode[]): BoardNode | null {
  const kind = KIND[opts.tool];
  if (!kind) return null;
  const { width, height } = DEFAULT_SIZE[kind];
  const abs = { x: snap(point.x - width / 2, opts.snapOn), y: snap(point.y - height / 2, opts.snapOn) };
  const node = makeNode(kind, abs, {
    ...(kind === 'shape' ? { shape: opts.shape } : {}),
    ...(kind === 'icon' ? { icon: opts.icon } : {}),
  });
  const parent = nodeAtPoint(point, nodes);
  if (parent) {
    node.parentId = parent.id;
    node.position = toRelative(abs, parent.id, nodes);
  }
  return node;
}
