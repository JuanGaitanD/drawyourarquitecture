import { canMove, normalizeFolderName, type Folder } from '@/domain/folder';
import type { FolderRepo, Identity } from './ports';

export interface FolderDeps {
  folders: FolderRepo;
  identity: Identity;
  now?: () => number;
}

export function createFolderUseCases(deps: FolderDeps) {
  const now = deps.now ?? Date.now;

  function name(raw: string): string {
    const n = normalizeFolderName(raw);
    if (n === '') throw new Error('El nombre de la carpeta no puede estar vacío.');
    return n;
  }

  async function createFolder(raw: string, parentId: string | null): Promise<string> {
    const user = deps.identity.current();
    if (!user) throw new Error('Hace falta iniciar sesión.');
    const t = now();
    return deps.folders.create({ ownerId: user.uid, name: name(raw), parentId, createdAt: t, updatedAt: t });
  }

  async function renameFolder(id: string, raw: string): Promise<void> {
    await deps.folders.rename(id, name(raw));
  }

  /** Mueve la carpeta; rechaza los ciclos (a sí misma o a un descendiente) con la lista vigente. */
  async function moveFolder(all: readonly Folder[], id: string, parentId: string | null): Promise<void> {
    if (!canMove(all, id, parentId)) throw new Error('No se puede mover la carpeta ahí.');
    await deps.folders.move(id, parentId);
  }

  return { createFolder, renameFolder, moveFolder, deleteFolder: (id: string) => deps.folders.remove(id) };
}
