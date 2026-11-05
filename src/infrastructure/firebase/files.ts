import type { Bytes } from 'firebase/firestore';
import type { FileStore } from '@/application/ports';
import { joinBytes, planBatches, splitBytes } from '@/application/fileChunks';
import { auth } from './firebase';
import { loadFirestore } from './firestore';
import type { FirestoreModule } from './firestoreModule';

// Archivos en Firestore, sin Storage (plan · invariante 3):
//   projects/{projectId}/files/{fileId}            = { mimeType, size, chunks, createdAt, createdBy }
//   projects/{projectId}/files/{fileId}/chunks/{i} = { data: Bytes }   (≤ 900 000 bytes por trozo)
// La meta se escribe la última: una subida a medias no deja una meta que apunte a trozos que faltan.
// `createdBy` (uid de quien sube) deja a un editor invitado deshacer sus propias subidas (D46).
// Firestore se carga con import() desde `firestore.ts`; aquí no hay importación estática del SDK.

/** Trozos máximos de un archivo (`chunks <= 5` en las reglas): sin meta, `remove` los prueba todos. */
const MAX_CHUNKS = 5;

export function createFileStore(
  load: () => Promise<FirestoreModule>,
  currentUid: () => string | undefined,
): FileStore {
  return {
    async upload(projectId, fileId, blob) {
      const uid = currentUid();
      if (!uid) throw new Error('No hay sesión.');
      const { fs, db } = await load();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const parts = splitBytes(bytes);
      const base = fs.doc(db, 'projects', projectId, 'files', fileId);
      const plan = planBatches(parts.map((p) => p.length));
      for (const [n, indexes] of plan.entries()) {
        const batch = fs.writeBatch(db);
        for (const i of indexes) {
          batch.set(fs.doc(base, 'chunks', String(i)), { data: fs.Bytes.fromUint8Array(parts[i]!) });
        }
        if (n === plan.length - 1) {
          batch.set(base, {
            mimeType: blob.type,
            size: bytes.length,
            chunks: parts.length,
            createdAt: Date.now(),
            createdBy: uid,
          });
        }
        await batch.commit();
      }
    },

    async load(projectId, fileId) {
      const { fs, db } = await load();
      const base = fs.doc(db, 'projects', projectId, 'files', fileId);
      const meta = await fs.getDoc(base);
      if (!meta.exists()) throw new Error('El archivo no existe.');
      const { mimeType, chunks } = meta.data() as { mimeType: string; chunks: number };
      const snaps = await Promise.all(
        Array.from({ length: chunks }, (_, i) => fs.getDoc(fs.doc(base, 'chunks', String(i)))),
      );
      const parts = snaps.map((s) => {
        if (!s.exists()) throw new Error('Faltan trozos del archivo.');
        return (s.data().data as Bytes).toUint8Array();
      });
      return new Blob([joinBytes(parts) as BlobPart], { type: mimeType });
    },

    async list(projectId) {
      const { fs, db } = await load();
      const snap = await fs.getDocs(fs.collection(db, 'projects', projectId, 'files'));
      return snap.docs.map((d) => d.id);
    },

    async remove(projectId, fileId) {
      const { fs, db } = await load();
      const base = fs.doc(db, 'projects', projectId, 'files', fileId);
      // Sin listar (solo el dueño puede): `chunks` sale de la meta. Sin meta (subida a medias) se prueban todos los
      // índices posibles: borrar un documento que no existe no falla. Trozos y meta, en un mismo batch.
      const meta = await fs.getDoc(base);
      const n = meta.exists() ? Number(meta.data().chunks) || MAX_CHUNKS : MAX_CHUNKS;
      const batch = fs.writeBatch(db);
      for (let i = 0; i < n; i++) batch.delete(fs.doc(base, 'chunks', String(i)));
      if (meta.exists()) batch.delete(base);
      await batch.commit();
    },
  };
}

export const fileStore: FileStore = createFileStore(loadFirestore, () => auth.currentUser?.uid);
