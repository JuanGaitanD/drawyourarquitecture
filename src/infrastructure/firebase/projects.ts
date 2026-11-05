import type { DocumentData } from 'firebase/firestore';
import type { ProjectRepo } from '@/application/ports';
import { isProjectType, type Project } from '@/domain/project';
import { loadFirestore } from './firestore';

export const isPermissionDenied = (e: unknown) =>
  (e as { code?: string } | null)?.code === 'permission-denied';

function toProject(id: string, d: DocumentData): Project | null {
  if (!isProjectType(d.type) || typeof d.ownerId !== 'string' || typeof d.title !== 'string') return null;
  return {
    id,
    ownerId: d.ownerId,
    type: d.type,
    title: d.title,
    isPublic: d.isPublic === true,
    createdAt: Number(d.createdAt) || 0,
    updatedAt: Number(d.updatedAt) || 0,
  };
}

export const projectRepo: ProjectRepo = {
  listMine(uid, cb, onError) {
    // Requiere el índice compuesto ownerId + updatedAt (firestore.indexes.json).
    let off: (() => void) | null = null;
    let closed = false;
    loadFirestore().then(({ fs, db }) => {
      if (closed) return;
      const q = fs.query(
        fs.collection(db, 'projects'),
        fs.where('ownerId', '==', uid),
        fs.orderBy('updatedAt', 'desc'),
      );
      off = fs.onSnapshot(
        q,
        (snap) => cb(snap.docs.map((d) => toProject(d.id, d.data())).filter((p): p is Project => p !== null)),
        (e) => onError(e),
      );
    }, onError);
    return () => {
      closed = true;
      off?.();
    };
  },

  async get(id) {
    const { fs, db } = await loadFirestore();
    try {
      const snap = await fs.getDoc(fs.doc(db, 'projects', id));
      return snap.exists() ? toProject(snap.id, snap.data()) : null;
    } catch (e) {
      // Un proyecto privado o inexistente se ve igual para quien no es dueño: las reglas lo deniegan.
      if (isPermissionDenied(e)) return null;
      throw e;
    }
  },

  async create(p, initialData) {
    const { fs, db } = await loadFirestore();
    const ref = fs.doc(fs.collection(db, 'projects'));
    const batch = fs.writeBatch(db);
    batch.set(ref, p);
    batch.set(fs.doc(ref, 'content', 'main'), {
      data: initialData,
      schemaVersion: 1,
      revision: 0,
      updatedAt: p.updatedAt,
    });
    await batch.commit();
    return ref.id;
  },

  async update(id, patch) {
    const { fs, db } = await loadFirestore();
    await fs.updateDoc(fs.doc(db, 'projects', id), { ...patch, updatedAt: Date.now() });
  },

  async remove(id) {
    const { fs, db } = await loadFirestore();
    const ref = fs.doc(db, 'projects', id);
    const batch = fs.writeBatch(db);
    batch.delete(fs.doc(ref, 'content', 'main'));
    batch.delete(ref);
    await batch.commit();
  },
};
