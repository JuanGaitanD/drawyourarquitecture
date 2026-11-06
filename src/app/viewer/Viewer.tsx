import { Eye, Pencil } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Link } from 'wouter';
import type { ProjectType } from '@/domain/project';
import { useAuth, useNoindex } from '../hooks';
import { PageFallback } from '../PageFallback';
import { fileStore } from '../services';
import { LogoMark } from '../shell/Logo';
import { ThemeToggle } from '../shell/Shell';
import { MissingMessage, NetworkErrorMessage } from './ViewerMessage';
import styles from './Viewer.module.css';
import { useProjectView } from './useProjectView';

// Los motores solo se descargan para el tipo que se está viendo.
const NoteCanvas = lazy(() => import('@/editors/note/NoteCanvas').then((m) => ({ default: m.NoteCanvas })));
const BoardViewer = lazy(() =>
  import('@/editors/board/BoardViewer').then((m) => ({ default: m.BoardViewer })),
);

/** `/view/:type/:id`: solo lectura, sin sesión si el proyecto es público. */
export function Viewer({ type, id }: { type: ProjectType; id: string }) {
  useNoindex();
  const view = useProjectView(type, id);
  const { user } = useAuth();
  const files = useMemo(() => ({ load: (fileId: string) => fileStore.load(id, fileId) }), [id]);
  const title = view.status === 'ready' ? view.project.title : null;

  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · DYA`;
    return () => {
      document.title = prev;
    };
  }, [title]);

  if (view.status === 'loading') return <PageFallback label="Cargando…" />;
  if (view.status === 'missing') return <MissingMessage />;
  if (view.status === 'error') return <NetworkErrorMessage retry={view.retry} />;

  const { project, parsed } = view;
  const canEdit = user?.uid === project.ownerId;
  return (
    <div className={styles.viewer}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="DYA (Draw your Architecture), ir al inicio">
          <LogoMark size={24} />
        </Link>
        <h1 className={styles.projectTitle}>{project.title}</h1>
        <span className={styles.badge}>
          <Eye size={14} aria-hidden="true" />
          Solo lectura
        </span>
        <div className={styles.actions}>
          {canEdit ? (
            <Link href={`/${type}/${id}`} className={styles.edit}>
              <Pencil size={14} aria-hidden="true" />
              Editar
            </Link>
          ) : null}
          <ThemeToggle />
        </div>
      </header>
      <main className={styles.canvas}>
        <div className={styles.fill}>
          <Suspense fallback={<PageFallback label="Cargando lienzo…" />}>
            {parsed.type === 'note' ? (
              <NoteCanvas projectId={id} content={parsed.content} readonly />
            ) : (
              <BoardViewer content={parsed.content} files={files} />
            )}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
