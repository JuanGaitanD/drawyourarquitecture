import { temporal, type TemporalState } from 'zundo';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
  BoardContent,
  BoardEdge,
  BoardEdgeData,
  BoardNode,
  BoardNodeData,
  IconName,
  NodeStyle,
  ShapeKind,
  Viewport,
} from '../model/board';
import { sortParentsFirst, toAbsolute, toRelative } from '../model/geometry';
import { canon } from '../model/merge';

// Store por instancia (invariante 6): zustand vanilla + zundo con partialize (solo nodes y edges, sin estado
// de runtime), límite 100 y un gesto = un paso.

/** `style` puede ser parcial: se mezcla con el estilo de cada nodo. */
export type NodeDataPatch = Partial<Omit<BoardNodeData, 'style'>> & { style?: Partial<NodeStyle> };

export type Tool = 'select' | 'hand' | 'shape' | 'text' | 'sticky' | 'frame' | 'connector' | 'icon' | 'image';

export interface BoardState {
  nodes: BoardNode[];
  edges: BoardEdge[];
  tool: Tool;
  pendingShape: ShapeKind;
  pendingIcon: IconName;
  gridOn: boolean;
  snapOn: boolean;
  /** Id del nodo o la arista cuyo texto se edita (superset del contrato: lo usan nodos y canvas). */
  editingId: string | null;

  /** Reemplaza el contenido y limpia el historial. */
  load(content: BoardContent): void;
  toContent(viewport: Viewport): BoardContent;
  /** Aplica lo que llega de otra persona: no entra al historial local ni lo borra. */
  applyRemote(nodes: BoardNode[], edges: BoardEdge[]): void;
  /** Reemplaza nodos y aristas (entra al historial: importar y plantillas son deshacibles). */
  replaceAll(nodes: BoardNode[], edges: BoardEdge[]): void;
  addNodes(nodes: BoardNode[]): void;
  addEdges(edges: BoardEdge[]): void;
  /** `patch.style` se mezcla con el estilo actual (puede ser parcial). */
  updateNodeData(ids: readonly string[], patch: NodeDataPatch): void;
  updateEdgeData(ids: readonly string[], patch: Partial<BoardEdgeData>): void;
  setNodes(fn: (nodes: BoardNode[]) => BoardNode[]): void;
  setEdges(fn: (edges: BoardEdge[]) => BoardEdge[]): void;
  /** Borra lo seleccionado, los hijos de un frame y las aristas colgantes, en un solo paso. Lo bloqueado no. */
  removeSelected(): void;
  setTool(tool: Tool): void;
  setEditingId(id: string | null): void;
  /** Guarda el snapshot y pausa el historial. */
  beginGesture(): void;
  /** Reanuda el historial y empuja el snapshot: un gesto = un paso. */
  endGesture(): void;
}

export type HistoryState = Pick<BoardState, 'nodes' | 'edges'>;
export type BoardStore = StoreApi<BoardState> & { temporal: StoreApi<TemporalState<HistoryState>> };

export const HISTORY_LIMIT = 100;

/** Estado de runtime de React Flow: ni se persiste ni entra al historial. */
type Runtime = { selected?: boolean; dragging?: boolean; measured?: unknown; resizing?: boolean };

export function cleanNodes(nodes: readonly BoardNode[]): BoardNode[] {
  return nodes.map((n) => {
    const { selected: _s, dragging: _d, measured: _m, resizing: _r, ...rest } = n as BoardNode & Runtime;
    return rest as BoardNode;
  });
}
export function cleanEdges(edges: readonly BoardEdge[]): BoardEdge[] {
  return edges.map((e) => {
    const { selected: _s, ...rest } = e;
    return rest as BoardEdge;
  });
}

const partialize = (s: BoardState): HistoryState => ({
  nodes: cleanNodes(s.nodes),
  edges: cleanEdges(s.edges),
});
// ponytail: igualdad por JSON, O(n) por cambio; con tableros muy grandes pasar a comparar por referencia.
const same = (a: HistoryState, b: HistoryState) => JSON.stringify(a) === JSON.stringify(b);

