import { useMemo } from 'react';
import { useReactFlow, type ReactFlowInstance } from '@xyflow/react';
import type { BoardEdge, BoardNode, ShapeKind } from '../model/board';
import { placeBelow } from '../extras/content';
import { autoLayout } from '../model/layout';
import { parseFlowchart } from '../model/mermaid';
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
import {
  clipFromSelection,
  readSystemClipboard,
  writeSystemClipboard,
  type ClipPayload,
} from './clipboard';
import type { ShortcutAction } from './shortcuts';

// Acciones del editor compartidas por la barra de acciones, la barra de herramientas y los atajos.
// Cada una es UNA escritura en el store (setNodes, replaceAll…), así que cada una es un paso del historial.

interface Clipboard {
  clip: ClipPayload;
  pastes: number;
  /** Qué quedó en el portapapeles del sistema (ver `writeSystemClipboard`); `null` mientras se escribe. */
  system: 'full' | 'text' | 'none' | null;
}
// Copia en memoria por instancia de store: sirve de respaldo cuando el navegador no deja usar el portapapeles
// del sistema (sin API o sin permiso de lectura) y para pegar exactamente lo copiado en la misma pestaña.
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

  /** Inserta lo copiado con ids nuevos, desplazado un poco más en cada pegado y seleccionado: un paso de historial. */
  const pasteClip = (clip: { nodes: BoardNode[]; edges: BoardEdge[] }, rec: Clipboard | undefined) => {
    const s = get();
    const step = 16 * (rec ? ++rec.pastes : 1);
    const roots = clip.nodes.filter((n) => !n.parentId).map((n) => n.id);
    const dup = duplicate(clip.nodes, clip.edges, roots, { x: step, y: step });
    s.replaceAll([...selectOnly(s.nodes, []), ...dup.nodes], [...s.edges, ...dup.edges]);
  };

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
    /** Copia la selección a memoria y al portapapeles del sistema (formato propio + Mermaid). */
    copy() {
      const ids = selectedIds();
      if (!ids.length) return false;
      const s = get();
      const rec: Clipboard = { clip: clipFromSelection(s.nodes, s.edges, ids), pastes: 0, system: null };
      clipboards.set(store, rec);
      void writeSystemClipboard(rec.clip).then((r) => (rec.system = r));
      return true;
    },
    cut() {
      if (api.copy()) get().removeSelected();
    },
    /**
     * Pega, en este orden: el formato propio del portapapeles del sistema (también el de otra pestaña); la copia en
     * memoria si el sistema no tiene el formato propio porque esta pestaña no pudo escribirlo (o no se puede leer);
     * texto Mermaid. Es asíncrono: leer el portapapeles pide permiso la primera vez.
     */
    async paste() {
      const rec = clipboards.get(store);
      const sys = await readSystemClipboard();
      if (sys.kind === 'dya') return pasteClip(sys.clip, rec);
      if (rec && (sys.kind === 'unavailable' || rec.system !== 'full')) return pasteClip(rec.clip, rec);
      if (sys.kind === 'text') {
        const r = parseFlowchart(sys.text);
        if (!r.ok) return;
        const laid = await autoLayout(r.value, r.direction);
        const s = get();
        const moved = placeBelow(laid, s.nodes);
        const mark = <T extends { selected?: boolean }>(xs: T[]) => xs.map((x) => ({ ...x, selected: true }));
        s.replaceAll([...selectOnly(s.nodes, []), ...mark(moved.nodes)], [...s.edges, ...moved.edges]);
      }
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
      void a.paste();
      return;
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
