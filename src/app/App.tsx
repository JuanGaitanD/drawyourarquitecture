import { lazy, Suspense } from 'react';
import { Route, Switch } from 'wouter';
import { isProjectType } from '@/domain/project';
import { AuthGate } from './AuthGate';
import { ErrorBoundary } from './ErrorBoundary';
import { NotFound } from './NotFound';
import { PageFallback } from './PageFallback';

// Páginas lazy: los motores (Excalidraw, React Flow) solo se descargan en las rutas de editor.
const Dashboard = lazy(() => import('./dashboard/Dashboard').then((m) => ({ default: m.Dashboard })));
const Viewer = lazy(() => import('./viewer/Viewer').then((m) => ({ default: m.Viewer })));
const EmbedPage = lazy(() => import('./viewer/EmbedPage').then((m) => ({ default: m.EmbedPage })));
const NoteEditor = lazy(() => import('@/editors/note/NoteEditor').then((m) => ({ default: m.NoteEditor })));
const BoardEditor = lazy(() => import('@/editors/board/BoardEditor').then((m) => ({ default: m.BoardEditor })));

/**
 * Cinco rutas + 404. Los editores se montan con `key={id}` (invariante 2) y exigen sesión;
 * `/view/…` y `/embed/…` son públicas (las reglas deciden si hay acceso).
 */
export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/">
            <AuthGate>
              <Dashboard />
            </AuthGate>
          </Route>
          <Route path="/note/:id">
            {({ id }) => (
              <AuthGate>
                <NoteEditor key={id} id={id} />
              </AuthGate>
            )}
          </Route>
          <Route path="/board/:id">
            {({ id }) => (
              <AuthGate>
                <BoardEditor key={id} id={id} />
              </AuthGate>
            )}
          </Route>
          <Route path="/view/:type/:id">
            {({ type, id }) => (isProjectType(type) ? <Viewer key={id} type={type} id={id} /> : <NotFound />)}
          </Route>
          <Route path="/embed/board/:id">{({ id }) => <EmbedPage key={id} id={id} />}</Route>
          <Route>
            <NotFound />
          </Route>
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}
