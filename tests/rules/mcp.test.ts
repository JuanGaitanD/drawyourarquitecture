import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  addDoc,
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
    await assertFails(updateDoc(ref, { revoked: true, lastUsedAt: 1 }));
    await assertFails(updateDoc(ref, { revoked: true, uid: OWNER }));
    await assertFails(updateDoc(ref, { lastUsedAt: 1 }));
    await assertFails(deleteDoc(ref));
    await assertFails(updateDoc(doc(asOwner(), 'mcpTokens', HASH), { revoked: true }));
    await assertSucceeds(updateDoc(ref, { revoked: true }));
    await assertFails(updateDoc(ref, { revoked: false }));
  });

  it('un token ya revocado no admite más cambios del cliente', async () => {
    await seedToken(HASH, { revoked: true });
    await assertFails(updateDoc(doc(asStranger(), 'mcpTokens', HASH), { revoked: true }));
  });
});

const MAIL = 'amiga@example.com';
const entry = { email: MAIL, addedAt: 1 };
const asMail = (email: string, verified = true, uid = STRANGER) =>
  env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const seedAllowed = (email = MAIL) =>
  env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'allowedEmails', email), { email, addedAt: 1 }),
  );

describe('allowedEmails', () => {
  it('solo el dueño escribe y lista', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'allowedEmails', MAIL), entry));
    await assertSucceeds(getDocs(collection(asOwner(), 'allowedEmails')));
    await assertSucceeds(deleteDoc(doc(asOwner(), 'allowedEmails', MAIL)));

    await assertFails(setDoc(doc(asStranger(), 'allowedEmails', MAIL), entry));
    await assertFails(setDoc(doc(asMail(MAIL), 'allowedEmails', MAIL), entry));
    await assertFails(setDoc(doc(asAnon(), 'allowedEmails', MAIL), entry));
    await assertFails(getDocs(collection(asStranger(), 'allowedEmails')));
    await seedAllowed();
    await assertFails(deleteDoc(doc(asMail(MAIL), 'allowedEmails', MAIL)));
  });

  it('el id es el correo en minúsculas y con forma de correo; campos cerrados', async () => {
    const fs = asOwner();
    await assertFails(
      setDoc(doc(fs, 'allowedEmails', 'Amiga@Example.com'), { ...entry, email: 'Amiga@Example.com' }),
    );
    await assertFails(setDoc(doc(fs, 'allowedEmails', 'sin-arroba'), { ...entry, email: 'sin-arroba' }));
    await assertFails(setDoc(doc(fs, 'allowedEmails', 'a b@c.de'), { ...entry, email: 'a b@c.de' }));
    await assertFails(setDoc(doc(fs, 'allowedEmails', MAIL), { email: MAIL }));
    await assertFails(setDoc(doc(fs, 'allowedEmails', MAIL), { ...entry, extra: 1 }));
    await assertFails(setDoc(doc(fs, 'allowedEmails', MAIL), { ...entry, email: 'otra@example.com' }));
    await assertFails(setDoc(doc(fs, 'allowedEmails', MAIL), { ...entry, addedAt: 'hoy' }));
  });

  it('cada persona lee solo su entrada, y solo con el correo verificado', async () => {
    await seedAllowed();
    await assertSucceeds(getDoc(doc(asMail(MAIL), 'allowedEmails', MAIL)));
    await assertSucceeds(getDoc(doc(asMail('AMIGA@example.com'), 'allowedEmails', MAIL)));
    await assertFails(getDoc(doc(asMail(MAIL, false), 'allowedEmails', MAIL)));
    await assertFails(getDoc(doc(asMail('otra@example.com'), 'allowedEmails', MAIL)));
    await assertFails(getDoc(doc(asStranger(), 'allowedEmails', MAIL)));
    await assertSucceeds(getDoc(doc(asOwner(), 'allowedEmails', MAIL)));
    await assertFails(getDoc(doc(asAnon(), 'allowedEmails', MAIL)));
  });
});

describe('crear proyecto con allowedEmails', () => {
  const create = (fs: ReturnType<typeof asStranger>, id: string, ownerId: string) => {
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', id), projectData({ ownerId }));
    b.set(doc(fs, 'projects', id, 'content', 'main'), contentData());
    return b.commit();
  };

  it('quien no está en la lista no crea; quien sí (correo verificado), crea el suyo y no a nombre de otro', async () => {
    await assertFails(create(asStranger(), 'p1', STRANGER));
    await assertFails(create(asMail(MAIL), 'p1', STRANGER));
    await seedAllowed();
    await assertSucceeds(create(asMail(MAIL), 'p1', STRANGER));
    await assertSucceeds(create(asMail('AMIGA@Example.com', true, 'tercera'), 'p4', 'tercera'));
    await assertFails(create(asMail(MAIL), 'p2', OWNER));
    await assertFails(create(asAnon(), 'p3', STRANGER));
  });

  it('un correo sin verificar o ausente no basta, aunque esté en la lista', async () => {
    await seedAllowed();
    await assertFails(create(asMail(MAIL, false), 'p1', STRANGER));
    await assertFails(create(env.authenticatedContext(STRANGER).firestore(), 'p2', STRANGER));
  });

  it('el dueño sigue creando sin estar en la lista', async () => {
    await assertSucceeds(create(asOwner(), 'p1', OWNER));
  });
});

