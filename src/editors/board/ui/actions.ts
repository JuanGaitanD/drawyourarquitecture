import { useMemo } from 'react';
import { useReactFlow, type ReactFlowInstance } from '@xyflow/react';
import type { ShapeKind } from '../model/board';
import { toAbsolute } from '../model/geometry';
import {
  align,
  bringToFront,
  distribute,
  duplicate,
  nudge,
  selectOnly,
  sendToBack,
  setLocked,
  wrapInFrame,
  type AlignMode,
} from '../model/ops';
import { useBoardStore } from '../store/BoardStoreProvider';
import type { BoardState, BoardStore, Tool } from '../store/boardStore';
import type { ShortcutAction } from './shortcuts';

// Acciones del editor compartidas por la barra de acciones, la barra de herramientas y los atajos.
// Cada una es UNA escritura en el store (setNodes, replaceAll…), así que cada una es un paso del historial.

interface Clipboard {
  nodes: BoardState['nodes'];
  edges: BoardState['edges'];
  ids: string[];
  pastes: number;
}
// Portapapeles en memoria por instancia de store (no entre pestañas ni editores).
// ponytail: no usa el portapapeles del sistema; añadir si hace falta pegar entre pestañas.
const clipboards = new WeakMap<BoardStore, Clipboard>();

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const motionDuration = (ms = 250) => (reducedMotion() ? 0 : ms);

export function createBoardActions(store: BoardStore, flow: () => ReactFlowInstance | null) {
  const get = () => store.getState();
  const selectedIds = () =>
    get()
      .nodes.filter((n) => n.selected)
      .map((n) => n.id);

  const api = {
    selectedIds,
    undo: () => store.temporal.getState().undo(),
    redo: () => store.temporal.getState().redo(),
    remove: () => get().removeSelected(),

    setTool(tool: Tool) {
      get().setTool(tool);
    },
    pickShape(shape: ShapeKind) {
      store.setState({ pendingShape: shape });
      get().setTool('shape');
    },
    pickIcon(icon: BoardState['pendingIcon']) {
      store.setState({ pendingIcon: icon });
      get().setTool('icon');
    },
    toggleGrid: () => store.setState((s) => ({ gridOn: !s.gridOn })),
    toggleSnap: () => store.setState((s) => ({ snapOn: !s.snapOn })),

    selectAll() {
      get().setNodes((ns) => ns.map((n) => (n.selected || n.data.locked ? n : { ...n, selected: true })));
    },
    clearSelection() {
      const s = get();
      if (s.nodes.some((n) => n.selected)) s.setNodes((ns) => selectOnly(ns, []));
      if (s.edges.some((e) => e.selected))
        s.setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    },
    escape() {
      // Conector por clic: el primer Esc cancela el origen elegido, el siguiente sale de la herramienta.
      if (get().connectFrom) get().setConnectFrom(null);
      else if (get().tool !== 'select') get().setTool('select');
      else api.clearSelection();
    },

    align(mode: AlignMode) {
      const ids = selectedIds();
      get().setNodes((ns) => align(ns, ids, mode));
    },
    distribute(axis: 'x' | 'y') {
      const ids = selectedIds();
      get().setNodes((ns) => distribute(ns, ids, axis));
    },
    bringToFront() {
      const ids = selectedIds();
      if (ids.length) get().setNodes((ns) => bringToFront(ns, ids));
    },
    sendToBack() {
      const ids = selectedIds();
      if (ids.length) get().setNodes((ns) => sendToBack(ns, ids));
    },
    group() {
      const ids = selectedIds();
      if (!ids.length) return;
      get().setNodes((ns) => {
        const r = wrapInFrame(ns, ids);
        return selectOnly(r.nodes, [r.frameId]);
      });
    },
    /** Bloquea la selección; si ya está bloqueada (o no hay selección), desbloquea. */
    toggleLock() {
      const ids = selectedIds();
      const s = get();
      if (!ids.length) {
        s.setNodes((ns) => setLocked(ns, 'all', false));
        return;
      }
      const lock = s.nodes.some((n) => n.selected && !n.data.locked);
      s.setNodes((ns) => setLocked(ns, ids, lock));
    },
    unlockAll: () => get().setNodes((ns) => setLocked(ns, 'all', false)),

    duplicate() {
      const ids = selectedIds();
      if (!ids.length) return;
      const s = get();
      const dup = duplicate(s.nodes, s.edges, ids);
      s.replaceAll([...selectOnly(s.nodes, []), ...dup.nodes], [...s.edges, ...dup.edges]);
    },
    copy() {
      const ids = selectedIds();
      if (!ids.length) return false;
      const s = get();
      clipboards.set(store, { nodes: s.nodes, edges: s.edges, ids, pastes: 0 });
      return true;
    },
    cut() {
      if (api.copy()) get().removeSelected();
    },
    paste() {
      const clip = clipboards.get(store);
      if (!clip) return;
      const s = get();
      const step = 16 * ++clip.pastes;
      const dup = duplicate(clip.nodes, clip.edges, clip.ids, { x: step, y: step });
      // Si el padre de origen ya no existe (cortado), el nodo pasa a nivel superior sin saltar de sitio.
      const alive = new Set(s.nodes.map((n) => n.id));
      const known = [...clip.nodes, ...dup.nodes];
      const nodes = dup.nodes.map((n) =>
        n.parentId && !alive.has(n.parentId) && !dup.nodes.some((d) => d.id === n.parentId)
          ? { ...n, parentId: undefined, position: toAbsolute(n, known) }
          : n,
      );
      s.replaceAll([...selectOnly(s.nodes, []), ...nodes], [...s.edges, ...dup.edges]);
    },

    /** Mueve la selección; el llamante agrupa las repeticiones con beginGesture/endGesture. */
    nudge(dx: number, dy: number) {
      const ids = selectedIds();
      if (ids.length) get().setNodes((ns) => nudge(ns, ids, dx, dy));
    },

    fitView: () => void flow()?.fitView({ padding: 0.15, duration: motionDuration() }),
    zoomToSelection() {
      const ids = selectedIds();
      if (ids.length)
        void flow()?.fitView({
          nodes: ids.map((id) => ({ id })),
          padding: 0.4,
          maxZoom: 2,
          duration: motionDuration(),
        });
    },
  };
  return api;
}

