import type { Project } from '@/domain/project';

export interface ContentRecord {
  data: string;
  schemaVersion: 1;
  /** Empieza en 0 al crear el proyecto y sube de uno en uno con cada guardado. */
  revision: number;
  updatedAt: number;
}

export interface ContentRepo {
  load(id: string): Promise<ContentRecord | null>;
  /** Escribe en transacción: si `expectedRevision` no coincide con la guardada, devuelve `{ conflict: true }`. */
  save(id: string, data: string, expectedRevision: number): Promise<{ revision: number } | { conflict: true }>;
}

export interface ProjectRepo {
  listMine(uid: string, cb: (p: Project[]) => void, onError: (e: Error) => void): () => void;
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
