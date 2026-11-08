import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { NodeStyle } from '../model/board';
import { useBoard, useBoardStore } from '../store/BoardStoreProvider';
import { useBoardReadonly } from '../store/readonly';
import { returnFocus } from '../store/returnFocus';
import styles from './nodes.module.css';

export interface NodeLabelProps {
  id: string;
  label: string;
  style: NodeStyle;
  /** Color del texto ya resuelto (ver colors.ts). */
  color: string;
  /** Padding CSS donde cabe el texto. */
  inset?: string;
  vAlign?: 'center' | 'start' | 'end';
  placeholder?: string;
  /** Se llama solo si el texto cambió. */
  onCommit: (label: string) => void;
}

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;
const V = { center: 'center', start: 'flex-start', end: 'flex-end' } as const;

/** Texto del nodo: lectura o edición en sitio (Enter confirma, Mayús+Enter salta de línea, Esc cancela). */
export function NodeLabel({
  id,
  label,
  style,
  color,
  inset,
  vAlign = 'center',
  placeholder,
  onCommit,
}: NodeLabelProps) {
  const readonly = useBoardReadonly();
  const editing = useBoard((s) => s.editingId === id) && !readonly;
  const store = useBoardStore();
  const text: CSSProperties = {
    fontSize: style.fontSize,
    fontWeight: style.bold ? 700 : 400,
    textAlign: style.align,
    color,
  };
  const box: CSSProperties = { padding: inset, justifyContent: JUSTIFY[style.align], alignItems: V[vAlign] };

  if (!editing) {
    if (!label && (readonly || !placeholder)) return null;
    return (
      <div className={styles.labelBox} style={box}>
        <div className={styles.label} style={text} data-empty={!label || undefined}>
          {label || placeholder}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.labelBox} style={box}>
      <Editor
        value={label}
        style={text}
        onDone={(v) => {
          // Primero el texto y después salir de la edición: así crear + etiquetar es un solo paso de historial.
          if (v !== null && v !== label) onCommit(v);
          store.getState().setEditingId(null);
        }}
      />
    </div>
  );
}

function Editor({
  value,
  style,
  onDone,
}: {
  value: string;
  style: CSSProperties;
  onDone: (v: string | null) => void;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <div className={styles.editGrid} data-replicated={`${v} `} style={style}>
      <textarea
        ref={ref}
        className={`${styles.editor} nodrag nopan nowheel`}
        style={style}
        value={v}
        rows={1}
        aria-label="Texto"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => finish(v)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Escape') {
            finish(null);
            returnFocus(ref.current); // después de finish: el blur no debe confirmar el texto
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            finish(v);
            returnFocus(ref.current);
          }
        }}
      />
    </div>
  );
}
