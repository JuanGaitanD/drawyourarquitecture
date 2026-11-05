import { useCallback, useEffect, useState } from 'react';
import type { ContentRecord } from '@/application/ports';
import { clearDraft, recoverableDrafts, type StoredDraft } from '@/application/saveQueue';
import type { Project } from '@/domain/project';
import { contentRepo, projectRepo } from '../services';

export type ProjectStatus = 'loading' | 'ready' | 'missing' | 'error';

export interface ProjectState {
  status: ProjectStatus;
  project: Project | null;
  content: ContentRecord | null;
  error: Error | null;
  /** Borrador local distinto de lo guardado (el más reciente de cualquier pestaña), si lo hay («Recuperar cambios»). */
  draft: StoredDraft | null;
  /** Descarta el borrador mostrado (tras recuperarlo o al rechazarlo); si quedan otros, se ofrece el siguiente. */
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
  const [state, setState] = useState<Omit<ProjectState, 'draft' | 'discardDraft' | 'reload'>>({
    status: 'loading',
    project: null,
    content: null,
    error: null,
  });
  const [drafts, setDrafts] = useState<StoredDraft[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([projectRepo.get(id), contentRepo.load(id)])
      .then(([project, content]) => {
        if (cancelled) return;
        if (!project || !content)
          return setState({ status: 'missing', project: null, content: null, error: null });
        setDrafts(recoverableDrafts(id, content));
        setState({ status: 'ready', project, content, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          project: null,
          content: null,
          error: e instanceof Error ? e : new Error(String(e)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const discardDraft = useCallback(() => {
    setDrafts(([first, ...rest]) => {
      if (first) clearDraft(first.key);
      return rest;
    });
  }, []);
  const reload = useCallback(() => {
    setState({ status: 'loading', project: null, content: null, error: null });
    setDrafts([]);
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, draft: drafts[0] ?? null, discardDraft, reload };
}
