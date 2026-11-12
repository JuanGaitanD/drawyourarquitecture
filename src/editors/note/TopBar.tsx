import { ArrowLeft, Check, CloudOff, Copy, Globe, Library, LoaderCircle, Share2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { SaveStatus } from '@/application/saveQueue';
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, useToast } from '@/ui';
import { PresenceAvatars } from '@/app/invite/PresenceAvatars';
import { SharePanel } from '@/app/invite/SharePanel';
import type { CanvasUi } from './NoteCanvas';
import styles from './TopBar.module.css';

export interface TopBarProps {
  title: string;
  onTitle: (title: string) => void;
  status: SaveStatus;
  /** La nota pesa más que el tope de guardado: no se guarda hasta que se reduzca. */
  tooLarge: boolean;
  isPublic: boolean;
  onPublic: (value: boolean) => void;
  shareUrl: string;
  onBack: () => void;
  /** Botón «Biblioteca» (sustituye al disparador de Excalidraw). */
  library?: CanvasUi;
  projectId: string;
  /** Solo el dueño comparte con personas. */
  canShare?: boolean;
}

const STATUS: Record<SaveStatus, { label: string; tone: string }> = {
  guardando: { label: 'Guardando…', tone: 'muted' },
  guardado: { label: 'Guardado', tone: 'ok' },
  'sin conexión': { label: 'Sin conexión · borrador local', tone: 'warn' },
  conflicto: { label: 'Conflicto', tone: 'danger' },
  error: { label: 'Error al guardar', tone: 'danger' },
};

function StatusIcon({ status }: { status: SaveStatus }) {
  if (status === 'guardando') return <LoaderCircle size={14} className={styles.spin} aria-hidden="true" />;
  if (status === 'guardado') return <Check size={14} aria-hidden="true" />;
  if (status === 'sin conexión') return <CloudOff size={14} aria-hidden="true" />;
  return <TriangleAlert size={14} aria-hidden="true" />;
}

/** Barra de la esquina superior derecha: volver, título editable, estado de guardado y compartir. */
export function TopBar(p: TopBarProps) {
  // `edit` solo existe mientras se escribe; fuera de eso manda el título guardado.
  const [edit, setEdit] = useState<string | null>(null);
  const s = p.tooLarge ? { label: 'Demasiado grande para guardar', tone: 'danger' } : STATUS[p.status];
  const commit = () => {
    if (edit !== null && edit.trim() !== p.title) p.onTitle(edit);
    setEdit(null);
  };

  return (
    <div className={styles.bar} data-densidad="compacta">
      <IconButton label="Volver al panel" size="sm" icon={<ArrowLeft size={16} />} onClick={p.onBack} />
      <input
        className={styles.title}
        aria-label="Título de la nota"
        value={edit ?? p.title}
        maxLength={120}
        readOnly={p.canShare === false}
        onChange={(e) => setEdit(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setEdit(null);
            e.currentTarget.blur();
          }
        }}
      />
      <span className={`${styles.status} ${styles[s.tone]}`} role="status" aria-live="polite" title={s.label}>
        {p.tooLarge ? <TriangleAlert size={14} aria-hidden="true" /> : <StatusIcon status={p.status} />}
        <span className={styles.statusText}>{s.label}</span>
      </span>
      <PresenceAvatars projectId={p.projectId} />
      {p.library ? (
        <IconButton
          label="Biblioteca"
          size="sm"
          icon={<Library size={16} />}
          pressed={p.library.libraryOpen}
          onClick={p.library.toggleLibrary}
        />
      ) : null}
      {p.canShare === false ? null : (
        <SharePopover isPublic={p.isPublic} onPublic={p.onPublic} url={p.shareUrl} projectId={p.projectId} />
      )}
    </div>
  );
}

function SharePopover({
  isPublic,
  onPublic,
  url,
  projectId,
}: {
  isPublic: boolean;
  onPublic: (v: boolean) => void;
  url: string;
  projectId: string;
}) {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ kind: 'success', title: 'Enlace copiado' });
    } catch {
      toast({
        kind: 'error',
        title: 'No se pudo copiar',
        description: 'Selecciona el enlace y cópialo a mano.',
      });
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          label="Compartir"
          size="sm"
          icon={isPublic ? <Globe size={16} /> : <Share2 size={16} />}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.share}>
        <div className={styles.shareRow}>
          <div>
            <p className={styles.shareTitle}>Enlace público</p>
            <p className={styles.shareHint}>Quien tenga el enlace puede ver la nota, sin editarla.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            aria-label="Enlace público"
            className={styles.switch}
            onClick={() => onPublic(!isPublic)}
          >
            <span className={styles.knob} />
          </button>
        </div>
        {isPublic ? (
          <div className={styles.shareLink}>
            <input
              readOnly
              value={url}
              aria-label="Enlace público de la nota"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="sm" icon={<Copy size={14} />} onClick={() => void copy()}>
              Copiar
            </Button>
          </div>
        ) : null}
        <SharePanel projectId={projectId} />
      </PopoverContent>
    </Popover>
  );
}
