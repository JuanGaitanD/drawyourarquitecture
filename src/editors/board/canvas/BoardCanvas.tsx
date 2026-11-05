import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  reconnectEdge,
  useReactFlow,
  useStoreApi,
  type Connection,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useCallback,
  useEffect,
  useMemo,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { nanoid } from 'nanoid';
import { useTheme, useToast } from '@/ui';
import { edgeTypes } from '../edges';
import { makeEdge, type BoardEdge, type BoardNode } from '../model/board';
import { nodeTypes, useBoardFiles } from '../nodes';
import { useBoard, useBoardStore } from '../store/BoardStoreProvider';
import { reparentNodes } from '../store/reparent';
import { ARIA_LABELS } from './ariaLabels';
import { GRID, isCreateTool, nodeForTool } from './createNode';
import { connectEdge } from './connect';
import { toDisplayNodes } from './displayNodes';
import flow from './flow.module.css';
import { optimizeImage } from '@/application/imageOptimize';
import { imageNodeSize, imageProblem, pickImage, uploadWithRetry } from './imageFile';
import { makeNode } from '../model/board';

export interface BoardCanvasProps {
  initialViewport: Viewport;
  /** Se llama al terminar de mover o hacer zoom (el editor lo guarda con retraso, aunque el contenido no cambie). */
  onViewportChange: (v: Viewport) => void;
}

const noEdit = (n: BoardNode) => n.data.locked || n.data.kind === 'image';

/**
 * Lienzo editable: crear con la herramienta, conectar, reconectar, mover (reparenta al soltar), redimensionar,
 * editar texto y bloquear. Cada gesto es un paso de historial (invariante 6).
 */
