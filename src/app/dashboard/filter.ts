import type { Folder } from '@/domain/folder';
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

/** Carpeta efectiva de un proyecto: una carpeta que ya no existe cuenta como Inicio (`null`), nunca queda invisible. */
const folderOf = (p: Project, ids: ReadonlySet<string>): string | null =>
  p.folderId && ids.has(p.folderId) ? p.folderId : null;

/** Proyectos que están directamente en `folderId` (`null` = Inicio). Conserva el orden recibido. */
export function projectsIn(projects: readonly Project[], folderId: string | null, folders: readonly Folder[]): Project[] {
  const ids = new Set(folders.map((f) => f.id));
  return projects.filter((p) => folderOf(p, ids) === folderId);
}

/** Elementos de cada carpeta (proyectos directos + subcarpetas directas), por id de carpeta. */
export function itemCounts(projects: readonly Project[], folders: readonly Folder[]): Map<string, number> {
  const ids = new Set(folders.map((f) => f.id));
  const out = new Map<string, number>();
  const bump = (id: string | null) => id !== null && out.set(id, (out.get(id) ?? 0) + 1);
  for (const p of projects) bump(folderOf(p, ids));
  for (const f of folders) bump(f.parentId !== null && ids.has(f.parentId) ? f.parentId : null);
  return out;
}
