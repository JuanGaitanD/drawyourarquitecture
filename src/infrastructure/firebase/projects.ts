import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import type { ProjectRepo } from '@/application/ports';
import { isProjectType, type Project } from '@/domain/project';
import { db } from './firebase';

const col = collection(db, 'projects');

export const isPermissionDenied = (e: unknown) => (e as { code?: string } | null)?.code === 'permission-denied';

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
    const q = query(col, where('ownerId', '==', uid), orderBy('updatedAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => cb(snap.docs.map((d) => toProject(d.id, d.data())).filter((p): p is Project => p !== null)),
      (e) => onError(e),
    );
  },

  async get(id) {
    try {
      const snap = await getDoc(doc(col, id));
      return snap.exists() ? toProject(snap.id, snap.data()) : null;
    } catch (e) {
      // Un proyecto privado o inexistente se ve igual para quien no es dueño: las reglas lo deniegan.
      if (isPermissionDenied(e)) return null;
      throw e;
    }
  },

  async create(p, initialData) {
    const ref = doc(col);
    const batch = writeBatch(db);
    batch.set(ref, p);
    batch.set(doc(ref, 'content', 'main'), { data: initialData, schemaVersion: 1, revision: 0, updatedAt: p.updatedAt });
    await batch.commit();
    return ref.id;
  },

  async update(id, patch) {
    await updateDoc(doc(col, id), { ...patch, updatedAt: Date.now() });
  },

  async remove(id) {
    const ref = doc(col, id);
    const batch = writeBatch(db);
    batch.delete(doc(ref, 'content', 'main'));
    batch.delete(ref);
    await batch.commit();
  },
};
