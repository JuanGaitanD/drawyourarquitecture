import type * as StorageSdk from 'firebase/storage';
import type { FileStore } from '@/application/ports';
import { EMULATOR_HOST, EMULATOR_PORTS, USE_EMULATORS, app } from './firebase';

// Ruta projects/{id}/files/{fileId}. La descarga es siempre con getBlob: nunca getDownloadURL
// (las URL con token se pueden compartir y se saltarían las reglas).
//
// El SDK de Storage se carga con import() la primera vez que se usa: solo lo necesitan los editores y
// así no entra en el bundle inicial.
let sdk: Promise<{ mod: typeof StorageSdk; storage: StorageSdk.FirebaseStorage }> | null = null;

function load() {
  sdk ??= import('firebase/storage').then((mod) => {
    const storage = mod.getStorage(app);
    if (USE_EMULATORS) mod.connectStorageEmulator(storage, EMULATOR_HOST, EMULATOR_PORTS.storage);
    return { mod, storage };
  });
  // Si la carga falla (red), la próxima llamada vuelve a intentarlo.
  sdk.catch(() => (sdk = null));
  return sdk;
}

const path = (projectId: string, fileId: string) => `projects/${projectId}/files/${fileId}`;

export const fileStore: FileStore = {
  async upload(projectId, fileId, blob) {
    const { mod, storage } = await load();
    await mod.uploadBytes(mod.ref(storage, path(projectId, fileId)), blob, { contentType: blob.type });
  },
  async load(projectId, fileId) {
    const { mod, storage } = await load();
    return mod.getBlob(mod.ref(storage, path(projectId, fileId)));
  },
  async list(projectId) {
    const { mod, storage } = await load();
    const res = await mod.listAll(mod.ref(storage, `projects/${projectId}/files`));
    return res.items.map((i) => i.name);
  },
  async remove(projectId, fileId) {
    const { mod, storage } = await load();
    await mod.deleteObject(mod.ref(storage, path(projectId, fileId)));
  },
};
