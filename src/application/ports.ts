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

export interface MemberJoin {
  name: string;
  token: string;
}

export interface InviteRepo {
  /** Dueño: crea un enlace de invitación (caduca en 7 días) y devuelve su token. */
  create(projectId: string, role: Role, createdBy: string): Promise<Invite>;
  get(token: string): Promise<Invite | null>;
  /** Invitaciones vigentes que creó `uid` para el proyecto. */
  listFor(projectId: string, uid: string): Promise<Invite[]>;
  /** Dueño: cierra la invitación y sube `aclRev` en el mismo batch (versión del espejo de presencia). */
  revoke(projectId: string, token: string): Promise<void>;
  /** Invitado: se añade a `members` y deja su rastro en `joins/{uid}` (un batch). */
  accept(invite: Invite, user: AuthUser): Promise<void>;
  /** Dueño: quiénes entraron por invitación (nombre y token con el que entraron), por uid. */
  memberJoins(projectId: string): Promise<Record<string, MemberJoin>>;
  /**
   * Dueño: revoca la invitación y quita de `members` a quienes entraron con ese token (un batch). Devuelve los
   * uid quitados.
   */
  revokeAndRemove(projectId: string, token: string): Promise<string[]>;
  /**
   * Dueño: instantánea del acceso para publicarla en el espejo de presencia: miembros e invitaciones vigentes, con la
   * `aclRev` del proyecto leída antes que ambos (una instantánea nunca lleva una versión más nueva que su contenido).
   */
  aclSnapshot(projectId: string, ownerId: string): Promise<AclSnapshot>;
}

/** Estado completo del acceso a un proyecto, versionado con `aclRev`. */
export interface AclSnapshot {
  version: number;
  members: Record<string, Role>;
  invites: Record<string, { role: Role; expiresAt: number }>;
}

/** Quién está conectado a un proyecto y dónde tiene el cursor (coordenadas de escena o de flujo; sin él, aún no lo movió). */
export interface Presence {
  uid: string;
  name: string;
  color: string;
  x?: number;
  y?: number;
  at: number;
}

/** Sala de presencia de un proyecto. Cuelga del dueño porque las reglas de Realtime Database no leen Firestore. */
export interface PresenceRoom {
  ownerId: string;
  projectId: string;
}

export interface PresenceSession {
  /** Publica el cursor (el llamador lo limita con `throttleCursor`). */
  move(x: number, y: number): void;
  /** Sale de la sala (el servidor también lo hace solo al perder la conexión: `onDisconnect`). */
  close(): void;
}

export interface PresenceRepo {
  /**
   * Entra en la sala: publica a `me`, avisa a `onList` con los demás conectados cada vez que cambian y devuelve la
   * sesión. Sin Realtime Database configurado, es una sesión vacía (la colaboración sigue sin presencia).
   */
  join(
    room: PresenceRoom,
    me: { uid: string; name: string; color: string },
    onList: (others: Presence[]) => void,
    onError?: (e: Error) => void,
  ): PresenceSession;
}

/**
 * Espejo de acceso en Realtime Database (las reglas de presencia no leen Firestore). Firestore es la fuente de
 * verdad; todo es de mejor esfuerzo y nunca debe romper el compartir.
 */
export interface PresenceAcl {
  /**
   * Dueño: reemplaza el espejo completo (miembros e invitaciones) por la instantánea, solo si su versión no es anterior
   * a la publicada: `'stale'` si había una más nueva (ya es autoritativa), `'off'` sin Realtime Database. Si falla, lanza.
   */
  publish(room: PresenceRoom, snap: AclSnapshot): Promise<'ok' | 'stale' | 'off'>;
  /** Invitado: se registra con el token con el que entró. */
  joinWithInvite(room: PresenceRoom, uid: string, role: Role, token: string): Promise<void>;
}

/** Color estable por persona, de una paleta legible en claro y oscuro. */
const PALETTE = ['#e11d48', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#4b5563'];
export function presenceColor(uid: string): string {
  let h = 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
