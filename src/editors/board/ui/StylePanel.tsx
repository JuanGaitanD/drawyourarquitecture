import type { ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeftToLine,
  ArrowRightToLine,
  Blend,
  Bold,
  Spline,
  Type,
} from 'lucide-react';
import { IconButton, Popover, PopoverContent, PopoverTrigger } from '@/ui';
import type { BoardEdgeData, EdgePath, NodeKind, NodeStyle } from '../model/board';
import { patchStyle } from '../model/ops';
import { useBoardStore } from '../store/BoardStoreProvider';
import chrome from './chrome.module.css';
import { ColorGrid, Section, Segmented, SwatchDot, Toggle } from './controls';
import {
  FILL_COLORS,
  FONT_SIZES,
  NO_STROKE,
  OPACITIES,
  STROKE_COLORS,
  TEXT_COLORS,
  WIDTHS,
  common,
} from './palette';
import styles from './StylePanel.module.css';
import { useSelectedEdges, useSelectedNodes } from './useSelection';

// Qué grupos de estilo admite cada tipo de nodo.
const FILL_KINDS: NodeKind[] = ['shape', 'sticky', 'frame'];
const STROKE_KINDS: NodeKind[] = ['shape', 'frame', 'icon'];
const TEXT_KINDS: NodeKind[] = ['shape', 'text', 'sticky', 'frame', 'icon'];
const ALL_KINDS: NodeKind[] = ['shape', 'text', 'sticky', 'frame', 'icon', 'image'];

const EDGE_PATHS: { value: EdgePath; label: string }[] = [
  { value: 'bezier', label: 'Curva' },
  { value: 'straight', label: 'Recta' },
  { value: 'step', label: 'Escalón' },
];
const ALIGNS: { value: NodeStyle['align']; label: string; icon: ReactNode }[] = [
  { value: 'left', label: 'Alinear a la izquierda', icon: <AlignLeft size={16} /> },
  { value: 'center', label: 'Centrar', icon: <AlignCenter size={16} /> },
  { value: 'right', label: 'Alinear a la derecha', icon: <AlignRight size={16} /> },
];

/**
 * Panel de estilo flotante (arriba, centrado). Solo existe mientras hay nodos o aristas seleccionados y
 * ofrece los grupos que admite la selección. Cada cambio es una única escritura del store (un paso de deshacer).
 */