const diffIds = (a: readonly { id: string }[], b: readonly { id: string }[]) => {
  const A = new Map(a.map((e) => [e.id, canon(e)]));
  const B = new Map(b.map((e) => [e.id, canon(e)]));
  return new Set([...A.keys(), ...B.keys()].filter((id) => A.get(id) !== B.get(id)));
};

/**
 * Lleva a un paso del historial lo que cambió el remoto entre `before` y `after`: sus altas y ediciones se copian,
 * sus borrados se quitan. Así deshacer/rehacer solo toca lo propio. Lo que queda colgando (padre o extremo de
 * arista ausente en ese paso) se pasa a la raíz conservando la posición absoluta o se descarta.
 */
function rebaseOnRemote(h: Partial<HistoryState>, before: HistoryState, after: HistoryState): HistoryState {
  const apply = <T extends { id: string }>(items: readonly T[], touched: Set<string>, now: readonly T[]) => {
    const nowById = new Map(now.map((e) => [e.id, e]));
    const out = items.filter((e) => !touched.has(e.id) || nowById.has(e.id)).map((e) => (touched.has(e.id) ? nowById.get(e.id)! : e));
    const have = new Set(out.map((e) => e.id));
    for (const id of touched) if (!have.has(id) && nowById.has(id)) out.push(nowById.get(id)!);
    return out;
  };
  const merged = apply(h.nodes ?? [], diffIds(before.nodes, after.nodes), after.nodes);
  const ids = new Set(merged.map((n) => n.id));
  const everyNode = new Map([...after.nodes, ...merged].map((n) => [n.id, n] as const));
  const nodes = sortParentsFirst(
    merged.map((n) => {
      if (!n.parentId || ids.has(n.parentId)) return n;
      const { parentId: _p, ...rest } = n;
      return { ...rest, position: toAbsolute(n, everyNode) } as BoardNode;
    }),
  );
  const edges = apply(h.edges ?? [], diffIds(before.edges, after.edges), after.edges).filter(
    (e) => ids.has(e.source) && ids.has(e.target),
  );
  return { nodes, edges };
}

/** Tras deshacer/rehacer devuelve a los nodos su `selected` y `measured` (el historial no los guarda). */
function restoreRuntime(prev: readonly BoardNode[], next: BoardNode[]): BoardNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const p = byId.get(n.id) as (BoardNode & Runtime) | undefined;
    if (!p) return n;
    const out: BoardNode & Runtime = { ...n };
    if (p.measured) out.measured = p.measured;
    if (p.selected) out.selected = true;
    return out;
  });
}

