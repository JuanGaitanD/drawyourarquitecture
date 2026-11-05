import { DEFAULT_TITLE, normalizeTitle, type ProjectType } from '@/domain/project';
import type { ContentRepo, FileStore, Identity, ProjectRepo } from './ports';

export interface ProjectDeps {
  projects: ProjectRepo;
  content: ContentRepo;
  files: FileStore;
  identity: Identity;
  /** Contenido inicial ya codificado de cada tipo (lo aporta `app/`, que conoce los editores). */
  emptyContent: (type: ProjectType) => string;
  now?: () => number;
}

export function createProjectUseCases(deps: ProjectDeps) {
  const now = deps.now ?? Date.now;

  async function createProject(type: ProjectType, title?: string): Promise<string> {
    const user = deps.identity.current();
    if (!user) throw new Error('Hace falta iniciar sesión.');
    const t = now();
    return deps.projects.create(
      {
        ownerId: user.uid,
        type,
        title: normalizeTitle(title ?? DEFAULT_TITLE),
        isPublic: false,
        createdAt: t,
        updatedAt: t,
      },
      deps.emptyContent(type),
    );
  }

  /** Copia los archivos y, al final, el contenido: una copia a medias nunca apunta a archivos que faltan. */
  async function duplicateProject(id: string): Promise<string> {
    const [src, rec] = await Promise.all([deps.projects.get(id), deps.content.load(id)]);
    if (!src || !rec) throw new Error('El proyecto no existe.');
    const newId = await createProject(src.type, `${src.title} (copia)`);
    try {
      for (const fileId of await deps.files.list(id)) {
        await deps.files.upload(newId, fileId, await deps.files.load(id, fileId));
      }
      const res = await deps.content.save(newId, rec.data, 0);
      if ('conflict' in res) throw new Error('Conflicto al copiar el contenido.');
    } catch (e) {
      await deleteProject(newId).catch(() => undefined);
      throw e;
    }
    return newId;
  }

  /** «Guardar como copia» tras un conflicto de revisión: un proyecto nuevo con los datos locales. */
  async function saveAsCopy(id: string, data: string): Promise<string> {
    const src = await deps.projects.get(id);
    if (!src) throw new Error('El proyecto no existe.');
    const newId = await createProject(src.type, `${src.title} (copia)`);
    const res = await deps.content.save(newId, data, 0);
    if ('conflict' in res) throw new Error('Conflicto al guardar la copia.');
    return newId;
  }

  /** Archivos → content → proyecto. */
  async function deleteProject(id: string): Promise<void> {
    for (const fileId of await deps.files.list(id)) await deps.files.remove(id, fileId);
    await deps.projects.remove(id);
  }

  return { createProject, duplicateProject, saveAsCopy, deleteProject };
}

export type ProjectUseCases = ReturnType<typeof createProjectUseCases>;
