import type { Edge, Node } from '@xyflow/react';
import { nanoid } from 'nanoid';

export type ShapeKind =
  | 'rectangle'
  | 'round_rectangle'
  | 'ellipse'
  | 'rhombus'
  | 'triangle'
  | 'parallelogram'
  | 'hexagon'
  | 'cylinder'
  | 'cloud'
  | 'document'
  | 'terminator'
  | 'arrow_right'
  | 'callout'
  | 'actor';
export type NodeKind = 'shape' | 'text' | 'sticky' | 'frame' | 'icon' | 'image';
export type IconName =
  | 'server'
  | 'database'
  | 'cloud'
  | 'user'
  | 'globe'
  | 'smartphone'
  | 'lock'
  | 'queue'
  | 'cpu'
  | 'hard-drive'
  | 'network'
  | 'shield'
  | 'mail'
  | 'credit-card'
  | 'box';

export interface XY {
  x: number;
  y: number;
}

export interface NodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  opacity: number;
  fontSize: number;
  textColor: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
}
export type BoardNodeData = {
  kind: NodeKind;
  shape?: ShapeKind;
  icon?: IconName;
  fileId?: string;
  label: string;
  style: NodeStyle;
  locked?: boolean;
};
export type BoardNode = Node<BoardNodeData, NodeKind>;
export type EdgePath = 'bezier' | 'straight' | 'step';
export type BoardEdgeData = {
  label?: string;
  path: EdgePath;
  markerStart: boolean;
  markerEnd: boolean;
  dashed: boolean;
  color: string;
  width: number;
};
export type BoardEdge = Edge<BoardEdgeData, 'labeled'>;
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
/** Colaboración (model/merge.ts): contador por elemento y tombstones de lo borrado. Opcional y sin él todo vale 0. */
export interface SyncInfo {
  v: Record<string, number>;
  dead: Record<string, { v: number; at: number }>;
}
export interface BoardContent {
  schemaVersion: 1;
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: Viewport;
  sync?: SyncInfo;
}

export const NODE_KINDS: readonly NodeKind[] = ['shape', 'text', 'sticky', 'frame', 'icon', 'image'];
export const SHAPES: readonly ShapeKind[] = [
  'rectangle',
  'round_rectangle',
  'ellipse',
  'rhombus',
  'triangle',
  'parallelogram',
  'hexagon',
  'cylinder',
  'cloud',
  'document',
  'terminator',
  'arrow_right',
  'callout',
  'actor',
];
export const EDGE_PATHS: readonly EdgePath[] = ['bezier', 'straight', 'step'];
/** Handles de cada nodo: arriba, derecha, abajo, izquierda (con `ConnectionMode.Loose`). */
export const HANDLES = ['t', 'r', 'b', 'l'] as const;
export type HandleId = (typeof HANDLES)[number];

export const ICONS: readonly IconName[] = [
  'server',
  'database',
  'cloud',
  'user',
  'globe',
  'smartphone',
  'lock',
  'queue',
  'cpu',
  'hard-drive',
  'network',
  'shield',
  'mail',
  'credit-card',
  'box',
];

/** Los 16 colores de sticky de miro.md (nombres de Miro, valores propios). */
export const STICKY_COLORS: Record<string, string> = {
  gray: '#e6e6e6',
  light_yellow: '#fff9b1',
  yellow: '#f5d128',
  orange: '#ff9d48',
  light_green: '#d5f692',
  green: '#8fd14f',
  dark_green: '#0ca789',
  cyan: '#12cdd4',
  light_pink: '#ffcee0',
  pink: '#ff9dce',
  violet: '#ca90e5',
  red: '#f24726',
  light_blue: '#a6ccf5',
  blue: '#2d9bf0',
  dark_blue: '#6f82d4',
  black: '#1a1a1a',
};

export const DEFAULT_SIZE: Record<NodeKind, { width: number; height: number }> = {
  shape: { width: 160, height: 96 },
  text: { width: 160, height: 40 },
  sticky: { width: 180, height: 180 },
  frame: { width: 480, height: 320 },
  icon: { width: 64, height: 64 },
  image: { width: 240, height: 160 },
};

const BASE_STYLE: NodeStyle = {
  fill: '#ffffff',
  stroke: '#1f2937',
  strokeWidth: 2,
  dashed: false,
  opacity: 1,
  fontSize: 14,
  textColor: '#111827',
  align: 'center',
  bold: false,
};
const KIND_STYLE: Record<NodeKind, Partial<NodeStyle>> = {
  shape: {},
  text: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0, align: 'left' },
  sticky: { fill: STICKY_COLORS.light_yellow, stroke: 'transparent', strokeWidth: 0 },
  frame: { fill: 'transparent', stroke: '#94a3b8', strokeWidth: 1, align: 'left' },
  icon: { fill: 'transparent' },
  image: { fill: 'transparent', stroke: 'transparent', strokeWidth: 0 },
};

export const defaultStyle = (kind: NodeKind): NodeStyle => ({ ...BASE_STYLE, ...KIND_STYLE[kind] });

/** Único punto de creación de nodos: fija nanoid, tamaño por defecto y estilo. `type === data.kind`. */
export function makeNode(kind: NodeKind, pos: XY, partial: Partial<BoardNodeData> = {}): BoardNode {
  const { width, height } = DEFAULT_SIZE[kind];
  const data: BoardNodeData = {
    label: '',
    ...partial,
    kind,
    style: { ...defaultStyle(kind), ...partial.style },
  };
  if (kind === 'shape') data.shape ??= 'rectangle';
  if (kind === 'icon') data.icon ??= 'server';
  return { id: nanoid(), type: kind, position: { x: pos.x, y: pos.y }, width, height, data };
}

/** Único punto de creación de aristas: `type: 'labeled'`, trazado en `data.path`. */
export function makeEdge(
  source: string,
  target: string,
  partial: Partial<BoardEdgeData> & { sourceHandle?: string; targetHandle?: string } = {},
): BoardEdge {
  const { sourceHandle = 'r', targetHandle = 'l', ...rest } = partial;
  return {
    id: nanoid(),
    type: 'labeled',
    source,
    target,
    sourceHandle,
    targetHandle,
    data: {
      path: 'bezier',
      markerStart: false,
      markerEnd: true,
      dashed: false,
      color: '#475569',
      width: 2,
      ...rest,
    },
  };
}

export const emptyBoard = (): BoardContent => ({
  schemaVersion: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});
