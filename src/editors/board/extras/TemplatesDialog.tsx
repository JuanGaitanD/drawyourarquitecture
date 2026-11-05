import { useId, useMemo, useState } from 'react';
import { Button, Dialog, DialogContent } from '@/ui';
import type { BoardContent } from '../model/board';
import { nodeSize, toAbsolute } from '../model/geometry';
import { validateBoardContent } from '../model/validate';
import { absoluteBounds, describeContent, type ApplyMode } from './content';
import { instantiateTemplate, TEMPLATES, type BoardTemplate } from './templates';
import styles from './BoardMenu.module.css';

/** Miniatura SVG: un rectángulo por nodo, con los colores propios del dibujo (no del tema). */
function Thumb({ content }: { content: BoardContent }) {
  const b = absoluteBounds(content.nodes);
  if (!b) return null;
  const m = 24;
  return (
    <svg
      className={styles.thumb}
      viewBox={`${b.x - m} ${b.y - m} ${b.width + m * 2} ${b.height + m * 2}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {content.nodes.map((n) => {
        const p = toAbsolute(n, content.nodes);
        const { width, height } = nodeSize(n);
        const isFrame = n.data.kind === 'frame';
        if (n.data.kind === 'text') return null;
        return (
          <rect
            key={n.id}
            x={p.x}
            y={p.y}
            width={width}
            height={height}
            rx={isFrame ? 12 : 10}
            fill={n.data.style.fill === 'transparent' ? 'none' : n.data.style.fill}
            stroke={n.data.style.stroke === 'transparent' ? 'none' : n.data.style.stroke}
            strokeWidth={isFrame ? 4 : 6}
            strokeDasharray={isFrame ? '16 10' : undefined}
          />
        );
      })}
    </svg>
  );
}

export interface TemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasContent: boolean;
  onApply: (content: BoardContent, mode: ApplyMode) => void;
}

export function TemplatesDialog({ open, onOpenChange, hasContent, onApply }: TemplatesDialogProps) {
  const [selected, setSelected] = useState<string>(TEMPLATES[0]?.id ?? '');
  const name = useId();
  const previews = useMemo(() => {
    const map = new Map<string, BoardContent>();
    for (const t of TEMPLATES) {
      const v = validateBoardContent(t.raw);
      if (v.ok) map.set(t.id, v.value);
    }
    return map;
  }, []);

  const apply = (mode: ApplyMode) => {
    const t: BoardTemplate | undefined = TEMPLATES.find((x) => x.id === selected);
    if (t) onApply(instantiateTemplate(t), mode);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Plantillas"
        description="Empieza desde una arquitectura de ejemplo y adáptala. Podrás deshacerlo."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {hasContent ? (
              <Button variant="secondary" onClick={() => apply('insert')}>
                Insertar debajo
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => apply('replace')}>
              {hasContent ? 'Reemplazar diagrama' : 'Usar plantilla'}
            </Button>
          </>
        }
      >
        <fieldset className={styles.grid}>
          <legend className="sr-only">Plantilla</legend>
          {TEMPLATES.map((t) => {
            const content = previews.get(t.id);
            return (
              <label key={t.id} className={styles.card}>
                <input
                  className={styles.radio}
                  type="radio"
                  name={name}
                  value={t.id}
                  checked={selected === t.id}
                  onChange={() => setSelected(t.id)}
                />
                {content ? <Thumb content={content} /> : null}
                <span className={styles.cardTitle}>{t.name}</span>
                <span className={styles.cardText}>{t.description}</span>
                {content ? <span className={styles.cardMeta}>{describeContent(content)}</span> : null}
              </label>
            );
          })}
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}
