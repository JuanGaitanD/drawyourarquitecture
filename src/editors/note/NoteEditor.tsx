import { FileX2, TriangleAlert } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { PageFallback } from '@/app/PageFallback';
import { useAutosave, useProject, type ProjectState } from '@/app/hooks';
import { projectRepo } from '@/app/services';
import type { Draft } from '@/application/saveQueue';
import type { ContentRecord } from '@/application/ports';
import { ContentTooLargeError } from '@/domain/codec';
import { normalizeTitle, type Project } from '@/domain/project';
import { Button, useToast } from '@/ui';
import { decodeNote, encodeNote, type NoteContent } from './codec';
import styles from './NoteEditor.module.css';
import { NoteCanvas, type NoteHandle } from './NoteCanvas';
import { TopBar } from './TopBar';

export interface NoteEditorProps {
  id: string;
}

/** Ruta `/note/:id` (se monta con `key={id}`): carga la nota y no deja guardar hasta hidratar. */
export function NoteEditor({ id }: NoteEditorProps) {
  const p = useProject(id);
  if (p.status === 'loading') return <PageFallback label="Abriendo la nota…" />;
  if (p.status === 'missing') {
    return (
      <Problem
        title="Esta nota no existe o es privada"
        text="Puede que se haya borrado o que no tengas acceso con esta cuenta."
        action={
          <Link href="/" className={styles.link}>
            Volver al panel
          </Link>
        }
      />
    );
  }
  if (p.status === 'error' || !p.project || !p.content) {
    return (
      <Problem
        title="No se pudo cargar la nota"
        text={`${p.error?.message ?? 'Error de red.'} No se guardará nada hasta que cargue bien.`}
        action={
          <Button variant="primary" onClick={p.reload}>
            Reintentar
          </Button>
        }
      />
    );
  }
  if (p.project.type !== 'note') return <Redirect to={`/${p.project.type}/${id}`} replace />;
  return <Loaded project={p.project} record={p.content} draft={p.draft} discardDraft={p.discardDraft} />;
}

function Loaded({
  project,
  record,
  draft,
  discardDraft,
}: {
  project: Project;
  record: ContentRecord;
  draft: ProjectState['draft'];
  discardDraft: () => void;
}) {
  const content = useMemo(() => {
    try {
      return decodeNote(record.data);
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }, [record.data]);

  if (content instanceof Error) {
    return (
      <Problem
        title="El contenido de la nota está dañado"
        text="No se puede abrir y por eso no se guardará nada encima."
        action={
          <Link href="/" className={styles.link}>
            Volver al panel
          </Link>
        }
      />
    );
  }
  return (
    <Session project={project} record={record} content={content} draft={draft} discardDraft={discardDraft} />
  );
}

function Session({
  project,
  record,
  content,
  draft,
  discardDraft,
}: {
  project: Project;
  record: ContentRecord;
  content: NoteContent;
  draft: Draft | null;
  discardDraft: () => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState(project.title);
  const [isPublic, setIsPublic] = useState(project.isPublic);
  const [encoded, setEncoded] = useState<string | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [handle, setHandle] = useState<NoteHandle | null>(null);

  // El lienzo solo llama a onChange tras aplicar initialData: aquí `hydrated` ya es cierto.
  const autosave = useAutosave(project.id, encoded, true, record.revision);

  const onChange = useCallback((c: NoteContent) => {
    try {
      setEncoded(encodeNote(c));
      setTooLarge(false);
    } catch (e) {
      if (!(e instanceof ContentTooLargeError)) throw e;
      setTooLarge(true); // se conserva lo último guardable; no se pisa con nada a medias
    }
  }, []);

  const rename = (raw: string) => {
    const prev = title;
    const next = normalizeTitle(raw);
    setTitle(next);
    projectRepo.update(project.id, { title: next }).catch(() => {
      setTitle(prev);
      toast({
        kind: 'error',
        title: 'No se pudo cambiar el título',
        description: 'Se conserva el anterior.',
      });
    });
  };

  const publish = (value: boolean) => {
    setIsPublic(value);
    projectRepo.update(project.id, { isPublic: value }).catch(() => {
      setIsPublic(!value);
      toast({ kind: 'error', title: 'No se pudo cambiar la visibilidad' });
    });
  };

  const recover = async () => {
    if (!draft || !handle) return;
    try {
      await handle.applyContent(decodeNote(draft.data));
      discardDraft();
      toast({ kind: 'success', title: 'Cambios recuperados' });
    } catch {
      toast({ kind: 'error', title: 'No se pudo recuperar el borrador' });
    }
  };

  const back = () => void autosave.flush().finally(() => navigate('/'));

  return (
    <div className={styles.page}>
      <NoteCanvas
        projectId={project.id}
        content={content}
        readonly={false}
        onChange={onChange}
        onHandle={setHandle}
        topRight={
          <TopBar
            title={title}
            onTitle={rename}
            status={autosave.status}
            tooLarge={tooLarge}
            isPublic={isPublic}
            onPublic={publish}
            shareUrl={`${location.origin}/view/note/${project.id}`}
            onBack={back}
          />
        }
      />
      <div className={styles.banners}>
        {autosave.status === 'conflicto' ? (
          <Banner
            tone="danger"
            text="Otra pestaña guardó esta nota. Si sigues aquí, esos cambios se perderían."
            actions={
              <>
                <Button size="sm" onClick={() => void autosave.resolveConflict('reload')}>
                  Recargar
                </Button>
                <Button size="sm" variant="primary" onClick={() => void autosave.resolveConflict('copy')}>
                  Guardar como copia
                </Button>
              </>
            }
          />
        ) : null}
        {autosave.status === 'error' ? (
          <Banner
            tone="danger"
            text={`No se pudo guardar: ${autosave.error?.message ?? 'error desconocido'}. Tus cambios siguen en esta pestaña.`}
            actions={
              <Button size="sm" variant="primary" onClick={() => void autosave.flush()}>
                Reintentar
              </Button>
            }
          />
        ) : null}
        {tooLarge ? (
          <Banner
            tone="danger"
            text="La nota supera el tope de 900 kB y no se puede guardar. Quita elementos para poder guardar de nuevo."
          />
        ) : null}
        {draft ? (
          <Banner
            tone="warn"
            text="Hay cambios sin guardar de la última vez que abriste esta nota."
            actions={
              <>
                <Button size="sm" onClick={discardDraft}>
                  Descartar
                </Button>
                <Button size="sm" variant="primary" disabled={!handle} onClick={() => void recover()}>
                  Recuperar
                </Button>
              </>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function Banner({
  tone,
  text,
  actions,
}: {
  tone: 'danger' | 'warn';
  text: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <TriangleAlert size={18} aria-hidden="true" className={styles.bannerIcon} />
      <p className={styles.bannerText}>{text}</p>
      {actions ? <div className={styles.bannerActions}>{actions}</div> : null}
    </div>
  );
}

function Problem({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return (
    <div className={styles.problem}>
      <span className={styles.problemIcon} aria-hidden="true">
        <FileX2 size={26} />
      </span>
      <h1 className={styles.problemTitle}>{title}</h1>
      <p className={styles.problemText}>{text}</p>
      {action}
    </div>
  );
}
