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

  /**
   * Transacción. Con la revisión esperada escribe `data`; si cambió y hay `merge`, escribe la fusión contra el
   * remoto sobre la revisión actual (el guardado ya no falla por conflicto). Actualiza `projects/{id}.updatedAt`.
   */
  async save(id, data, expectedRevision, merge) {
    const { fs, db } = await loadFirestore();
    return fs.runTransaction(db, async (tx) => {
      const ref = fs.doc(db, 'projects', id, 'content', 'main');
      const snap = await tx.get(ref);
      if (!snap.exists()) return { conflict: true as const };
      const current = Number(snap.data().revision);
      let out = data;
      if (current !== expectedRevision) {
        const remote = snap.data().data;
        if (!merge || typeof remote !== 'string') return { conflict: true as const };
        out = merge(data, remote);
      }
      const updatedAt = Date.now();
      const revision = current + 1;
      tx.update(ref, { data: out, schemaVersion: 1, revision, updatedAt });
      tx.update(fs.doc(db, 'projects', id), { updatedAt });
      return out === data ? { revision } : { revision, merged: out };
    });
  },

  subscribe(id, cb, onError) {
    let off: (() => void) | null = null;
    let closed = false;
    loadFirestore().then(({ fs, db }) => {
      if (closed) return;
      off = fs.onSnapshot(
        fs.doc(db, 'projects', id, 'content', 'main'),
        (snap) => {
          const d = snap.data();
          if (!d || typeof d.data !== 'string' || d.schemaVersion !== 1) return;
          cb({
            data: d.data,
            schemaVersion: 1,
            revision: Number(d.revision) || 0,
            updatedAt: Number(d.updatedAt) || 0,
          });
        },
        (e) => onError?.(e),
      );
    }, (e) => onError?.(e));
    return () => {
      closed = true;
      off?.();
    };
  },
};
