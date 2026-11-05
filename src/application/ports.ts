import type { Invite } from '@/domain/invite';
import type { Project, Role } from '@/domain/project';

export interface ContentRecord {
  data: string;
  schemaVersion: 1;
  /** Empieza en 0 al crear el proyecto y sube de uno en uno con cada guardado. */
  revision: number;
  updatedAt: number;
}

/** Fusiona lo que se quiere guardar (`local`) con lo que hay en el servidor (`remote`) y devuelve el resultado. */
export type ContentMerger = (local: string, remote: string) => string;

export interface ContentRepo {
  load(id: string): Promise<ContentRecord | null>;
  /**
   * Escribe en transacción. Si `expectedRevision` no coincide con la guardada: sin `merge` devuelve
   * `{ conflict: true }`; con `merge` fusiona contra el remoto, escribe la fusión (`revision + 1`) y la devuelve en
   * `merged` (distinta de `data` cuando el remoto traía algo que el local no tenía).
   */
  save(
    id: string,
    data: string,
    expectedRevision: number,
    merge?: ContentMerger,
  ): Promise<{ revision: number; merged?: string } | { conflict: true }>;
  /** Cambios del contenido en vivo (el primer evento es el estado actual). Devuelve la función para cancelar. */
  subscribe(id: string, cb: (r: ContentRecord) => void, onError?: (e: Error) => void): () => void;
}

export interface ProjectRepo {
  listMine(uid: string, cb: (p: Project[]) => void, onError: (e: Error) => void): () => void;
  /** Proyectos de otros en los que `uid` es miembro (sin orden: se ordena en cliente). */
  listShared(uid: string, cb: (p: Project[]) => void, onError: (e: Error) => void): () => void;
  /** Dueño: fija el rol de `uid` o lo quita con `null`. */
  setMember(id: string, uid: string, role: Role | null): Promise<void>;
  get(id: string): Promise<Project | null>;
  /** Crea el proyecto y su `content/main` (revisión 0) en un mismo batch. Devuelve el id. */
  create(p: Omit<Project, 'id'>, initialData: string): Promise<string>;
  update(id: string, patch: Partial<Pick<Project, 'title' | 'isPublic'>>): Promise<void>;
  /** Borra `content/main` y el proyecto en un batch. Los archivos los borra antes el caso de uso. */
  remove(id: string): Promise<void>;
}

export interface FileStore {
  upload(projectId: string, fileId: string, blob: Blob): Promise<void>;
  load(projectId: string, fileId: string): Promise<Blob>;
  list(projectId: string): Promise<string[]>;
  remove(projectId: string, fileId: string): Promise<void>;
}

export interface AuthUser {
  uid: string;
  name: string;
  photo?: string;
}

export interface Identity {
  current(): AuthUser | null;
  onChange(cb: (user: AuthUser | null) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

export interface Member {
  uid: string;
  name: string;
  role: Role;
}

export interface InviteRepo {
  /** Dueño: crea un enlace de invitación (caduca en 7 días) y devuelve su token. */
  create(projectId: string, role: Role, createdBy: string): Promise<Invite>;
  get(token: string): Promise<Invite | null>;
  /** Invitaciones vigentes que creó `uid` para el proyecto. */
  listFor(projectId: string, uid: string): Promise<Invite[]>;
  revoke(token: string): Promise<void>;
  /** Invitado: se añade a `members` y deja su rastro en `joins/{uid}` (un batch). */
  accept(invite: Invite, user: AuthUser): Promise<void>;
  /** Dueño: nombres de quienes entraron por invitación, por uid. */
  memberNames(projectId: string): Promise<Record<string, string>>;
}
