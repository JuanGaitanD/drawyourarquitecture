import type { DocumentData } from 'firebase/firestore';
import type { ProjectRepo } from '@/application/ports';
import { isProjectType, type Project, type Role } from '@/domain/project';
import { isPermissionDenied } from './errors';
import { loadFirestore } from './firestore';

export { isPermissionDenied };

function toProject(id: string, d: DocumentData): Project | null {
  if (!isProjectType(d.type) || typeof d.ownerId !== 'string' || typeof d.title !== 'string') return null;
  return {
    id,
    ownerId: d.ownerId,
    type: d.type,
    title: d.title,
    isPublic: d.isPublic === true,
    members: toMembers(d.members),
    createdAt: Number(d.createdAt) || 0,
    updatedAt: Number(d.updatedAt) || 0,
  };
}

function toMembers(x: unknown): Record<string, Role> | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const out: Record<string, Role> = {};
  for (const [uid, r] of Object.entries(x)) if (r === 'editor' || r === 'viewer') out[uid] = r;
  return out;
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

  listShared(uid, cb, onError) {
    let off: (() => void) | null = null;
    let closed = false;
    loadFirestore().then(({ fs, db }) => {
      if (closed) return;
      // Sin orderBy: el campo por uid no admite índice compuesto; se ordena en cliente.
      const q = fs.query(
        fs.collection(db, 'projects'),
        fs.where(new fs.FieldPath('members', uid), 'in', ['editor', 'viewer']),
      );
      off = fs.onSnapshot(
        q,
        (snap) =>
          cb(
            snap.docs
              .map((d) => toProject(d.id, d.data()))
              .filter((p): p is Project => p !== null)
              .sort((a, b) => b.updatedAt - a.updatedAt),
          ),
        (e) => onError(e),
      );
    }, onError);
    return () => {
      closed = true;
      off?.();
    };
  },

  async setMember(id, uid, role) {
    const { fs, db } = await loadFirestore();
    await fs.updateDoc(
      fs.doc(db, 'projects', id),
      new fs.FieldPath('members', uid),
      role ?? fs.deleteField(),
      'updatedAt',
      Date.now(),
      'aclRev',
      fs.increment(1), // versión del espejo de presencia (ver firestore.rules.tpl)
    );
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
    const main = fs.doc(ref, 'content', 'main');
    const batch = fs.writeBatch(db);
    // Los trozos del contenido (D17) no se borran con su padre.
    (await fs.getDocs(fs.collection(main, 'chunks'))).docs.forEach((d) => batch.delete(d.ref));
    batch.delete(main);
    batch.delete(ref);
    await batch.commit();
  },
};
