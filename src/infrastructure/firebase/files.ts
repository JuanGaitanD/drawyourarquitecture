import type { Bytes } from 'firebase/firestore';
import type { FileStore } from '@/application/ports';
import { joinBytes, planBatches, splitBytes } from '@/application/fileChunks';
import { loadFirestore } from './firestore';

// Archivos en Firestore, sin Storage (plan · invariante 3):
//   projects/{projectId}/files/{fileId}            = { mimeType, size, chunks, createdAt }
//   projects/{projectId}/files/{fileId}/chunks/{i} = { data: Bytes }   (≤ 900 000 bytes por trozo)
// La meta se escribe la última: una subida a medias no deja una meta que apunte a trozos que faltan.
// Firestore se carga con import() desde `firestore.ts`; aquí no hay importación estática del SDK.

export const fileStore: FileStore = {
  async upload(projectId, fileId, blob) {
    const { fs, db } = await loadFirestore();
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
        batch.set(base, { mimeType: blob.type, size: bytes.length, chunks: parts.length, createdAt: Date.now() });
      }
      await batch.commit();
    }
  },

  async load(projectId, fileId) {
    const { fs, db } = await loadFirestore();
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
    const { fs, db } = await loadFirestore();
    const snap = await fs.getDocs(fs.collection(db, 'projects', projectId, 'files'));
    return snap.docs.map((d) => d.id);
  },

  async remove(projectId, fileId) {
    const { fs, db } = await loadFirestore();
    const base = fs.doc(db, 'projects', projectId, 'files', fileId);
    // Se listan los trozos (no se fía de la meta): también limpia lo que dejó una subida a medias.
    const refs = (await fs.getDocs(fs.collection(base, 'chunks'))).docs.map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 450) {
      const batch = fs.writeBatch(db);
      refs.slice(i, i + 450).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    await fs.deleteDoc(base);
  },
};
