import { doc, getDoc, runTransaction } from 'firebase/firestore';
import type { ContentRecord, ContentRepo } from '@/application/ports';
import { db } from './firebase';
import { isPermissionDenied } from './projects';

const contentRef = (id: string) => doc(db, 'projects', id, 'content', 'main');

export const contentRepo: ContentRepo = {
  async load(id) {
    try {
      const snap = await getDoc(contentRef(id));
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
  save(id, data, expectedRevision) {
    return runTransaction(db, async (tx) => {
      const ref = contentRef(id);
      const snap = await tx.get(ref);
      if (!snap.exists() || Number(snap.data().revision) !== expectedRevision)
        return { conflict: true as const };
      const updatedAt = Date.now();
      const revision = expectedRevision + 1;
      tx.update(ref, { data, schemaVersion: 1, revision, updatedAt });
      tx.update(doc(db, 'projects', id), { updatedAt });
      return { revision };
    });
  },
};
