import type { AllowedUser, McpTokenRecord } from '@/application/tokens';
import { generateToken, sha256Hex } from '@/application/tokens';
import { loadFirestore } from './firestore';

/** Crea un token del usuario. Devuelve el valor en claro (única vez que existe) y su registro. */
export async function createToken(
  uid: string,
  label: string,
): Promise<{ token: string; record: McpTokenRecord }> {
  const { fs, db } = await loadFirestore();
  const token = generateToken();
  const hash = await sha256Hex(token);
  const record: McpTokenRecord = { hash, label, createdAt: Date.now(), revoked: false };
  await fs.setDoc(fs.doc(db, 'mcpTokens', hash), {
    uid,
    label: record.label,
    createdAt: record.createdAt,
    revoked: false,
  });
  return { token, record };
}

export async function listTokens(uid: string): Promise<McpTokenRecord[]> {
  const { fs, db } = await loadFirestore();
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'mcpTokens'), fs.where('uid', '==', uid)));
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        hash: d.id,
        label: String(x.label ?? ''),
        createdAt: Number(x.createdAt) || 0,
        lastUsedAt: typeof x.lastUsedAt === 'number' ? x.lastUsedAt : undefined,
        revoked: x.revoked === true,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeToken(hash: string): Promise<void> {
  const { fs, db } = await loadFirestore();
  await fs.updateDoc(fs.doc(db, 'mcpTokens', hash), { revoked: true });
}

/** Solo el dueño puede listar; para el resto lanza `permission-denied`. */
export async function listAllowedUsers(): Promise<AllowedUser[]> {
  const { fs, db } = await loadFirestore();
  const snap = await fs.getDocs(fs.collection(db, 'allowedUsers'));
  return snap.docs
    .map((d) => ({ uid: d.id, email: String(d.data().email ?? ''), addedAt: Number(d.data().addedAt) || 0 }))
    .sort((a, b) => a.addedAt - b.addedAt);
}

export async function addAllowedUser(uid: string, email: string): Promise<AllowedUser> {
  const { fs, db } = await loadFirestore();
  const user = { uid, email, addedAt: Date.now() };
  await fs.setDoc(fs.doc(db, 'allowedUsers', uid), { email, addedAt: user.addedAt });
  return user;
}

export async function removeAllowedUser(uid: string): Promise<void> {
  const { fs, db } = await loadFirestore();
  await fs.deleteDoc(fs.doc(db, 'allowedUsers', uid));
}
