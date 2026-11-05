import { useCallback, useEffect, useState } from 'react';
import type { ContentRecord } from '@/application/ports';
import { clearDraft, recoverableDraft, type Draft } from '@/application/saveQueue';
import type { Project } from '@/domain/project';
import { contentRepo, projectRepo } from '../services';

export type ProjectStatus = 'loading' | 'ready' | 'missing' | 'error';

export interface ProjectState {
  status: ProjectStatus;
  project: Project | null;
  content: ContentRecord | null;
  error: Error | null;
  /** Borrador local más reciente que lo guardado, si lo hay («Recuperar cambios no guardados»). */
  draft: Draft | null;
  /** Descarta el borrador (tras recuperarlo o al rechazarlo). */
  discardDraft: () => void;
  /** Vuelve a cargar: «Reintentar» tras un error de red. */
  reload: () => void;
}

/**
 * Carga el proyecto y su contenido. `status === 'ready'` es la señal de hidratación: hasta entonces
 * el editor no debe guardar (invariante 2). `missing` cubre «no existe o es privado».
 * El editor se monta con `key={id}`, así que cada id arranca en `loading`.
 */
export function useProject(id: string): ProjectState {
  const [state, setState] = useState<Omit<ProjectState, 'discardDraft' | 'reload'>>({
    status: 'loading',
    project: null,
    content: null,
    error: null,
    draft: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([projectRepo.get(id), contentRepo.load(id)])
      .then(([project, content]) => {
        if (cancelled) return;
        if (!project || !content)
          return setState({ status: 'missing', project: null, content: null, error: null, draft: null });
        setState({ status: 'ready', project, content, error: null, draft: recoverableDraft(id, content) });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          project: null,
          content: null,
          error: e instanceof Error ? e : new Error(String(e)),
          draft: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const discardDraft = useCallback(() => {
    clearDraft(id);
    setState((s) => ({ ...s, draft: null }));
  }, [id]);
  const reload = useCallback(() => {
    setState({ status: 'loading', project: null, content: null, error: null, draft: null });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, discardDraft, reload };
}
