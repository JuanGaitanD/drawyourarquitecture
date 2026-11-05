import { TriangleAlert } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button, Dialog, DialogContent } from '@/ui';
import type { BoardContent } from '../model/board';
import { autoLayout } from '../model/layout';
import { parseFlowchart } from '../model/mermaid';
import type { ApplyMode } from './content';
import styles from './BoardMenu.module.css';

const PLACEHOLDER = `flowchart LR
  U((Usuario)) -->|HTTPS| API
  subgraph Backend
    API(API) --> DB[(Base de datos)]
  end`;

export interface MermaidImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hay algo en el lienzo: se ofrecen «Añadir» y «Reemplazar»; si no, solo «Importar». */
  hasContent: boolean;
  onApply: (content: BoardContent, mode: ApplyMode) => void;
}

/** Inicio y fin de la línea `line` (1-based), para resaltar el error en el textarea. */
function lineRange(text: string, line: number): [number, number] {
  const lines = text.split(/\r\n|\r|\n/);
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += (lines[i]?.length ?? 0) + 1;
  return [start, start + (lines[line - 1]?.length ?? 0)];
}

export function MermaidImportDialog({ open, onOpenChange, hasContent, onApply }: MermaidImportDialogProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ApplyMode | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const run = async (mode: ApplyMode) => {
    const r = parseFlowchart(text);
    if (!r.ok) {
      setError(r.error);
      const ta = area.current;
      if (ta) {
        ta.focus();
        if (r.line) ta.setSelectionRange(...lineRange(text, r.line));
      }
      return;
    }
    setError(null);
    setBusy(mode);
    try {
      onApply(await autoLayout(r.value, r.direction), mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo ordenar el diagrama.');
    } finally {
      setBusy(null);
    }
  };

  const empty = text.trim() === '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Importar desde Mermaid"
        description="Pega un flowchart o graph. Se convierte en formas, conectores y frames, y se ordena solo. Podrás deshacerlo."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {hasContent ? (
              <Button
                variant="secondary"
                disabled={empty}
                loading={busy === 'insert'}
                onClick={() => void run('insert')}
              >
                Añadir al diagrama
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={empty}
              loading={busy === 'replace'}
              onClick={() => void run('replace')}
            >
              {hasContent ? 'Reemplazar diagrama' : 'Importar'}
            </Button>
          </>
        }
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-src`}>
            Código Mermaid
          </label>
          <textarea
            ref={area}
            id={`${id}-src`}
            className={styles.textarea}
            value={text}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-err` : ''}`}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
          />
          <p id={`${id}-hint`} className={styles.hint}>
            Admite nodos con forma, aristas con texto (<code>--&gt;|texto|</code>), subgraph y comentarios.
            Los estilos (<code>style</code>, <code>classDef</code>) se ignoran.
          </p>
          {error ? (
            <p id={`${id}-err`} className={styles.error} role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
