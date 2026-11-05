import { ConnectionMode, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import { useTheme } from '@/ui';
import { ARIA_LABELS } from './canvas/ariaLabels';
import { toDisplayNodes } from './canvas/displayNodes';
import flow from './canvas/flow.module.css';
import { edgeTypes } from './edges';
import type { BoardContent } from './model/board';
import { BoardFilesContext, nodeTypes, type BoardFiles } from './nodes';
import { BoardStoreProvider } from './store/BoardStoreProvider';
import { createBoardStore } from './store/boardStore';
import { BoardReadonlyContext } from './store/readonly';

let loads = 0;

export interface BoardViewerProps {
  content: BoardContent;
  /** Cuando se pasa, las imágenes se leen de `projects/{id}/files` (con `files`). */
  files?: BoardFiles;
}

/**
 * Lectura del board (invariantes 6 y 7): React Flow con su propio store y sin edición. No arrastra, no conecta,
 * no selecciona y no reconecta; sí permite desplazarse y hacer zoom. Encuadra el contenido al montar.
 */
export function BoardViewer({ content, files }: BoardViewerProps) {
  const { resolved } = useTheme();
  // Un store nuevo por contenido; la `key` hace que React Flow reencuadre al llegar otro (Recargar en un embed).
  const { store, key } = useMemo(() => {
    const s = createBoardStore();
    s.getState().load(content);
    return { store: s, key: ++loads };
  }, [content]);
  const nodes = useMemo(() => toDisplayNodes(store.getState().nodes), [store]);
  const edges = store.getState().edges;

  return (
    <BoardStoreProvider store={store}>
      <BoardReadonlyContext.Provider value={true}>
        <BoardFilesContext.Provider value={files ?? null}>
          <ReactFlowProvider>
            <div style={{ width: '100%', height: '100%' }}>
              <ReactFlow
                key={key}
                className={flow.flow}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                colorMode={resolved}
                connectionMode={ConnectionMode.Loose}
                ariaLabelConfig={ARIA_LABELS}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                edgesReconnectable={false}
                nodesFocusable={false}
                edgesFocusable={false}
                deleteKeyCode={null}
                fitView
                fitViewOptions={{ padding: 0.12, maxZoom: 1.5 }}
                minZoom={0.1}
                maxZoom={4}
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: false }}
              />
            </div>
          </ReactFlowProvider>
        </BoardFilesContext.Provider>
      </BoardReadonlyContext.Provider>
    </BoardStoreProvider>
  );
}