/** Un store por instancia (invariante 6): dos pestañas o un embed no comparten estado. */
export function createBoardStore(): BoardStore {
  let gesture: HistoryState | null = null;

  const store: BoardStore = createStore<BoardState>()(
    temporal(
      (set, get) => ({
        nodes: [],
        edges: [],
        tool: 'select',
        pendingShape: 'rectangle',
        pendingIcon: 'server',
        gridOn: true,
        snapOn: true,
        editingId: null,

        load(content) {
          const t = store.temporal.getState();
          t.pause();
          gesture = null;
          set({
            nodes: sortParentsFirst(content.nodes),
            edges: content.edges,
            editingId: null,
            tool: 'select',
          });
          t.clear();
          t.resume();
        },
        toContent: (viewport) => {
          const { nodes, edges } = get();
          return { schemaVersion: 1, nodes: cleanNodes(nodes), edges: cleanEdges(edges), viewport };
        },
        applyRemote(nodes, edges) {
          const before = partialize(get());
          const next = sortParentsFirst(nodes);
          const after: HistoryState = { nodes: cleanNodes(next), edges: cleanEdges(edges) };
          const rebase = (h: Partial<HistoryState>) => rebaseOnRemote(h, before, after);
          store.temporal.getState().pause();
          set({ nodes: next, edges });
          // El historial local no debe revertir lo ajeno: lo que cambió el remoto se lleva a cada paso guardado.
          const t = store.temporal.getState();
          store.temporal.setState({ pastStates: t.pastStates.map(rebase), futureStates: t.futureStates.map(rebase) });
          if (gesture) gesture = rebase(gesture);
          else t.resume();
        },
        replaceAll: (nodes, edges) => set({ nodes: sortParentsFirst(nodes), edges }),
        addNodes: (nodes) => set((s) => ({ nodes: sortParentsFirst([...s.nodes, ...nodes]) })),
        addEdges: (edges) => set((s) => ({ edges: [...s.edges, ...edges] })),
        updateNodeData: (ids, patch) => {
          const only = new Set(ids);
          set((s) => ({
            nodes: s.nodes.map((n) =>
              only.has(n.id)
                ? { ...n, data: { ...n.data, ...patch, style: { ...n.data.style, ...patch.style } } }
                : n,
            ),
          }));
        },
        updateEdgeData: (ids, patch) => {
          const only = new Set(ids);
          set((s) => ({
            edges: s.edges.map((e) => (only.has(e.id) ? { ...e, data: { ...e.data!, ...patch } } : e)),
          }));
        },
        setNodes: (fn) => set((s) => ({ nodes: fn(s.nodes) })),
        setEdges: (fn) => set((s) => ({ edges: fn(s.edges) })),
        removeSelected: () =>
          set((s) => {
            const gone = new Set(s.nodes.filter((n) => n.selected && !n.data.locked).map((n) => n.id));
            // Padres antes que hijos: un descendiente bloqueado sobrevive (y con él su propio subárbol).
            for (const n of s.nodes) if (n.parentId && gone.has(n.parentId) && !n.data.locked) gone.add(n.id);
            const byId = new Map(s.nodes.map((n) => [n.id, n]));
            const nodes = s.nodes
              .filter((n) => !gone.has(n.id))
              .map((n) => {
                if (!n.parentId || !gone.has(n.parentId)) return n;
                // Reparenta al ancestro superviviente conservando la posición absoluta.
                let a = byId.get(n.parentId);
                while (a?.parentId && gone.has(a.id)) a = byId.get(a.parentId);
                const parentId = a && !gone.has(a.id) ? a.id : undefined;
                const moved: BoardNode = { ...n, position: toRelative(toAbsolute(n, byId), parentId, byId) };
                if (parentId) moved.parentId = parentId;
                else delete moved.parentId;
                return moved;
              });
            const edges = s.edges.filter((e) => !e.selected && !gone.has(e.source) && !gone.has(e.target));
            return nodes.length === s.nodes.length && edges.length === s.edges.length ? s : { nodes, edges };
          }),
        setTool: (tool) => set({ tool }),
        setEditingId: (editingId) => set({ editingId }),

        beginGesture() {
          if (gesture) return;
          gesture = partialize(get());
          store.temporal.getState().pause();
        },
        endGesture() {
          const t = store.temporal.getState();
          t.resume();
          const start = gesture;
          gesture = null;
          if (!start || same(start, partialize(get()))) return;
          store.temporal.setState({
            pastStates: [...t.pastStates, start].slice(-HISTORY_LIMIT),
            futureStates: [],
          });
        },
      }),
      { partialize, equality: same, limit: HISTORY_LIMIT },
    ),
  );

  // undo/redo devuelven a los nodos su selección y medida (partialize las descarta).
  const t = store.temporal;
  for (const k of ['undo', 'redo'] as const) {
    const orig = t.getState()[k];
    t.setState({
      [k]: (steps?: number) => {
        const prev = store.getState().nodes;
        orig(steps);
        store.setState((s) => ({ nodes: restoreRuntime(prev, s.nodes) }));
      },
    });
  }
  return store;
}