export type BoardActions = ReturnType<typeof createBoardActions>;

/** Debe llamarse dentro de <ReactFlowProvider> (usa useReactFlow para el zoom). */
export function useBoardActions(): BoardActions {
  const store = useBoardStore();
  const flow = useReactFlow();
  return useMemo(() => createBoardActions(store, () => flow), [store, flow]);
}

/** Despacha la acción de un atajo. `search` la atiende el hook (abre SearchBox). */
export function runShortcut(a: BoardActions, action: ShortcutAction): void {
  switch (action.type) {
    case 'tool':
      if (action.shape) a.pickShape(action.shape);
      else a.setTool(action.tool);
      return;
    case 'undo':
      return a.undo();
    case 'redo':
      return a.redo();
    case 'copy':
      a.copy();
      return;
    case 'cut':
      return a.cut();
    case 'paste':
      return a.paste();
    case 'duplicate':
      return a.duplicate();
    case 'selectAll':
      return a.selectAll();
    case 'delete':
      return a.remove();
    case 'group':
      return a.group();
    case 'toggleLock':
      return a.toggleLock();
    case 'bringToFront':
      return a.bringToFront();
    case 'sendToBack':
      return a.sendToBack();
    case 'fitView':
      return a.fitView();
    case 'zoomToSelection':
      return a.zoomToSelection();
    case 'toggleGrid':
      a.toggleGrid();
      return;
    case 'escape':
      return a.escape();
    case 'nudge':
      return a.nudge(action.dx, action.dy);
    case 'search':
      return;
  }
}
