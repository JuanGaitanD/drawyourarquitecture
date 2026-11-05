import type { NodeProps, NodeTypes } from '@xyflow/react';
import {
  Box,
  Cloud,
  Cpu,
  CreditCard,
  Database,
  Globe,
  HardDrive,
  ImageOff,
  Lock,
  Mail,
  Network,
  Rows3,
  Server,
  Shield,
  Smartphone,
  User,
  type LucideIcon,
} from 'lucide-react';
import { createElement, useEffect, useState } from 'react';
import { DEFAULT_SIZE, type BoardNode, type IconName } from '../model/board';
import { useBoardStore } from '../store/BoardStoreProvider';
import { inkStroke, inkText } from './colors';
import { useBoardFiles } from './files';
import { NodeChrome } from './NodeChrome';
import { NodeLabel } from './NodeLabel';
import { LABEL_INSET, shapePath } from './shapes';
import styles from './nodes.module.css';

type P = NodeProps<BoardNode>;

const dash = (dashed: boolean, w: number) =>
  dashed ? `${Math.max(w, 1) * 3} ${Math.max(w, 1) * 2}` : undefined;

/** Confirmar el texto = un paso de historial. */
function useCommit(id: string) {
  const store = useBoardStore();
  return (label: string) => store.getState().updateNodeData([id], { label });
}

export function ShapeNode({ id, data, selected, width, height }: P) {
  const commit = useCommit(id);
  const w = width ?? DEFAULT_SIZE.shape.width;
  const h = height ?? DEFAULT_SIZE.shape.height;
  const kind = data.shape ?? 'rectangle';
  const { d, detail } = shapePath(kind, w, h);
  const s = data.style;
  const ink = {
    stroke: s.stroke,
    strokeWidth: s.strokeWidth,
    strokeDasharray: dash(s.dashed, s.strokeWidth),
  };
  return (
    <NodeChrome id={id} selected={selected} locked={data.locked}>
      <svg
        className={styles.svg}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        aria-hidden="true"
        focusable="false"
      >
        <g opacity={s.opacity} strokeLinejoin="round" strokeLinecap="round">
          <path d={d} fill={s.fill} {...ink} />
          {detail ? <path d={detail} fill="none" {...ink} /> : null}
        </g>
      </svg>
      <NodeLabel
        id={id}
        label={data.label}
        style={s}
        color={s.textColor}
        inset={LABEL_INSET[kind]}
        vAlign={kind === 'actor' ? 'end' : 'center'}
        onCommit={commit}
      />
    </NodeChrome>
  );
}

export function TextNode({ id, data, selected }: P) {
  const commit = useCommit(id);
  const s = data.style;
  return (
    <NodeChrome id={id} selected={selected} locked={data.locked} horizontalOnly className={styles.textNode}>
      <div
        className={styles.fillBox}
        style={{
          background: s.fill,
          borderColor: s.stroke,
          borderWidth: s.strokeWidth,
          opacity: s.opacity,
        }}
      />
      <NodeLabel
        id={id}
        label={data.label}
        style={s}
        color={inkText(s.textColor, s.fill)}
        inset="4px 6px"
        vAlign="start"
        placeholder="Escribe aquí"
        onCommit={commit}
      />
    </NodeChrome>
  );
}

export function StickyNode({ id, data, selected }: P) {
  const commit = useCommit(id);
  const s = data.style;
  return (
    <NodeChrome id={id} selected={selected} locked={data.locked} minWidth={80} minHeight={80}>
      <div className={styles.sticky} style={{ background: s.fill, opacity: s.opacity }} />
      <NodeLabel id={id} label={data.label} style={s} color={s.textColor} inset="14px" onCommit={commit} />
    </NodeChrome>
  );
}

export function FrameNode({ id, data, selected }: P) {
  const commit = useCommit(id);
  const s = data.style;
  return (
    <NodeChrome id={id} selected={selected} locked={data.locked} minWidth={120} minHeight={80}>
      <div
        className={styles.frame}
        style={{
          background: s.fill,
          borderColor: s.stroke,
          borderWidth: Math.max(s.strokeWidth, 1),
          borderStyle: s.dashed ? 'dashed' : 'solid',
          opacity: s.opacity,
        }}
      />
      <div className={styles.frameTitle}>
        <NodeLabel
          id={id}
          label={data.label}
          style={{ ...s, fontSize: 13, bold: true, align: 'left' }}
          color="var(--text)"
          placeholder="Frame"
          onCommit={commit}
        />
      </div>
    </NodeChrome>
  );
}

const ICON_MAP: Record<IconName, LucideIcon> = {
  server: Server,
  database: Database,
  cloud: Cloud,
  user: User,
  globe: Globe,
  smartphone: Smartphone,
  lock: Lock,
  queue: Rows3,
  cpu: Cpu,
  'hard-drive': HardDrive,
  network: Network,
  shield: Shield,
  mail: Mail,
  'credit-card': CreditCard,
  box: Box,
};
export const iconComponent = (name: IconName | undefined): LucideIcon => ICON_MAP[name ?? 'server'] ?? Box;

export function IconNode({ id, data, selected }: P) {
  const commit = useCommit(id);
  const s = data.style;
  return (
    <NodeChrome id={id} selected={selected} locked={data.locked} keepAspectRatio minWidth={32} minHeight={32}>
      <div className={styles.iconBox} style={{ opacity: s.opacity }}>
        {createElement(iconComponent(data.icon), {
          className: styles.iconGlyph,
          color: inkStroke(s.stroke),
          strokeWidth: Math.max(1, s.strokeWidth * 0.75),
          'aria-hidden': true,
        })}
      </div>
      <div className={styles.iconLabel}>
        <NodeLabel
          id={id}
          label={data.label}
          style={{ ...s, align: 'center' }}
          color={inkText(s.textColor, 'transparent')}
          vAlign="start"
          onCommit={commit}
        />
      </div>
    </NodeChrome>
  );
}

type FileState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error' };

/** Descarga con `getBlob` (nunca getDownloadURL) y crea un object URL que se revoca al desmontar. */
function useFileUrl(fileId: string | undefined): FileState {
  const files = useBoardFiles();
  const [state, setState] = useState<FileState>({ status: 'loading' });
  useEffect(() => {
    if (!fileId || !files) return;
    let url: string | null = null;
    let cancelled = false;
    files
      .load(fileId)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ status: 'ready', url });
      })
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, files]);
  return !fileId || !files ? { status: 'error' } : state;
}

export function ImageNode({ id, data, selected }: P) {
  const f = useFileUrl(data.fileId);
  const s = data.style;
  return (
    <NodeChrome id={id} selected={selected} locked={data.locked} keepAspectRatio minWidth={40} minHeight={40}>
      {f.status === 'ready' ? (
        <img
          className={styles.image}
          src={f.url}
          alt={data.label}
          draggable={false}
          style={{ opacity: s.opacity }}
        />
      ) : (
        <div
          className={styles.imagePlaceholder}
          role="img"
          aria-label={f.status === 'error' ? 'Imagen no disponible' : 'Cargando imagen'}
        >
          <ImageOff size={20} aria-hidden="true" />
          <span>{f.status === 'error' ? 'Imagen no disponible' : 'Cargando…'}</span>
        </div>
      )}
    </NodeChrome>
  );
}

export const nodeTypes: NodeTypes = {
  shape: ShapeNode,
  text: TextNode,
  sticky: StickyNode,
  frame: FrameNode,
  icon: IconNode,
  image: ImageNode,
};
