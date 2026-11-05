import type { Presence, PresenceRepo } from '@/application/ports';
import { loadFirestore } from './firestore';

export const presenceRepo: PresenceRepo = {
  async beat(projectId, me) {
    const { fs, db } = await loadFirestore();
    await fs.setDoc(fs.doc(db, 'projects', projectId, 'presence', me.uid), {
      name: me.name.slice(0, 80),
      color: me.color,
      at: Date.now(),
    });
  },

  async leave(projectId, uid) {
    const { fs, db } = await loadFirestore();
    await fs.deleteDoc(fs.doc(db, 'projects', projectId, 'presence', uid));
  },

  subscribe(projectId, cb, onError) {
    let off: (() => void) | null = null;
    let closed = false;
    loadFirestore().then(
      ({ fs, db }) => {
        if (closed) return;
        off = fs.onSnapshot(
          fs.collection(db, 'projects', projectId, 'presence'),
          (snap) =>
            cb(
              snap.docs.map(
                (d): Presence => ({
                  uid: d.id,
                  name: String(d.data().name ?? ''),
                  color: String(d.data().color ?? '#4b5563'),
                  at: Number(d.data().at) || 0,
                }),
              ),
            ),
          (e) => onError?.(e),
        );
      },
      (e) => onError?.(e),
    );
    return () => {
      closed = true;
      off?.();
    };
  },
};
