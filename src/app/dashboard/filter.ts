import type { Project, ProjectType } from '@/domain/project';

export type Tab = 'all' | ProjectType;

/** Minúsculas y sin tildes: «diseño» encuentra «Diseno» y «DISEÑO». */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim();

/** Filtra por tab y por texto en el título. Conserva el orden recibido (más reciente primero). */
export function filterProjects(projects: readonly Project[], tab: Tab, query: string): Project[] {
  const q = fold(query);
  return projects.filter((p) => (tab === 'all' || p.type === tab) && (q === '' || fold(p.title).includes(q)));
}

/** Cuántos proyectos tiene cada tab (para los contadores), sin aplicar la búsqueda. */
export function countByTab(projects: readonly Project[]): Record<Tab, number> {
  const notes = projects.filter((p) => p.type === 'note').length;
  return { all: projects.length, note: notes, board: projects.length - notes };
}
