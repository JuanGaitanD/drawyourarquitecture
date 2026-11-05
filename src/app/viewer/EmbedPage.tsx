import { lazy, Suspense } from 'react';
import { useNoindex } from '../hooks';
import { PageFallback } from '../PageFallback';
import { MissingMessage, NetworkErrorMessage } from './ViewerMessage';
import styles from './Viewer.module.css';
import { useProjectView } from './useProjectView';

const BoardViewer = lazy(() =>
  import('@/editors/board/BoardViewer').then((m) => ({ default: m.BoardViewer })),
);

/** `/embed/board/:id`: el diagrama a pantalla completa, sin chrome. */
export function EmbedPage({ id }: { id: string }) {
  useNoindex();
  const view = useProjectView('board', id);

  return (
    <div className={styles.embed}>
      {view.status === 'loading' ? (
        <PageFallback label="Cargando diagrama…" />
      ) : view.status === 'missing' ? (
        <MissingMessage compact text="Diagrama privado o inexistente" />
      ) : view.status === 'error' ? (
        <NetworkErrorMessage retry={view.retry} />
      ) : view.parsed.type === 'board' ? (
        <Suspense fallback={<PageFallback label="Cargando diagrama…" />}>
          <BoardViewer content={view.parsed.content} />
        </Suspense>
      ) : null}
    </div>
  );
}
