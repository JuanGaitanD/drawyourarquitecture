import { ArrowLeft, CircleAlert, CloudOff, Link2, LoaderCircle, Check, Copy, Globe2 } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import type { SaveStatus } from '@/application/saveQueue';
import { SharePanel } from '@/app/invite/SharePanel';
import { ThemeToggle, UserMenu } from '@/app/shell/Shell';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, useToast } from '@/ui';
import styles from './editor.module.css';

/** Título editable: Enter o salir del campo confirma, Esc lo devuelve. */
export function TitleField({
  value,
  onCommit,
  readOnly,
}: {
  value: string;
  onCommit: (title: string) => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const finish = (next: string | null) => {
    setDraft(null);
    const t = (next ?? value).trim();
    if (next !== null && t && t !== value) onCommit(t);
  };
  return (
    <input
      className={styles.title}
      value={shown}
      maxLength={120}
      readOnly={readOnly}
      aria-label="Título del diagrama"
      placeholder="Diagrama sin título"
      size={Math.min(Math.max(shown.length, 12), 40)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== null && finish(draft)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const STATUS = {
  guardando: {
    text: 'Guardando…',
    icon: <LoaderCircle size={14} className={styles.spin} aria-hidden="true" />,
  },
  guardado: { text: 'Guardado', icon: <Check size={14} aria-hidden="true" /> },
  'sin conexión': { text: 'Sin conexión · borrador local', icon: <CloudOff size={14} aria-hidden="true" /> },
  conflicto: { text: 'Conflicto al guardar', icon: <CircleAlert size={14} aria-hidden="true" /> },
  error: { text: 'No se pudo guardar', icon: <CircleAlert size={14} aria-hidden="true" /> },
} as const;

export function SaveBadge({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const s = STATUS[status];
  return (
    <span className={styles.status} data-status={status} role="status" aria-live="polite">
      {s.icon}
      <span>{s.text}</span>
      {status === 'error' ? (
        <button type="button" className={styles.link} onClick={onRetry}>
          Reintentar
        </button>
      ) : null}
    </span>
  );
}

export interface ShareProps {
  id: string;
  isPublic: boolean;
  onChange: (isPublic: boolean) => Promise<void>;
}

export function ShareButton({ id, isPublic, onChange }: ShareProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const url = `${location.origin}/view/board/${id}`;

  const toggle = async () => {
    setBusy(true);
    try {
      await onChange(!isPublic);
    } catch {
      toast({
        title: 'No se pudo cambiar la visibilidad',
        description: 'Revisa la conexión e inténtalo de nuevo.',
        kind: 'error',
      });
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Enlace copiado', kind: 'success' });
    } catch {
      toast({
        title: 'No se pudo copiar',
        description: 'Selecciona el enlace y cópialo a mano.',
        kind: 'error',
      });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" icon={isPublic ? <Globe2 size={16} /> : <Link2 size={16} />}>
          Compartir
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.share}>
        <p className={styles.shareTitle}>
          {isPublic ? 'Cualquiera con el enlace puede verlo' : 'Solo tú puedes verlo'}
        </p>
        <p className={styles.shareHint}>
          {isPublic
            ? 'Es de solo lectura: nadie más puede editar este diagrama.'
            : 'Publícalo para compartir una vista de solo lectura.'}
        </p>
        {isPublic ? (
          <div className={styles.shareRow}>
            <input
              className={styles.shareUrl}
              value={url}
              readOnly
              aria-label="Enlace público"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" icon={<Copy size={14} />} onClick={() => void copy()}>
              Copiar
            </Button>
          </div>
        ) : null}
        <Button
          size="sm"
          variant={isPublic ? 'secondary' : 'primary'}
          loading={busy}
          onClick={() => void toggle()}
        >
          {isPublic ? 'Dejar de compartir' : 'Publicar enlace'}
        </Button>
        <SharePanel projectId={id} />
      </PopoverContent>
    </Popover>
  );
}

export function BackButton() {
  const [, navigate] = useLocation();
  return <IconButton label="Volver al panel" icon={<ArrowLeft size={18} />} onClick={() => navigate('/')} />;
}

export { ThemeToggle, UserMenu };
