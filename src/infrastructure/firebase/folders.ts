import type { DocumentData } from 'firebase/firestore';
import type { FolderRepo } from '@/application/ports';
import type { Folder } from '@/domain/folder';
import { loadFirestore } from './firestore';

function toFolder(id: string, d: DocumentData): Folder | null {
  if (typeof d.ownerId !== 'string' || typeof d.name !== 'string') return null;
  return {
    id,
    ownerId: d.ownerId,
    name: d.name,
    parentId: typeof d.parentId === 'string' ? d.parentId : null,
    createdAt: Number(d.createdAt) || 0,
    updatedAt: Number(d.updatedAt) || 0,
  };
}

export const folderRepo: FolderRepo = {
  subscribe(uid, cb, onError) {
    let off: (() => void) | null = null;
    let closed = false;
    loadFirestore().then(({ fs, db }) => {
      if (closed) return;
      // Sin orderBy: no hace falta índice compuesto; se ordena en cliente (domain/folder).
      const q = fs.query(fs.collection(db, 'folders'), fs.where('ownerId', '==', uid));
      off = fs.onSnapshot(
        q,
        (snap) => cb(snap.docs.map((d) => toFolder(d.id, d.data())).filter((f): f is Folder => f !== null)),
        (e) => onError(e),
      );
    }, onError);
    return () => {
      closed = true;
      off?.();
    };
  },

  async create(f) {
    const { fs, db } = await loadFirestore();
    const ref = fs.doc(fs.collection(db, 'folders'));
    await fs.setDoc(ref, f);
    return ref.id;
  },

  async rename(id, name) {
    const { fs, db } = await loadFirestore();
    await fs.updateDoc(fs.doc(db, 'folders', id), { name, updatedAt: Date.now() });
  },

  async move(id, parentId) {
    const { fs, db } = await loadFirestore();
    await fs.updateDoc(fs.doc(db, 'folders', id), { parentId, updatedAt: Date.now() });
  },

  async remove(id) {
    const { fs, db } = await loadFirestore();
    await fs.deleteDoc(fs.doc(db, 'folders', id));
  },
};
