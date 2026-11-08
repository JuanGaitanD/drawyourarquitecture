import type { AclSnapshot, InviteRepo } from '@/application/ports';
import { INVITE_TTL_MS, isExpired, newInviteToken, type Invite } from '@/domain/invite';
import type { Role } from '@/domain/project';
import { loadFirestore } from './firestore';
import type { FirestoreModule } from './firestoreModule';
import { isPermissionDenied } from './errors';

const isRole = (r: unknown): r is Invite['role'] => r === 'editor' || r === 'viewer';

function toInvite(token: string, d: Record<string, unknown>): Invite | null {
  if (typeof d.projectId !== 'string' || !isRole(d.role) || typeof d.createdBy !== 'string') return null;
  return {
    token,
    projectId: d.projectId,
    role: d.role,
    createdBy: d.createdBy,
    expiresAt: Number(d.expiresAt) || 0,
  };
}

/** Fábrica con el Firestore inyectado: la app usa `loadFirestore`; las pruebas de reglas, el emulador autenticado. */
export function createInviteRepo(loadFirestore: () => Promise<FirestoreModule>): InviteRepo {
  /** Borra la invitación (si existe) y sube `aclRev` en el mismo batch; con el commit confirmado nadie más la acepta. */
  async function closeInvite(projectId: string, token: string): Promise<void> {
    const { fs, db } = await loadFirestore();
    const invite = fs.doc(db, 'invites', token);
    if (!(await fs.getDoc(invite)).exists()) return; // reintento: ya estaba cerrada
    const batch = fs.writeBatch(db);
    batch.delete(invite);
    batch.update(fs.doc(db, 'projects', projectId), 'aclRev', fs.increment(1));
    await batch.commit();
  }

  return {
    async create(projectId, role, createdBy) {
      const { fs, db } = await loadFirestore();
      const token = newInviteToken();
      const expiresAt = Date.now() + INVITE_TTL_MS - 60_000; // margen para el reloj del servidor
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, 'invites', token), { projectId, role, createdBy, expiresAt });
      batch.update(fs.doc(db, 'projects', projectId), 'aclRev', fs.increment(1)); // versión del espejo
      await batch.commit();
      return { token, projectId, role, createdBy, expiresAt };
    },

    async get(token) {
      const { fs, db } = await loadFirestore();
      try {
        const snap = await fs.getDoc(fs.doc(db, 'invites', token));
        return snap.exists() ? toInvite(token, snap.data()) : null;
      } catch (e) {
        if (isPermissionDenied(e)) return null;
        throw e;
      }
    },

    async listFor(projectId, uid) {
      const { fs, db } = await loadFirestore();
      const snap = await fs.getDocs(
        fs.query(
          fs.collection(db, 'invites'),
          fs.where('createdBy', '==', uid),
          fs.where('projectId', '==', projectId),
        ),
      );
      return snap.docs
        .map((d) => toInvite(d.id, d.data()))
        .filter((i): i is Invite => i !== null && !isExpired(i))
        .sort((a, b) => b.expiresAt - a.expiresAt);
    },

    revoke: closeInvite,

    async aclSnapshot(projectId, ownerId) {
      const { fs, db } = await loadFirestore();
      // El proyecto va primero: si algo cambia mientras se lee, el contenido es igual o más nuevo que la versión.
      const p = await fs.getDoc(fs.doc(db, 'projects', projectId));
      if (!p.exists()) throw new Error('El proyecto no existe');
      const d = p.data();
      const members: Record<string, Role> = {};
      for (const [uid, r] of Object.entries((d.members ?? {}) as Record<string, unknown>))
        if (isRole(r)) members[uid] = r;
      const invites: AclSnapshot['invites'] = {};
      for (const i of await this.listFor(projectId, ownerId))
        invites[i.token] = { role: i.role, expiresAt: i.expiresAt };
      return { version: Number(d.aclRev) || 0, members, invites };
    },

    async accept(invite, user) {
      const { fs, db } = await loadFirestore();
      const project = fs.doc(db, 'projects', invite.projectId);
      // D51: quien ya es miembro con este rol no escribe nada (la regla de D44 exige que el rol cambie y el rastro
      // ya nombra el enlace que se lo dio). Quien aún no puede leer el proyecto sigue el flujo normal.
      const current = await fs.getDoc(project).then(
        (s) => (s.data()?.members as Record<string, unknown> | undefined)?.[user.uid],
        (e: unknown) => {
          if (isPermissionDenied(e)) return undefined;
          throw e;
        },
      );
      if (current === invite.role) return;
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(project, 'joins', user.uid), { token: invite.token, name: user.name.slice(0, 80) });
      batch.update(project, new fs.FieldPath('members', user.uid), invite.role);
      await batch.commit();
    },

    async memberJoins(projectId) {
      const { fs, db } = await loadFirestore();
      const snap = await fs.getDocs(fs.collection(db, 'projects', projectId, 'joins'));
      return Object.fromEntries(
        snap.docs.map((d) => [
          d.id,
          { name: String(d.data().name ?? d.id), token: String(d.data().token ?? '') },
        ]),
      );
    },

    async revokeAndRemove(projectId, token) {
      const { fs, db } = await loadFirestore();
      // 1) Cerrar la invitación y esperar la confirmación: desde ahí las reglas (get del invite) rechazan cualquier
      //    aceptación nueva, así que `joins` ya no puede crecer. Si ya no existe (reintento), no hay nada que cerrar.
      await closeInvite(projectId, token);
      // 2) Con el cierre confirmado, quitar a todos los que entraron con ese token. Idempotente: si falla, la
      //    invitación ya está cerrada y se repite desde aquí.
      const joined = await fs.getDocs(
        fs.query(fs.collection(db, 'projects', projectId, 'joins'), fs.where('token', '==', token)),
      );
      const uids = joined.docs.map((d) => d.id);
      if (uids.length > 0) {
        const [first, ...rest] = uids.map((uid) => new fs.FieldPath('members', uid));
        await fs.updateDoc(
          fs.doc(db, 'projects', projectId),
          first!,
          fs.deleteField(),
          ...rest.flatMap((f) => [f, fs.deleteField()]),
          'updatedAt',
          Date.now(),
          'aclRev',
          fs.increment(1), // versión del espejo de presencia (ver firestore.rules.tpl)
        );
      }
      return uids;
    },
  };
}

export const inviteRepo: InviteRepo = createInviteRepo(loadFirestore);
