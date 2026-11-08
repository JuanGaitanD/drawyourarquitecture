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
import { deepEqual, diffById } from '../model/merge';

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
  /** Conector por clic: id del nodo de origen ya elegido (runtime: ni se guarda ni entra al historial). */
  connectFrom: string | null;

  /** Reemplaza el contenido y limpia el historial. */
  load(content: BoardContent): void;
  toContent(viewport: Viewport): BoardContent;
  /** Aplica lo que llega de otra persona: no entra al historial local ni lo borra. */
  applyRemote(nodes: BoardNode[], edges: BoardEdge[]): void;
  /** Reemplaza nodos y aristas (entra al historial: importar y plantillas son deshacibles). */
  replaceAll(nodes: BoardNode[], edges: BoardEdge[]): void;
  addNodes(nodes: BoardNode[]): void;
  /**
   * Inserta, selecciona y vuelve a la herramienta de selección. Con `edit` abre la edición del texto y mantiene
   * el historial en pausa hasta que termina: crear y escribir la etiqueta es UN paso (deshacer quita el nodo).
   */
  insertNode(node: BoardNode, edit: boolean): void;
  addEdges(edges: BoardEdge[]): void;
  /** `patch.style` se mezcla con el estilo actual (puede ser parcial). */
  updateNodeData(ids: readonly string[], patch: NodeDataPatch): void;
  updateEdgeData(ids: readonly string[], patch: Partial<BoardEdgeData>): void;
  setNodes(fn: (nodes: BoardNode[]) => BoardNode[]): void;
  setEdges(fn: (edges: BoardEdge[]) => BoardEdge[]): void;
  /** Borra lo seleccionado, los hijos de un frame y las aristas colgantes, en un solo paso. Lo bloqueado no. */
  removeSelected(): void;
  /** Cambiar de herramienta cancela el origen pendiente del conector. */
  setTool(tool: Tool): void;
  setConnectFrom(id: string | null): void;
  /** Al dejar de editar el nodo recién creado se cierra el paso de historial de su creación. */
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

// Limpiar un elemento es puro: el resultado se recuerda por objeto (WeakMap). Un nodo que no cambió devuelve la
// MISMA referencia limpia en cada llamada; es lo que permite comparar el historial por referencia. El resultado
// no se muta (los llamantes copian).
const cleanNodeMemo = new WeakMap<BoardNode, BoardNode>();
const cleanEdgeMemo = new WeakMap<BoardEdge, BoardEdge>();
const RUNTIME_KEYS = ['selected', 'dragging', 'measured', 'resizing'] as const;

function cleanNode(n: BoardNode): BoardNode {
  let out = cleanNodeMemo.get(n);
  if (!out) {
    if (RUNTIME_KEYS.some((k) => k in n)) {
      const { selected: _s, dragging: _d, measured: _m, resizing: _r, ...rest } = n as BoardNode & Runtime;
      out = rest as BoardNode;
    } else out = n;
    cleanNodeMemo.set(n, out);
  }
  return out;
}
function cleanEdge(e: BoardEdge): BoardEdge {
  let out = cleanEdgeMemo.get(e);
  if (!out) {
    if ('selected' in e) {
      const { selected: _s, ...rest } = e;
      out = rest as BoardEdge;
    } else out = e;
    cleanEdgeMemo.set(e, out);
  }
  return out;
}
export const cleanNodes = (nodes: readonly BoardNode[]): BoardNode[] => nodes.map(cleanNode);
export const cleanEdges = (edges: readonly BoardEdge[]): BoardEdge[] => edges.map(cleanEdge);

/** Un `partialize` por store: la misma pareja de arrays devuelve el mismo estado limpio (zundo lo pide dos veces por cambio). */
function createPartialize() {
  let nodes: readonly BoardNode[] | null = null;
  let edges: readonly BoardEdge[] | null = null;
  let out: HistoryState = { nodes: [], edges: [] };
  return (s: BoardState): HistoryState => {
    if (s.nodes !== nodes || s.edges !== edges) {
      nodes = s.nodes;
      edges = s.edges;
      out = { nodes: cleanNodes(s.nodes), edges: cleanEdges(s.edges) };
    }
    return out;
  };
}

/** Por referencia: elementos limpios iguales (misma referencia) salvo los que cambiaron, que se comparan a fondo. */
const sameList = <T>(a: readonly T[], b: readonly T[]) =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i] || deepEqual(x, b[i])));
const same = (a: HistoryState, b: HistoryState) => sameList(a.nodes, b.nodes) && sameList(a.edges, b.edges);

/**
 * Lleva a un paso del historial lo que cambió el remoto entre `before` y `after`: sus altas y ediciones se copian,
 * sus borrados se quitan. Así deshacer/rehacer solo toca lo propio. Lo que queda colgando (padre o extremo de
 * arista ausente en ese paso) se pasa a la raíz conservando la posición absoluta o se descarta.
 */
