import type { TemporalState } from 'zundo';
import type { StoreApi } from 'zustand/vanilla';
import type {
  BoardContent,
  BoardEdge,
  BoardEdgeData,
  BoardNode,
  BoardNodeData,
  IconName,
  ShapeKind,
  Viewport,
} from '../model/board';

// STUB de T0 (firma final del contrato, plan · «Contratos»). Lo implementa el carril C1:
// zustand vanilla + zundo con partialize (solo nodes y edges), límite 100, un gesto = un paso.

export type Tool = 'select' | 'hand' | 'shape' | 'text' | 'sticky' | 'frame' | 'connector' | 'icon' | 'image';

export interface BoardState {
  nodes: BoardNode[];
  edges: BoardEdge[];
  tool: Tool;
  pendingShape: ShapeKind;
  pendingIcon: IconName;
  gridOn: boolean;
  snapOn: boolean;

  /** Reemplaza el contenido y limpia el historial. */
  load(content: BoardContent): void;
  toContent(viewport: Viewport): BoardContent;
  /** Reemplaza nodos y aristas (entra al historial: importar y plantillas son deshacibles). */
  replaceAll(nodes: BoardNode[], edges: BoardEdge[]): void;
  addNodes(nodes: BoardNode[]): void;
  addEdges(edges: BoardEdge[]): void;
  updateNodeData(ids: readonly string[], patch: Partial<BoardNodeData>): void;
  updateEdgeData(ids: readonly string[], patch: Partial<BoardEdgeData>): void;
  setNodes(fn: (nodes: BoardNode[]) => BoardNode[]): void;
  setEdges(fn: (edges: BoardEdge[]) => BoardEdge[]): void;
  removeSelected(): void;
  setTool(tool: Tool): void;
  /** Guarda el snapshot y pausa el historial. */
  beginGesture(): void;
  /** Reanuda el historial y empuja el snapshot: un gesto = un paso. */
  endGesture(): void;
}

export type HistoryState = Pick<BoardState, 'nodes' | 'edges'>;
export type BoardStore = StoreApi<BoardState> & { temporal: StoreApi<TemporalState<HistoryState>> };

/** Un store por instancia (invariante 6): dos pestañas o un embed no comparten estado. */
export function createBoardStore(): BoardStore {
  throw new Error('createBoardStore: not implemented (carril C1)');
}
