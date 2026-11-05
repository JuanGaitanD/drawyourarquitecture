import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import type { BoardEdge, BoardEdgeData } from '../model/board';
import { inkEdge } from '../nodes/colors';
import { useBoard, useBoardStore } from '../store/BoardStoreProvider';
import { useBoardReadonly } from '../store/readonly';
import { returnFocus } from '../store/returnFocus';
import styles from './edges.module.css';

const FALLBACK: BoardEdgeData = {
  path: 'bezier',
  markerStart: false,
  markerEnd: true,
  dashed: false,
  color: '#475569',
  width: 2,
};

/** Arista única del board (`type === 'labeled'`): trazado en `data.path`, flechas, trazo discontinuo y etiqueta. */
export function LabeledEdge(props: EdgeProps<BoardEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props;
  const d = { ...FALLBACK, ...props.data };
  const geo = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [path, lx, ly] =
    d.path === 'straight'
      ? getStraightPath(geo)
      : d.path === 'step'
        ? getSmoothStepPath({ ...geo, borderRadius: 8 })
        : getBezierPath(geo);
  const color = selected ? 'var(--selection)' : inkEdge(d.color);
  const readonly = useBoardReadonly();
  const editing = useBoard((s) => s.editingId === id) && !readonly;
  const mid = (end: 'start' | 'end') => `url(#${id}-${end})`;

  return (
    <>
      <defs>
        {(['start', 'end'] as const).map((end) => (
          <marker
            key={end}
            id={`${id}-${end}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10Z" fill={color} />
          </marker>
        ))}
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerStart={d.markerStart ? mid('start') : undefined}
        markerEnd={d.markerEnd ? mid('end') : undefined}
        interactionWidth={20}
        style={{
          stroke: color,
          strokeWidth: d.width,
          strokeDasharray: d.dashed ? `${d.width * 3} ${d.width * 2}` : undefined,
        }}
      />
      {d.label || editing ? (
        <EdgeLabelRenderer>
          <div
            className={`${styles.label} nodrag nopan`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            data-selected={selected || undefined}
          >
            {editing ? <LabelEditor id={id} value={d.label ?? ''} /> : <span>{d.label}</span>}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function LabelEditor({ id, value }: { id: string; value: string }) {
  const store = useBoardStore();
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    store.getState().setEditingId(null);
    if (next !== null && next !== value) store.getState().updateEdgeData([id], { label: next });
  };
  return (
    <input
      ref={ref}
      className={styles.input}
      value={v}
      size={Math.max(v.length, 6)}
      aria-label="Etiqueta de la conexión"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key !== 'Escape' && e.key !== 'Enter') return;
        finish(e.key === 'Escape' ? null : v);
        returnFocus(ref.current); // después de finish: el blur no debe confirmar el texto
      }}
    />
  );
}

export const edgeTypes: EdgeTypes = { labeled: LabeledEdge };
