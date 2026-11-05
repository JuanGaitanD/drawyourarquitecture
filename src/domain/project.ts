export type ProjectType = 'note' | 'board';

export interface Project {
  id: string;
  ownerId: string;
  type: ProjectType;
  title: string;
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_TITLE = 'Sin título';
export const MAX_TITLE_LENGTH = 120;

/** Normaliza un título escrito por la persona: recorta, limita y evita vacíos. */
export function normalizeTitle(raw: string | undefined | null): string {
  const t = (raw ?? '').trim().slice(0, MAX_TITLE_LENGTH);
  return t === '' ? DEFAULT_TITLE : t;
}

export function isProjectType(x: unknown): x is ProjectType {
  return x === 'note' || x === 'board';
}
