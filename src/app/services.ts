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
import { projectRepo } from '@/infrastructure/firebase/projects';

export { identity, contentRepo, fileStore, projectRepo };
export { USE_EMULATORS, isFirebaseConfigured } from '@/infrastructure/firebase/firebase';

const emptyContent = (type: ProjectType): string => encode(type === 'board' ? emptyBoard() : emptyNote());

export const { createProject, duplicateProject, deleteProject, saveAsCopy } = createProjectUseCases({
  projects: projectRepo,
  content: contentRepo,
  files: fileStore,
  identity,
  emptyContent,
});
