import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { createSaveQueue, readDraft, type SaveQueue, type SaveState, type SaveStatus } from '@/application/saveQueue';
import { contentRepo, projectRepo, saveAsCopy } from '../services';

export interface Autosave {
  status: SaveStatus;
  error: Error | null;
  /** Escribe ya lo pendiente (y reintenta tras un error o la vuelta de la conexión). */
  flush: () => Promise<void>;
  /** Tras un conflicto: `reload` recarga la página; `copy` guarda lo local como proyecto nuevo y lo abre. */
  resolveConflict: (kind: 'reload' | 'copy') => Promise<void>;
}

/**
 * Autosave del editor (plan · invariante 2). El editor se monta con `key={id}`.
 * - `encoded`: el contenido ya codificado (`encode(...)`), o `null` si aún no hay.
 * - `hydrated`: `true` solo cuando la carga terminó con éxito. Hasta entonces no se guarda nada.
 * - `revision`: la revisión cargada (`ContentRecord.revision`).
 * - `baseline`: lo guardado en el servidor, para no reescribir lo idéntico. Si se omite, se toma el primer
 *   `encoded` que llegue tras hidratar (el que produce el propio editor al montar).
 */
export function useAutosave(
  id: string,
  encoded: string | null,
  hydrated: boolean,
  revision: number,
  baseline?: string,
): Autosave {
  const [state, setState] = useState<SaveState>({ status: 'guardado' });
  const queue = useRef<SaveQueue | null>(null);
  const latest = useRef<string | null>(null);
  const [, navigate] = useLocation();

  // Una cola por id; flush y limpieza al desmontar. Compatible con StrictMode (se recrea).
  useEffect(() => {
    const q = createSaveQueue(contentRepo, id, null);
    queue.current = q;
    const off = q.onStatus(setState);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void q.flush();
    };
    const onOnline = () => void q.flush();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (q.hasPending() || q.state.status === 'guardando') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
      off();
      queue.current = null;
      void q.flush().finally(() => q.dispose());
    };
  }, [id]);

  useEffect(() => {
    latest.current = encoded;
    const q = queue.current;
    if (!q || !hydrated) return;
    if (!q.hydrated) {
      const base = baseline ?? encoded;
      if (base != null) q.hydrate(revision, base);
      return;
    }
    if (encoded !== null) q.push(encoded);
  }, [encoded, hydrated, revision, baseline]);

  const flush = useCallback(() => queue.current?.flush() ?? Promise.resolve(), []);

  const resolveConflict = useCallback(
    async (kind: 'reload' | 'copy') => {
      if (kind === 'reload') {
        window.location.reload();
        return;
      }
      const data = latest.current ?? readDraft(id)?.data;
      if (!data) return;
      const newId = await saveAsCopy(id, data);
      const copy = await projectRepo.get(newId);
      navigate(`/${copy?.type ?? 'board'}/${newId}`);
    },
    [id, navigate],
  );

  return { status: state.status, error: state.error ?? null, flush, resolveConflict };
}
