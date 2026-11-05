import { useEffect, useState } from 'react';
import type { Project } from '@/domain/project';
import { projectRepo } from '../services';

/** Proyectos de otras personas en los que `uid` es miembro (`null` mientras carga o si falla). */
export function useSharedProjects(uid: string | null): Project[] | null {
  const [projects, setProjects] = useState<Project[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    return projectRepo.listShared(uid, setProjects, () => setProjects([]));
  }, [uid]);
  return projects;
}
