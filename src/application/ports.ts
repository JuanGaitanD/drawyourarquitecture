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

/** Quién está conectado a un proyecto. Latido cada 60 s; caduca a los 2 min. Los cursores no se persisten. */
export interface Presence {
  uid: string;
  name: string;
  color: string;
  at: number;
}
export const PRESENCE_BEAT_MS = 60_000;
export const PRESENCE_TTL_MS = 120_000;

export interface PresenceRepo {
  beat(projectId: string, me: Omit<Presence, 'at'>): Promise<void>;
  /** Mejor esfuerzo al salir: si la pestaña se cierra de golpe, el latido simplemente caduca. */
  leave(projectId: string, uid: string): Promise<void>;
  subscribe(projectId: string, cb: (list: Presence[]) => void, onError?: (e: Error) => void): () => void;
}

/** Color estable por persona, de una paleta legible en claro y oscuro. */
const PALETTE = ['#e11d48', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#4b5563'];
export function presenceColor(uid: string): string {
  let h = 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Los conectados: los que latieron hace menos de `PRESENCE_TTL_MS`, sin contar a `exceptUid`. */
export const onlineNow = (list: readonly Presence[], now: number, exceptUid?: string): Presence[] =>
  list.filter((p) => p.uid !== exceptUid && now - p.at <= PRESENCE_TTL_MS);
