// Composición: único sitio (junto con los hooks de app/) que conecta las implementaciones de
// infrastructure/firebase con los puertos de application. Editores y pantallas importan de aquí.
import { createProjectUseCases } from '@/application/projects';
import { encode } from '@/domain/codec';
import type { ProjectType } from '@/domain/project';
import { emptyBoard } from '@/editors/board/model/board';
import { emptyNote } from '@/editors/note/codec';
import { identity } from '@/infrastructure/firebase/auth';
import { contentRepo } from '@/infrastructure/firebase/content';
import { fileStore } from '@/infrastructure/firebase/files';
import { track } from '@/infrastructure/firebase/analytics';
import { inviteRepo } from '@/infrastructure/firebase/invites';
import { presenceAcl, presenceRepo } from '@/infrastructure/firebase/presence';
import { projectRepo as firestoreProjects } from '@/infrastructure/firebase/projects';
import type { ProjectRepo } from '@/application/ports';

const projectRepo: ProjectRepo = {
  ...firestoreProjects,
  async update(id, patch) {
    await firestoreProjects.update(id, patch);
    if (patch.isPublic === true) track({ name: 'project_publish' });
  },
};

export { identity, contentRepo, fileStore, projectRepo, inviteRepo, presenceAcl, presenceRepo, track };
export { USE_EMULATORS, isFirebaseConfigured } from '@/infrastructure/firebase/firebase';

const emptyContent = (type: ProjectType): string => encode(type === 'board' ? emptyBoard() : emptyNote());

const useCases = createProjectUseCases({
  projects: projectRepo,
  content: contentRepo,
  files: fileStore,
  identity,
  emptyContent,
});

export const { duplicateProject, deleteProject, saveAsCopy } = useCases;

export async function createProject(type: ProjectType, title?: string): Promise<string> {
  const id = await useCases.createProject(type, title);
  track({ name: 'project_create', params: { type } });
  return id;
}
