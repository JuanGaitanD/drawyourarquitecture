import { Copy, Ellipsis, Globe, GlobeLock, Link as LinkIcon, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Link } from 'wouter';
import { MAX_TITLE_LENGTH, normalizeTitle, type Project } from '@/domain/project';
import {
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  useToast,
} from '@/ui';
import { deleteProject, duplicateProject, projectRepo } from '../services';
import styles from './ProjectCard.module.css';
import { formatAbsolute, formatRelative } from './relativeTime';
import { TYPE_META } from './typeMeta';

const publicLink = (p: Project) => `${window.location.origin}/view/${p.type}/${p.id}`;

export function ProjectCard({ project, now }: { project: Project; now: number }) {
  const { toast } = useToast();
  const { label, Icon } = TYPE_META[project.type];
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState<'duplicate' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wantsRename = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  const wasConfirming = useRef(false);

  // Al terminar de renombrar el input desaparece: el foco vuelve a la tarjeta, no al cuerpo del documento.
  useEffect(() => {
    if (wasRenaming.current && !renaming) linkRef.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);

  // Al cancelar el diálogo, Radix intenta devolver el foco al ítem del menú, que ya no existe: va al botón de opciones.
  useEffect(() => {
    if (wasConfirming.current && !confirmDelete) triggerRef.current?.focus();
    wasConfirming.current = confirmDelete;
  }, [confirmDelete]);

  const fail = (title: string, retry?: () => void) =>
    toast({
      kind: 'error',
      title,
      description: 'Comprueba tu conexión e inténtalo de nuevo.',
      action: retry ? { label: 'Reintentar', onClick: retry } : undefined,
    });

  async function rename(raw: string) {
    setRenaming(false);
    const title = normalizeTitle(raw);
    if (raw.trim() === '' || title === project.title) return;
    try {
      await projectRepo.update(project.id, { title });
    } catch {
      fail('No se pudo renombrar', () => void rename(raw));
    }
  }

  async function duplicate() {
    setBusy('duplicate');
    try {
      await duplicateProject(project.id);
      toast({ kind: 'success', title: 'Copia creada', description: `«${project.title}» se duplicó.` });
    } catch {
      fail('No se pudo duplicar', () => void duplicate());
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicLink(project));
      toast({ kind: 'success', title: 'Enlace copiado' });
    } catch {
      toast({ kind: 'error', title: 'No se pudo copiar', description: publicLink(project), duration: 0 });
    }
  }

  async function togglePublic() {
    const next = !project.isPublic;
    try {
      await projectRepo.update(project.id, { isPublic: next });
      toast(
        next
          ? {
              kind: 'success',
              title: 'Enlace público activado',
              description: 'Cualquiera con el enlace puede verlo, sin editar.',
              action: { label: 'Copiar enlace', onClick: () => void copyLink() },
            }
          : { kind: 'info', title: 'Ya no es público' },
      );
    } catch {
      fail(next ? 'No se pudo publicar' : 'No se pudo hacer privado', () => void togglePublic());
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await deleteProject(project.id);
      toast({ kind: 'success', title: 'Proyecto borrado' });
      setConfirmDelete(false);
    } catch {
      fail('No se pudo borrar', () => setConfirmDelete(true));
    } finally {
      setBusy(null);
    }
  }

  const preview = (
    <span className={styles.preview} aria-hidden="true">
      <span className={styles.tile}>
        <Icon size={26} aria-hidden />
      </span>
    </span>
  );
  const meta = (
    <span className={styles.meta}>
      <span className={styles.type}>{label}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={new Date(project.updatedAt).toISOString()} title={formatAbsolute(project.updatedAt)}>
        {formatRelative(project.updatedAt, now)}
      </time>
    </span>
  );

  return (
    <li
      className={`${styles.card} ${styles[project.type]}`}
      aria-busy={busy !== null || undefined}
      data-busy={busy ?? undefined}
    >
      {renaming ? (
        <div className={styles.surface}>
          {preview}
          <span className={styles.body}>
            <RenameInput ref={inputRef} title={project.title} onDone={(v) => void rename(v)} />
            {meta}
          </span>
        </div>
      ) : (
        <Link ref={linkRef} href={`/${project.type}/${project.id}`} className={styles.surface}>
          {preview}
          <span className={styles.body}>
            <span className={styles.title}>{project.title}</span>
            {meta}
          </span>
        </Link>
      )}

      {project.isPublic && !busy ? (
        <span className={styles.public}>
          <Globe size={12} aria-hidden="true" />
          Público
        </span>
      ) : null}

      {busy ? (
        <span className={styles.busyLabel} role="status">
          {busy === 'duplicate' ? 'Duplicando…' : 'Borrando…'}
        </span>
      ) : null}

      <div className={styles.menu}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              ref={triggerRef}
              label={`Opciones de «${project.title}»`}
              icon={<Ellipsis size={18} />}
              variant="solid"
              size="sm"
              disabled={busy !== null}
              tooltipSide="left"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(e) => {
              // Si se eligió «Renombrar», Radix devolvería el foco al botón de opciones: es del input.
              if (!wantsRename.current) return;
              wantsRename.current = false;
              e.preventDefault();
              inputRef.current?.focus();
            }}
          >
            <DropdownMenuItem
              icon={<Pencil size={16} />}
              onSelect={() => {
                wantsRename.current = true;
                setRenaming(true);
              }}
            >
              Renombrar
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy size={16} />} onSelect={() => void duplicate()}>
              Duplicar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={project.isPublic ? <GlobeLock size={16} /> : <Globe size={16} />}
              onSelect={() => void togglePublic()}
            >
              {project.isPublic ? 'Dejar de compartir' : 'Compartir con enlace público'}
            </DropdownMenuItem>
            {project.isPublic ? (
              <DropdownMenuItem icon={<LinkIcon size={16} />} onSelect={() => void copyLink()}>
                Copiar enlace
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem danger icon={<Trash2 size={16} />} onSelect={() => setConfirmDelete(true)}>
              Borrar…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={confirmDelete} onOpenChange={(o) => busy !== 'delete' && setConfirmDelete(o)}>
        <DialogContent
          size="sm"
          title={`¿Borrar «${project.title}»?`}
          description={
            project.isPublic
              ? 'Se borrarán el proyecto y sus archivos, y su enlace público dejará de funcionar. No se puede deshacer.'
              : 'Se borrarán el proyecto y sus archivos. No se puede deshacer.'
          }
          footer={
            <>
              <Button disabled={busy === 'delete'} onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={busy === 'delete'} onClick={() => void remove()}>
                Borrar
              </Button>
            </>
          }
        />
      </Dialog>
    </li>
  );
}

/** Renombrado en contexto: Enter y salir del campo confirman; Escape cancela; vacío no cambia nada. */
function RenameInput({
  title,
  onDone,
  ref,
}: {
  title: string;
  onDone: (value: string) => void;
  ref: Ref<HTMLInputElement>;
}) {
  const done = useRef(false);
  const finish = (value: string) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') finish(e.currentTarget.value);
    if (e.key === 'Escape') finish('');
  };
  return (
    <input
      ref={ref}
      className={styles.rename}
      defaultValue={title}
      maxLength={MAX_TITLE_LENGTH}
      aria-label={`Nuevo nombre de «${title}»`}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