export function StylePanel() {
  const store = useBoardStore();
  const nodes = useSelectedNodes();
  const edges = useSelectedEdges();
  if (!nodes.length && !edges.length) return null;

  const of = (kinds: NodeKind[]) => nodes.filter((n) => kinds.includes(n.data.kind));
  const setStyle = (kinds: NodeKind[], patch: Partial<NodeStyle>) => {
    const ids = of(kinds).map((n) => n.id);
    store.getState().setNodes((ns) => patchStyle(ns, ids, patch));
  };
  const setEdge = (patch: Partial<BoardEdgeData>) =>
    store.getState().updateEdgeData(
      edges.map((e) => e.id),
      patch,
    );

  const fillNodes = of(FILL_KINDS);
  const strokeNodes = of(STROKE_KINDS);
  const textNodes = of(TEXT_KINDS);
  const fill = common(fillNodes, (n) => n.data.style.fill);
  const stroke = common(strokeNodes, (n) => n.data.style.stroke);
  const edgeColor = common(edges, (e) => e.data?.color);
  const edgeWidth = common(edges, (e) => e.data?.width);
  const hasNodes = nodes.length > 0;

  return (
    <div role="toolbar" aria-label="Estilo de la selección" className={`${chrome.bar} ${styles.panel}`}>
      {fillNodes.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton label="Relleno" icon={<SwatchDot color={fill} />} />
          </PopoverTrigger>
          <PopoverContent aria-label="Relleno" align="center">
            <Section title="Relleno">
              <ColorGrid
                label="Color de relleno"
                colors={FILL_COLORS}
                value={fill}
                columns={6}
                onPick={(v) => setStyle(FILL_KINDS, { fill: v })}
              />
            </Section>
          </PopoverContent>
        </Popover>
      )}

      {strokeNodes.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton label="Borde" icon={<SwatchDot color={stroke} ring />} />
          </PopoverTrigger>
          <PopoverContent aria-label="Borde" align="center">
            <Section title="Color">
              <ColorGrid
                label="Color del borde"
                colors={[NO_STROKE, ...STROKE_COLORS]}
                value={stroke}
                columns={6}
                onPick={(v) => setStyle(STROKE_KINDS, { stroke: v })}
              />
            </Section>
            <Section title="Grosor">
              <Segmented
                label="Grosor del borde"
                options={WIDTHS}
                value={common(strokeNodes, (n) => n.data.style.strokeWidth)}
                onChange={(v) => setStyle(STROKE_KINDS, { strokeWidth: v })}
              />
            </Section>
            <Section title="Trazo">
              <Toggle
                label="Línea discontinua"
                pressed={common(strokeNodes, (n) => n.data.style.dashed)}
                onChange={(v) => setStyle(STROKE_KINDS, { dashed: v })}
              />
            </Section>
          </PopoverContent>
        </Popover>
      )}

      {textNodes.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton label="Texto" icon={<Type size={20} />} />
          </PopoverTrigger>
          <PopoverContent aria-label="Texto" align="center">
            <Section title="Tamaño">
              <Segmented
                label="Tamaño de letra"
                options={FONT_SIZES.map((v) => ({ value: v, label: String(v) }))}
                value={common(textNodes, (n) => n.data.style.fontSize)}
                onChange={(v) => setStyle(TEXT_KINDS, { fontSize: v })}
              />
            </Section>
            <Section title="Formato">
              <Toggle
                label="Negrita"
                icon={<Bold size={16} />}
                pressed={common(textNodes, (n) => n.data.style.bold)}
                onChange={(v) => setStyle(TEXT_KINDS, { bold: v })}
              />
              <Segmented
                label="Alineación del texto"
                options={ALIGNS}
                value={common(textNodes, (n) => n.data.style.align)}
                onChange={(v) => setStyle(TEXT_KINDS, { align: v })}
              />
            </Section>
            <Section title="Color del texto">
              <ColorGrid
                label="Color del texto"
                colors={TEXT_COLORS}
                value={common(textNodes, (n) => n.data.style.textColor)}
                columns={8}
                onPick={(v) => setStyle(TEXT_KINDS, { textColor: v })}
              />
            </Section>
          </PopoverContent>
        </Popover>
      )}

      {hasNodes && (
        <Popover>
          <PopoverTrigger asChild>
            <IconButton label="Opacidad" icon={<Blend size={20} />} />
          </PopoverTrigger>
          <PopoverContent aria-label="Opacidad" align="center">
            <Section title="Opacidad">
              <Segmented
                label="Opacidad del elemento"
                options={OPACITIES.map((v) => ({ value: v, label: `${v} %` }))}
                value={(() => {
                  const o = common(nodes, (n) => n.data.style.opacity);
                  return o === undefined ? undefined : Math.round(o * 100);
                })()}
                onChange={(v) => setStyle(ALL_KINDS, { opacity: v / 100 })}
              />
            </Section>
          </PopoverContent>
        </Popover>
      )}

      {hasNodes && edges.length > 0 && <div className={chrome.divider} role="separator" />}

      {edges.length > 0 && (
        <>
          <Popover>
            <PopoverTrigger asChild>
              <IconButton label="Línea del conector" icon={<Spline size={20} />} />
            </PopoverTrigger>
            <PopoverContent aria-label="Línea del conector" align="center">
              <Section title="Trazado">
                <Segmented
                  label="Trazado del conector"
                  options={EDGE_PATHS}
                  value={common(edges, (e) => e.data?.path)}
                  onChange={(v) => setEdge({ path: v })}
                />
              </Section>
              <Section title="Extremos">
                <Toggle
                  label="Flecha al inicio"
                  icon={<ArrowLeftToLine size={16} />}
                  pressed={common(edges, (e) => e.data?.markerStart)}
                  onChange={(v) => setEdge({ markerStart: v })}
                />
                <Toggle
                  label="Flecha al final"
                  icon={<ArrowRightToLine size={16} />}
                  pressed={common(edges, (e) => e.data?.markerEnd)}
                  onChange={(v) => setEdge({ markerEnd: v })}
                />
              </Section>
              <Section title="Trazo">
                <Toggle
                  label="Línea discontinua"
                  pressed={common(edges, (e) => e.data?.dashed)}
                  onChange={(v) => setEdge({ dashed: v })}
                />
              </Section>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <IconButton label="Color del conector" icon={<SwatchDot color={edgeColor} />} />
            </PopoverTrigger>
            <PopoverContent aria-label="Color del conector" align="center">
              <Section title="Color">
                <ColorGrid
                  label="Color del conector"
                  colors={STROKE_COLORS}
                  value={edgeColor}
                  columns={6}
                  onPick={(v) => setEdge({ color: v })}
                />
              </Section>
              <Section title="Grosor">
                <Segmented
                  label="Grosor del conector"
                  options={WIDTHS}
                  value={edgeWidth}
                  onChange={(v) => setEdge({ width: v })}
                />
              </Section>
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
