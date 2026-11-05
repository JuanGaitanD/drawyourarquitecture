import { Handle, NodeResizer, Position } from '@xyflow/react';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useBoardStore } from '../store/BoardStoreProvider';
import { useBoardReadonly } from '../store/readonly';
import styles from './nodes.module.css';

const HANDLES = [
  ['t', Position.Top],
  ['r', Position.Right],
  ['b', Position.Bottom],
  ['l', Position.Left],
] as const;

export interface NodeChromeProps {
  id: string;
  selected?: boolean;
  locked?: boolean;
  className?: string;
  keepAspectRatio?: boolean;
  minWidth?: number;
  minHeight?: number;
  /** Texto: solo se redimensiona el ancho (el alto se ajusta al contenido). */
  horizontalOnly?: boolean;
  children: ReactNode;
}

/**
 * Lo común a todos los nodos: los cuatro handles (t r b l, invariante 5), el resizer con un gesto de
 * historial y el candado. Con `BoardReadonlyContext` no pinta handles, resizer ni candado (invariante 7).
 */
export function NodeChrome({
  id,
  selected,
  locked,
  className,
  keepAspectRatio,
  minWidth = 40,
  minHeight = 24,
  horizontalOnly,
  children,
}: NodeChromeProps) {
  const readonly = useBoardReadonly();
  const store = useBoardStore();
  const interactive = !readonly && !locked;
  return (
    <div
      className={[
        styles.node,
        selected ? styles.selected : '',
        horizontalOnly ? styles.hOnly : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
      {readonly ? null : (
        <>
          <NodeResizer
            isVisible={!!selected && interactive}
            minWidth={minWidth}
            minHeight={minHeight}
            keepAspectRatio={keepAspectRatio}
            autoScale={false}
            color="var(--selection)"
            lineClassName={styles.resizeLine}
            handleClassName={styles.resizeHandle}
            onResizeStart={() => store.getState().beginGesture()}
            onResizeEnd={() => store.getState().endGesture()}
          />
          {interactive
            ? HANDLES.map(([hid, pos]) => (
                <Handle key={hid} id={hid} type="source" position={pos} className={styles.handle} />
              ))
            : null}
          {locked ? (
            <button
              type="button"
              className={styles.lock}
              aria-label="Desbloquear"
              title="Desbloquear"
              onClick={() => store.getState().updateNodeData([id], { locked: false })}
            >
              <Lock size={12} aria-hidden="true" />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