interface RemoteDelta {
  nodes: Set<string>;
  edges: Set<string>;
  nodesNow: Map<string, BoardNode>;
  edgesNow: Map<string, BoardEdge>;
  after: HistoryState;
}
/** Qué cambió el remoto, por id y una sola vez (no una por cada paso del historial). */
function remoteDelta(before: HistoryState, after: HistoryState): RemoteDelta {
  return {
    nodes: diffById(before.nodes, after.nodes),
    edges: diffById(before.edges, after.edges),
    nodesNow: new Map(after.nodes.map((n) => [n.id, n])),
    edgesNow: new Map(after.edges.map((e) => [e.id, e])),
    after,
  };
}

function rebaseOnRemote(h: Partial<HistoryState>, d: RemoteDelta): HistoryState {
  // Sin cambios ajenos no hay nada que llevar al paso: se devuelve tal cual (misma referencia).
  if (!d.nodes.size && !d.edges.size) return { nodes: h.nodes ?? [], edges: h.edges ?? [] };
  const after = d.after;
  // Nodos: lo que no tocó el remoto pasa tal cual; lo editado se sustituye, lo borrado se quita, lo nuevo se añade.
  // Solo hace falta reordenar (padres antes que hijos) si hay altas o un cambio de padre.
  const merged: BoardNode[] = [];
  const touchedHere = new Set<string>();
  let needSort = false;
  for (const e of h.nodes ?? []) {
    if (!d.nodes.has(e.id)) {
      merged.push(e);
      continue;
    }
    const now = d.nodesNow.get(e.id);
    if (!now) continue; // borrado ajeno
    if (now.parentId !== e.parentId) needSort = true;
    touchedHere.add(e.id);
    merged.push(now);
  }
  for (const id of d.nodes) {
    const now = d.nodesNow.get(id);
    if (now && !touchedHere.has(id)) {
      merged.push(now);
      needSort = true;
    }
  }
  const ids = new Set(merged.map((n) => n.id));
  let everyNode: Map<string, BoardNode> | null = null; // solo si hay algún huérfano
  const fixed = merged.map((n) => {
    if (!n.parentId || ids.has(n.parentId)) return n;
    everyNode ??= new Map([...after.nodes, ...merged].map((x) => [x.id, x] as const));
    const { parentId: _p, ...rest } = n;
    return { ...rest, position: toAbsolute(n, everyNode) } as BoardNode;
  });
  const nodes = needSort ? sortParentsFirst(fixed) : fixed;
  const edgesNow = h.edges ?? [];
  const edgeOut = edgesNow
    .filter((e) => !d.edges.has(e.id) || d.edgesNow.has(e.id))
    .map((e) => (d.edges.has(e.id) ? d.edgesNow.get(e.id)! : e));
  const haveEdge = new Set(edgeOut.map((e) => e.id));
  for (const id of d.edges) if (!haveEdge.has(id) && d.edgesNow.has(id)) edgeOut.push(d.edgesNow.get(id)!);
  const edges = edgeOut.filter((e) => ids.has(e.source) && ids.has(e.target));
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
  const partialize = createPartialize();
  let gesture: HistoryState | null = null;
  /** Nodo recién creado cuya edición de texto mantiene abierto el gesto de historial (ver `insertNode`). */
  let creating: string | null = null;

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
        connectFrom: null,

        load(content) {
          const t = store.temporal.getState();
          t.pause();
          gesture = null;
          creating = null;
          set({
            nodes: sortParentsFirst(content.nodes),
            edges: content.edges,
            editingId: null,
            connectFrom: null,
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
          const delta = remoteDelta(before, after);
          const rebase = (h: Partial<HistoryState>) => rebaseOnRemote(h, delta);
          store.temporal.getState().pause();
          set({ nodes: next, edges });
          // El historial local no debe revertir lo ajeno: lo que cambió el remoto se lleva a cada paso guardado.
          const t = store.temporal.getState();
          store.temporal.setState({ pastStates: t.pastStates.map(rebase), futureStates: t.futureStates.map(rebase) });
          if (gesture) gesture = rebase(gesture);
          else t.resume();
          // Si el remoto borró el nodo que se estaba escribiendo, no queda quien cierre el gesto.
          if (creating !== null && !next.some((n) => n.id === creating)) get().setEditingId(null);
        },
        replaceAll: (nodes, edges) => set({ nodes: sortParentsFirst(nodes), edges }),
        addNodes: (nodes) => set((s) => ({ nodes: sortParentsFirst([...s.nodes, ...nodes]) })),
        insertNode(node, edit) {
          if (edit && !gesture) {
            get().beginGesture();
            creating = node.id;
          }
          set((s) => ({
            nodes: sortParentsFirst([
              ...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
              { ...node, selected: true },
            ]),
            tool: 'select',
            editingId: edit ? node.id : null,
          }));
        },
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
        setTool: (tool) =>
          set((s) => {
            // El conector por clic empieza sin selección: el panel de estilo taparía el aviso y los clics ya no seleccionan.
            const clear = tool === 'connector' && (s.nodes.some((n) => n.selected) || s.edges.some((e) => e.selected));
            return clear
              ? {
                  tool,
                  connectFrom: null,
                  nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
                  edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
                }
              : { tool, connectFrom: null };
          }),
        setConnectFrom: (connectFrom) => set({ connectFrom }),
        setEditingId(editingId) {
          set({ editingId });
          if (creating !== null && editingId !== creating) {
            creating = null;
            get().endGesture();
          }
        },

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