export function BoardCanvas({ initialViewport, onViewportChange }: BoardCanvasProps) {
  const store = useBoardStore();
  const nodes = useBoard((s) => s.nodes);
  const edges = useBoard((s) => s.edges);
  const tool = useBoard((s) => s.tool);
  const connectFrom = useBoard((s) => s.connectFrom);
  const gridOn = useBoard((s) => s.gridOn);
  const snapOn = useBoard((s) => s.snapOn);
  const { resolved } = useTheme();
  const { screenToFlowPosition, getViewport } = useReactFlow();
  const flowStore = useStoreApi();
  const files = useBoardFiles();
  const { toast } = useToast();

  const display = useMemo(() => toDisplayNodes(nodes, connectFrom), [nodes, connectFrom]);
  const select = tool === 'select';

  const onNodesChange: OnNodesChange<BoardNode> = useCallback(
    (changes) => store.getState().setNodes((ns) => applyNodeChanges(changes, ns)),
    [store],
  );
  const onEdgesChange: OnEdgesChange<BoardEdge> = useCallback(
    (changes) => store.getState().setEdges((es) => applyEdgeChanges(changes, es)),
    [store],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      store.getState().addEdges([
        makeEdge(c.source, c.target, {
          ...(c.sourceHandle ? { sourceHandle: c.sourceHandle } : {}),
          ...(c.targetHandle ? { targetHandle: c.targetHandle } : {}),
        }),
      ]);
    },
    [store],
  );
  const onReconnect = useCallback(
    (old: BoardEdge, c: Connection) =>
      store.getState().setEdges((es) => reconnectEdge(old, c, es, { shouldReplaceId: false })),
    [store],
  );

  const dragStart = useCallback(() => store.getState().beginGesture(), [store]);
  const dragStop = useCallback(
    (_e: unknown, _n: unknown, dragged?: Node[]) => {
      const ids = new Set((dragged ?? []).map((n) => n.id));
      if (ids.size) store.getState().setNodes((ns) => reparentNodes(ns, ids));
      store.getState().endGesture();
    },
    [store],
  );

  /** Inserta y selecciona un nodo nuevo en un solo paso de historial (con su etiqueta si se edita al crear). */
  const insert = useCallback((node: BoardNode, edit: boolean) => store.getState().insertNode(node, edit), [store]);

  const placeImage = useCallback(
    async (point: { x: number; y: number }) => {
      const upload = files?.upload;
      store.getState().setTool('select');
      if (!upload) return toast({ title: 'No se pueden añadir imágenes aquí', kind: 'error' });
      const file = await pickImage();
      if (!file) return;
      const problem = imageProblem(file);
      if (problem) return toast({ title: 'Imagen no válida', description: problem, kind: 'error' });
      let blob: Blob;
      try {
        blob = await optimizeImage(file);
      } catch (e) {
        return toast({ title: 'Imagen no válida', description: (e as Error).message, kind: 'error' });
      }
      const fileId = nanoid();
      const { width, height } = await imageNodeSize(file);
      const attempt = async (): Promise<void> => {
        try {
          await uploadWithRetry((b) => upload(fileId, b), blob);
        } catch {
          toast({
            title: 'No se pudo subir la imagen',
            kind: 'error',
            action: { label: 'Reintentar', onClick: () => void attempt() },
          });
          return;
        }
        const at = { x: point.x - width / 2, y: point.y - height / 2 };
        insert({ ...makeNode('image', at, { fileId, label: file.name }), width, height }, false);
      };
      await attempt();
    },
    [files, insert, store, toast],
  );

  const createAt = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const s = store.getState();
      const point = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const node = nodeForTool(
        { tool: s.tool, shape: s.pendingShape, icon: s.pendingIcon, snapOn: s.snapOn },
        point,
        s.nodes,
      );
      if (node) insert(node, node.data.kind !== 'icon');
    },
    [insert, screenToFlowPosition, store],
  );

  // La herramienta «imagen» abre el selector al elegirla (el clic del botón es el gesto del usuario) y coloca
  // la imagen en el centro de lo que se ve.
  useEffect(() => {
    if (tool !== 'image') return;
    const { width, height } = flowStore.getState();
    const v = getViewport();
    void placeImage({ x: (width / 2 - v.x) / v.zoom, y: (height / 2 - v.y) / v.zoom });
  }, [tool, placeImage, flowStore, getViewport]);

  const creating = isCreateTool(tool);
  // Conector por clic: el primer clic en un nodo elige el origen y el segundo en otro crea la arista (un paso de
  // historial) y vuelve a «Seleccionar». Un clic en el vacío cancela el origen; Esc, también (ver `escape`).
  const connectClick = useCallback(
    (id: string) => {
      const s = store.getState();
      if (s.nodes.find((n) => n.id === id)?.data.locked) return;
      if (!s.connectFrom || s.connectFrom === id) return s.setConnectFrom(id);
      const edge = connectEdge(s.connectFrom, id, s.nodes);
      if (edge) s.addEdges([edge]);
      s.setTool('select');
    },
    [store],
  );
  const onPaneClick = useCallback(
    (e: ReactMouseEvent) => {
      if (tool === 'connector') store.getState().setConnectFrom(null);
      else if (creating) createAt(e);
    },
    [tool, creating, createAt, store],
  );
  // Un frame cubre el lienzo bajo él: el clic de una herramienta de creación también cuenta ahí.
  const onNodeClick = useCallback(
    (e: ReactMouseEvent, n: Node) => {
      if (tool === 'connector') connectClick(n.id);
      else if (creating && n.type === 'frame') createAt(e);
    },
    [tool, creating, createAt, connectClick],
  );

  const startEdit = useCallback((id: string) => store.getState().setEditingId(id), [store]);
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"]')) return;
    if (e.key !== 'Enter' && e.key !== 'F2') return;
    const s = store.getState();
    const picked = [...s.nodes.filter((n) => n.selected), ...s.edges.filter((x) => x.selected)];
    const only = picked.length === 1 ? picked[0]! : null;
    if (!only || ('data' in only && 'kind' in (only.data ?? {}) && noEdit(only as BoardNode))) return;
    e.preventDefault();
    s.setEditingId(only.id);
  };

  return (
    <ReactFlow<BoardNode, BoardEdge>
      className={[
        flow.flow,
        creating || tool === 'connector' ? flow.tool_create : '',
        tool === 'hand' ? flow.tool_hand : '',
        tool === 'connector' ? 'board-tool-connector' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      nodes={display}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ type: 'labeled' }}
      colorMode={resolved}
      ariaLabelConfig={ARIA_LABELS}
      connectionMode={ConnectionMode.Loose}
      isValidConnection={(c) => c.source !== c.target}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onReconnect={onReconnect}
      onNodeDragStart={dragStart}
      onNodeDragStop={dragStop}
      onSelectionDragStart={dragStart}
      onSelectionDragStop={dragStop}
      onPaneClick={onPaneClick}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={(_, n) => !noEdit(n) && startEdit(n.id)}
      onEdgeDoubleClick={(_, e) => startEdit(e.id)}
      onMoveEnd={(_, v) => onViewportChange(v)}
      onKeyDown={onKeyDown}
      deleteKeyCode={null} // borra `useShortcuts` (removeSelected: respeta `locked`, un solo paso de historial)
      defaultViewport={initialViewport}
      minZoom={0.1}
      maxZoom={4}
      snapToGrid={snapOn}
      snapGrid={[GRID, GRID]}
      nodesDraggable={select}
      nodesConnectable={select || tool === 'connector'}
      elementsSelectable={select}
      edgesReconnectable={select}
      selectionOnDrag={select}
      panOnDrag={tool === 'hand' ? true : [1, 2]}
      panActivationKeyCode="Space"
      multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
      zoomOnDoubleClick={false}
    >
      {gridOn ? <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.4} /> : null}
      <MiniMap
        pannable
        zoomable
        nodeBorderRadius={2}
        nodeColor={(n) => {
          const s = (n as BoardNode).data.style;
          return s.fill !== 'transparent' ? s.fill : s.stroke;
        }}
      />
      {tool === 'connector' ? (
        <Panel position="top-center" className={flow.hint}>
          <span role="status">
            {connectFrom ? 'Elige el nodo de destino · Esc cancela' : 'Elige el nodo de origen · Esc cancela'}
          </span>
        </Panel>
      ) : null}
      {/* Cuadrícula y snap se conmutan desde la ActionBar. */}
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}
