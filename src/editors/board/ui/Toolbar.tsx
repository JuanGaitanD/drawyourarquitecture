import { useState, type CSSProperties, type ReactNode } from 'react';
import { Frame, Hand, ImagePlus, MousePointer2, Spline, StickyNote, Type } from 'lucide-react';
import { IconButton, Popover, PopoverContent, PopoverTrigger } from '@/ui';
import { ICONS, SHAPES, type IconName, type ShapeKind } from '../model/board';
import { useBoard } from '../store/BoardStoreProvider';
import type { Tool } from '../store/boardStore';
import { useBoardActions } from './actions';
import chrome from './chrome.module.css';
import { ICON_LABEL, iconGlyph, SHAPE_LABEL, ShapePreview } from './glyphs';
import styles from './Toolbar.module.css';

const SIMPLE: { tool: Tool; label: string; shortcut: string; icon: ReactNode; after?: boolean }[] = [
  { tool: 'select', label: 'Seleccionar', shortcut: 'V', icon: <MousePointer2 size={20} /> },
  { tool: 'hand', label: 'Mano (mover el lienzo)', shortcut: 'H', icon: <Hand size={20} /> },
];
const CREATE: { tool: Tool; label: string; shortcut: string; icon: ReactNode }[] = [
  { tool: 'sticky', label: 'Nota adhesiva', shortcut: 'S', icon: <StickyNote size={20} /> },
  { tool: 'text', label: 'Texto', shortcut: 'T', icon: <Type size={20} /> },
  { tool: 'frame', label: 'Marco', shortcut: 'F', icon: <Frame size={20} /> },
  { tool: 'connector', label: 'Conector', shortcut: 'L', icon: <Spline size={20} /> },
];

/** Barra de herramientas vertical. Debe montarse dentro de <ReactFlowProvider> y del BoardStoreProvider. */
export function Toolbar() {
  const tool = useBoard((s) => s.tool);
  const pendingShape = useBoard((s) => s.pendingShape);
  const pendingIcon = useBoard((s) => s.pendingIcon);
  const actions = useBoardActions();
  const [shapesOpen, setShapesOpen] = useState(false);
  const [iconsOpen, setIconsOpen] = useState(false);

  const tools = (list: typeof CREATE) =>
    list.map((t) => (
      <IconButton
        key={t.tool}
        label={t.label}
        shortcut={t.shortcut}
        icon={t.icon}
        pressed={tool === t.tool}
        tooltipSide="right"
        onClick={() => actions.setTool(t.tool)}
      />
    ));

  return (
    <div
      role="toolbar"
      aria-label="Herramientas del diagrama"
      aria-orientation="vertical"
      className={`${chrome.bar} ${chrome.column} ${styles.toolbar}`}
    >
      {tools(SIMPLE)}
      <div className={chrome.divider} role="separator" aria-orientation="horizontal" />

      <Popover open={shapesOpen} onOpenChange={setShapesOpen}>
        <PopoverTrigger asChild>
          <IconButton
            label="Formas"
            shortcut="R · O"
            icon={<ShapePreview shape={pendingShape} size={24} />}
            pressed={tool === 'shape'}
            tooltipSide="right"
          />
        </PopoverTrigger>
        <PopoverContent side="right" align="start" aria-label="Formas" className={styles.picker}>
          <div className={styles.grid} style={{ '--cols': 4 } as CSSProperties}>
            {SHAPES.map((shape: ShapeKind) => (
              <IconButton
                key={shape}
                label={SHAPE_LABEL[shape]}
                icon={<ShapePreview shape={shape} size={28} />}
                pressed={tool === 'shape' && pendingShape === shape}
                onClick={() => {
                  actions.pickShape(shape);
                  setShapesOpen(false);
                }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {tools(CREATE)}

      <Popover open={iconsOpen} onOpenChange={setIconsOpen}>
        <PopoverTrigger asChild>
          <IconButton
            label="Iconos de arquitectura"
            shortcut="I"
            icon={iconGlyph(pendingIcon, 20)}
            pressed={tool === 'icon'}
            tooltipSide="right"
          />
        </PopoverTrigger>
        <PopoverContent side="right" align="start" aria-label="Iconos" className={styles.picker}>
          <div className={styles.grid} style={{ '--cols': 5 } as CSSProperties}>
            {ICONS.map((icon: IconName) => {
              return (
                <IconButton
                  key={icon}
                  label={ICON_LABEL[icon]}
                  icon={iconGlyph(icon, 22)}
                  pressed={tool === 'icon' && pendingIcon === icon}
                  onClick={() => {
                    actions.pickIcon(icon);
                    setIconsOpen(false);
                  }}
                />
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <IconButton
        label="Imagen"
        icon={<ImagePlus size={20} />}
        pressed={tool === 'image'}
        tooltipSide="right"
        onClick={() => actions.setTool('image')}
      />
    </div>
  );
}
