import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { OWNER, STRANGER, contentData, createEnv, projectData } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asStranger = () => env.authenticatedContext(STRANGER).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

const HASH = 'a'.repeat(64);
const token = (over: Record<string, unknown> = {}) => ({
  uid: STRANGER,
  label: 'Claude Code',
  createdAt: 1,
  revoked: false,
  ...over,
});

async function seedToken(hash = HASH, over: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'mcpTokens', hash), token(over)));
}

describe('mcpTokens', () => {
  it('cada persona crea el suyo con campos cerrados', async () => {
    await assertSucceeds(setDoc(doc(asStranger(), 'mcpTokens', HASH), token()));
  });

  it('rechaza uid ajeno, claves de más, revoked=true, etiqueta vacía o larga, y un id que no es sha256', async () => {
    const fs = asStranger();
    await assertFails(setDoc(doc(fs, 'mcpTokens', HASH), token({ uid: OWNER })));
    await assertFails(setDoc(doc(fs, 'mcpTokens', HASH), token({ lastUsedAt: 1 })));
    await assertFails(setDoc(doc(fs, 'mcpTokens', HASH), token({ revoked: true })));
    await assertFails(setDoc(doc(fs, 'mcpTokens', HASH), token({ label: '' })));
    await assertFails(setDoc(doc(fs, 'mcpTokens', HASH), token({ label: 'x'.repeat(61) })));
    await assertFails(setDoc(doc(fs, 'mcpTokens', 'no-es-un-hash'), token()));
    await assertFails(setDoc(doc(asAnon(), 'mcpTokens', HASH), token()));
  });

  it('lee y lista solo los suyos', async () => {
    await seedToken();
    await assertSucceeds(getDoc(doc(asStranger(), 'mcpTokens', HASH)));
    await assertSucceeds(getDocs(query(collection(asStranger(), 'mcpTokens'), where('uid', '==', STRANGER))));
    await assertFails(getDoc(doc(asOwner(), 'mcpTokens', HASH)));
    await assertFails(getDocs(query(collection(asOwner(), 'mcpTokens'), where('uid', '==', STRANGER))));
    await assertFails(getDoc(doc(asAnon(), 'mcpTokens', HASH)));
  });

  it('revoca el suyo, pero no lo reactiva, no cambia otros campos ni lo borra', async () => {
    await seedToken();
    const ref = doc(asStranger(), 'mcpTokens', HASH);
    await assertFails(updateDoc(ref, { label: 'otro' }));
    await assertFails(updateDoc(ref, { revoked: false }));
    await assertFails(deleteDoc(ref));
    await assertFails(updateDoc(doc(asOwner(), 'mcpTokens', HASH), { revoked: true }));
    await assertSucceeds(updateDoc(ref, { revoked: true }));
    await assertFails(updateDoc(ref, { revoked: false }));
  });
});

describe('allowedUsers', () => {
  const entry = { email: 'amiga@example.com', addedAt: 1 };

  it('solo el dueño escribe y lista', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'allowedUsers', 'u1'), entry));
    await assertSucceeds(getDocs(collection(asOwner(), 'allowedUsers')));
    await assertSucceeds(deleteDoc(doc(asOwner(), 'allowedUsers', 'u1')));

    await assertFails(setDoc(doc(asStranger(), 'allowedUsers', STRANGER), entry));
    await assertFails(setDoc(doc(asAnon(), 'allowedUsers', 'u1'), entry));
    await assertFails(getDocs(collection(asStranger(), 'allowedUsers')));
  });

  it('campos cerrados', async () => {
    const fs = asOwner();
    await assertFails(setDoc(doc(fs, 'allowedUsers', 'u1'), { email: 'a@b.c' }));
    await assertFails(setDoc(doc(fs, 'allowedUsers', 'u1'), { ...entry, extra: 1 }));
    await assertFails(setDoc(doc(fs, 'allowedUsers', 'u1'), { ...entry, email: '' }));
    await assertFails(setDoc(doc(fs, 'allowedUsers', 'u1'), { ...entry, addedAt: 'hoy' }));
  });

  it('cada persona lee solo su entrada', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'allowedUsers', STRANGER), entry),
    );
    await assertSucceeds(getDoc(doc(asStranger(), 'allowedUsers', STRANGER)));
    await assertFails(getDoc(doc(env.authenticatedContext('tercera').firestore(), 'allowedUsers', STRANGER)));
    await assertSucceeds(getDoc(doc(asOwner(), 'allowedUsers', STRANGER)));
    await assertFails(getDoc(doc(asAnon(), 'allowedUsers', STRANGER)));
  });
});

describe('crear proyecto con allowedUsers', () => {
  const create = (fs: ReturnType<typeof asStranger>, id: string, ownerId: string) => {
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', id), projectData({ ownerId }));
    b.set(doc(fs, 'projects', id, 'content', 'main'), contentData());
    return b.commit();
  };

  it('quien no está en la lista no crea; quien sí, crea el suyo y no a nombre de otro', async () => {
    await assertFails(create(asStranger(), 'p1', STRANGER));
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'allowedUsers', STRANGER), { email: 'a@b.c', addedAt: 1 }),
    );
    await assertSucceeds(create(asStranger(), 'p1', STRANGER));
    await assertFails(create(asStranger(), 'p2', OWNER));
    await assertFails(create(asAnon(), 'p3', STRANGER));
  });

  it('el dueño sigue creando sin estar en la lista', async () => {
    await assertSucceeds(create(asOwner(), 'p1', OWNER));
  });
});
