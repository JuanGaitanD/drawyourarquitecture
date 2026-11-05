import { deleteObject, getBlob, listAll, ref, uploadBytes } from 'firebase/storage';
import type { FileStore } from '@/application/ports';
import { storage } from './firebase';

// Ruta projects/{id}/files/{fileId}. La descarga es siempre con getBlob: nunca getDownloadURL
// (las URL con token se pueden compartir y se saltarían las reglas).
const fileRef = (projectId: string, fileId: string) => ref(storage, `projects/${projectId}/files/${fileId}`);

export const fileStore: FileStore = {
  async upload(projectId, fileId, blob) {
    await uploadBytes(fileRef(projectId, fileId), blob, { contentType: blob.type });
  },
  load: (projectId, fileId) => getBlob(fileRef(projectId, fileId)),
  async list(projectId) {
    const res = await listAll(ref(storage, `projects/${projectId}/files`));
    return res.items.map((i) => i.name);
  },
  async remove(projectId, fileId) {
    await deleteObject(fileRef(projectId, fileId));
  },
};
