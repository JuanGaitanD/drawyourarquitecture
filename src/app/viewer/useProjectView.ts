import { useMemo } from 'react';
import type { Project, ProjectType } from '@/domain/project';
import { useProject } from '../hooks';
import { parseContent, type ParsedContent } from './content';

export type ProjectView =
  | { status: 'loading' }
  /** No existe, es privado o es de otro tipo: se ven igual a propósito. */
  | { status: 'missing' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; project: Project; parsed: ParsedContent };

/** Carga un proyecto para verlo (sin sesión si es público) y lo reduce a los cuatro estados de la pantalla. */
export function useProjectView(type: ProjectType, id: string): ProjectView {
  const { status, project, content, reload } = useProject(id);
  const parsed = useMemo(
    () => (project && content && project.type === type ? parseContent(type, content.data) : null),
    [project, content, type],
  );

  if (status === 'loading') return { status: 'loading' };
  if (status === 'missing') return { status: 'missing' };
  if (status === 'error') return { status: 'error', retry: reload };
  if (!project || !parsed)
    return project?.type === type ? { status: 'error', retry: reload } : { status: 'missing' };
  return { status: 'ready', project, parsed };
}
