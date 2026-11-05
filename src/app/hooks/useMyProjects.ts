import { useCallback, useEffect, useState } from 'react';
import type { Project } from '@/domain/project';
import { projectRepo } from '../services';

export interface MyProjects {
  /** `null` mientras carga. */
  projects: Project[] | null;
  error: Error | null;
  retry: () => void;
}

/** Suscripción en vivo a los proyectos del usuario, del más reciente al más antiguo. */
export function useMyProjects(uid: string | null): MyProjects {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uid) return;
    return projectRepo.listMine(
      uid,
      (list) => {
        setError(null);
        setProjects(list);
      },
      setError,
    );
  }, [uid, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setProjects(null);
    setAttempt((n) => n + 1);
  }, []);

  return { projects, error, retry };
}
