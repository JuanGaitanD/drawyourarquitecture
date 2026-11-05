export type ProjectType = 'note' | 'board';

export interface Project {
  id: string;
  ownerId: string;
  type: ProjectType;
  title: string;
  isPublic: boolean;
  /** Miembros además del dueño (rol por uid). Sin él, el proyecto es solo del dueño. */
  members?: Record<string, Role>;
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

export type Role = 'editor' | 'viewer';
export type MyRole = Role | 'owner';

/** Rol de `uid` en el proyecto: dueño, editor, viewer o `null` si no es miembro (solo lo ve si es público). */
export function roleOf(p: Pick<Project, 'ownerId' | 'members'>, uid: string | null | undefined): MyRole | null {
  if (!uid) return null;
  if (p.ownerId === uid) return 'owner';
  return p.members?.[uid] ?? null;
}
