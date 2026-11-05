import { Copy } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogContent, useToast } from '@/ui';
import type { BoardContent } from '../model/board';
import { toFlowchart, type MermaidDirection } from '../model/mermaid';
import styles from './BoardMenu.module.css';

export interface MermaidExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getContent: () => BoardContent;
}

export function MermaidExportDialog({ open, onOpenChange, getContent }: MermaidExportDialogProps) {
  const [direction, setDirection] = useState<MermaidDirection>('LR');
  const area = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const id = useId();
  // Se recalcula al abrir y al cambiar de dirección; el diagrama no cambia con el diálogo abierto.
  const text = useMemo(
    () => (open ? toFlowchart(getContent(), direction) : ''),
    [open, direction, getContent],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Mermaid copiado', kind: 'success' });
    } catch {
      area.current?.select();
      toast({
        title: 'No se pudo copiar solo',
        description: 'El texto quedó seleccionado: cópialo con Ctrl+C.',
        kind: 'error',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Exportar a Mermaid"
        description="Los frames salen como subgraph. Stickies, textos e iconos salen como formas, y los estilos no se exportan."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
            <Button variant="primary" icon={<Copy size={16} />} onClick={() => void copy()}>
              Copiar
            </Button>
          </>
        }
      >
        <div className={styles.field}>
          <div className={styles.toolbar}>
            <label className={styles.label} htmlFor={`${id}-out`}>
              Código Mermaid
            </label>
            <div className={styles.segmented} role="group" aria-label="Dirección del flujo">
              {(['LR', 'TB'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={styles.segment}
                  aria-pressed={direction === d}
                  onClick={() => setDirection(d)}
                >
                  {d === 'LR' ? 'Horizontal' : 'Vertical'}
                </button>
              ))}
            </div>
          </div>
          <textarea
            ref={area}
            id={`${id}-out`}
            className={styles.textarea}
            value={text}
            readOnly
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
