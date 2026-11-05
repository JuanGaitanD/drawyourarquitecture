import type { ContentRecord, ContentRepo } from '@/application/ports';
import { loadFirestore } from './firestore';
import { isPermissionDenied } from './projects';

export const contentRepo: ContentRepo = {
  async load(id) {
    const { fs, db } = await loadFirestore();
    try {
      const snap = await fs.getDoc(fs.doc(db, 'projects', id, 'content', 'main'));
      if (!snap.exists()) return null;
      const d = snap.data();
      if (typeof d.data !== 'string' || d.schemaVersion !== 1)
        throw new Error('El contenido guardado tiene un formato desconocido.');
      return {
        data: d.data,
        schemaVersion: 1,
        revision: Number(d.revision) || 0,
        updatedAt: Number(d.updatedAt) || 0,
      } satisfies ContentRecord;
    } catch (e) {
      if (isPermissionDenied(e)) return null;
      throw e;
    }
  },

  /** Transacción: solo escribe si la revisión guardada es la esperada; actualiza también `projects/{id}.updatedAt`. */
  async save(id, data, expectedRevision) {
    const { fs, db } = await loadFirestore();
    return fs.runTransaction(db, async (tx) => {
      const ref = fs.doc(db, 'projects', id, 'content', 'main');
      const snap = await tx.get(ref);
      if (!snap.exists() || Number(snap.data().revision) !== expectedRevision)
        return { conflict: true as const };
      const updatedAt = Date.now();
      const revision = expectedRevision + 1;
      tx.update(ref, { data, schemaVersion: 1, revision, updatedAt });
      tx.update(fs.doc(db, 'projects', id), { updatedAt });
      return { revision };
    });
  },
};