describe('rateLimits', () => {
  const limit = (over: Record<string, unknown> = {}) => ({ uid: STRANGER, window: 100, count: 1, ...over });
  const ref = (fs: ReturnType<typeof asStranger>, hash = HASH) => doc(fs, 'rateLimits', hash);
  const seedLimit = (over: Record<string, unknown> = {}) =>
    env.withSecurityRulesDisabled((ctx) => setDoc(ref(ctx.firestore()), limit(over)));

  it('solo el dueño del token crea la ventana, con count 1', async () => {
    await seedToken();
    await assertSucceeds(setDoc(ref(asStranger()), limit()));
    await env.clearFirestore();
    await seedToken();
    await assertFails(setDoc(ref(asStranger()), limit({ count: 2 })));
    await assertFails(setDoc(ref(asStranger()), limit({ uid: OWNER })));
    await assertFails(setDoc(ref(asStranger()), limit({ extra: 1 })));
    await assertFails(setDoc(ref(asOwner()), limit({ uid: OWNER })));
    await assertFails(setDoc(ref(asAnon()), limit()));
  });

  it('sin un token propio con ese hash no se crea', async () => {
    await assertFails(setDoc(ref(asStranger()), limit()));
    await seedToken(HASH, { uid: OWNER });
    await assertFails(setDoc(ref(asStranger()), limit()));
  });

  it('dentro de la ventana solo sube de uno en uno y hasta 60; no baja ni se reinicia', async () => {
    await seedToken();
    await seedLimit({ count: 59 });
    const r = ref(asStranger());
    await assertFails(updateDoc(r, { count: 1 }));
    await assertFails(updateDoc(r, { count: 61 }));
    await assertFails(updateDoc(r, { count: 58 }));
    await assertFails(updateDoc(r, { window: 99, count: 1 }));
    await assertSucceeds(updateDoc(r, { count: 60 }));
    await assertFails(updateDoc(r, { count: 61 }));
  });

  it('una ventana posterior reinicia a count 1; no se puede cambiar el uid ni borrar', async () => {
    await seedToken();
    await seedLimit({ count: 60 });
    const r = ref(asStranger());
    await assertFails(updateDoc(r, { window: 101, count: 2 }));
    await assertFails(updateDoc(r, { uid: OWNER }));
    await assertSucceeds(updateDoc(r, { window: 101, count: 1 }));
    await assertFails(deleteDoc(r));
  });

  it('la lee solo el dueño del token', async () => {
    await seedToken();
    await seedLimit();
    await assertSucceeds(getDoc(ref(asStranger())));
    await assertFails(getDoc(ref(asOwner())));
    await assertFails(getDoc(ref(asAnon())));
  });
});

describe('mcpAudit', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    uid: STRANGER,
    tokenHash: HASH,
    tool: 'read_board',
    projectId: 'abc',
    ok: true,
    at: 1,
    expireAt: Timestamp.fromMillis(1_000),
    ...over,
  });
  const audits = (fs: ReturnType<typeof asStranger>) => collection(fs, 'mcpAudit');

  it('cada persona crea las suyas, con un token propio y campos cerrados', async () => {
    await seedToken();
    await assertSucceeds(addDoc(audits(asStranger()), entry()));
    const { projectId: _omit, ...sinProyecto } = entry();
    await assertSucceeds(addDoc(audits(asStranger()), sinProyecto));
    for (const tool of [
      'update_note',
      'create_folder',
      'update_folder',
      'delete_folder',
      'move_project',
      'embed_board',
    ])
      await assertSucceeds(addDoc(audits(asStranger()), entry({ tool })));
    await assertFails(addDoc(audits(asStranger()), entry({ uid: OWNER })));
    await assertFails(addDoc(audits(asOwner()), entry()));
    await assertFails(addDoc(audits(asStranger()), entry({ tokenHash: 'b'.repeat(64) })));
    await assertFails(addDoc(audits(asStranger()), entry({ tool: 'borrar_todo' })));
    await assertFails(addDoc(audits(asStranger()), entry({ extra: 1 })));
    await assertFails(addDoc(audits(asStranger()), entry({ expireAt: 1000 })));
    await assertFails(addDoc(audits(asStranger()), entry({ ok: 'sí' })));
    await assertFails(addDoc(audits(asStranger()), entry({ projectId: 'x'.repeat(129) })));
    await assertFails(addDoc(audits(asAnon()), entry()));
  });

  it('solo se leen las propias; no se editan ni se borran', async () => {
    await seedToken();
    let id = '';
    await env.withSecurityRulesDisabled(async (ctx) => {
      id = (await addDoc(audits(ctx.firestore()), entry())).id;
    });
    const mine = doc(asStranger(), 'mcpAudit', id);
    await assertSucceeds(getDoc(mine));
    await assertSucceeds(getDocs(query(audits(asStranger()), where('uid', '==', STRANGER))));
    await assertFails(getDoc(doc(asOwner(), 'mcpAudit', id)));
    await assertFails(getDocs(query(audits(asOwner()), where('uid', '==', STRANGER))));
    await assertFails(getDocs(audits(asStranger())));
    await assertFails(updateDoc(mine, { ok: false }));
    await assertFails(deleteDoc(mine));
  });
});
