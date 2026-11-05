import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  FieldPath,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OWNER, STRANGER, createEnv, seedProject } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());

const EDITOR = 'editor-uid';
const VIEWER = 'viewer-uid';
const TOKEN = 'tok-0123456789abcdefghij';

beforeEach(async () => {
  await env.clearFirestore();
  await seedProject(env, 'p', { members: { [EDITOR]: 'editor', [VIEWER]: 'viewer' } });
  await seedProject(env, 'ajeno', { ownerId: 'otro-dueno' });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const content = (fs: ReturnType<typeof as>, id = 'p') => doc(fs, 'projects', id, 'content', 'main');
const proj = (fs: ReturnType<typeof as>, id = 'p') => doc(fs, 'projects', id);
const next = (revision: number) => ({ data: '{"x":1}', schemaVersion: 1, revision, updatedAt: 2 });

async function seedInvite(over: Record<string, unknown> = {}, token = TOKEN) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'invites', token), {
      projectId: 'p',
      role: 'editor',
      createdBy: OWNER,
      expiresAt: Date.now() + 3_600_000,
      ...over,
    });
  });
}

/** Lo que hace el invitado: el rol en `members` y el rastro en `joins/{uid}`, en un batch. */
function join(fs: ReturnType<typeof as>, uid: string, role: string, token = TOKEN, id = 'p') {
  const b = writeBatch(fs);
  b.set(doc(fs, 'projects', id, 'joins', uid), { token, name: uid });
  b.update(proj(fs, id), { [`members.${uid}`]: role });
  return b.commit();
}

describe('compartir · contenido', () => {
  it('el editor escribe el contenido y sube el updatedAt del proyecto', async () => {
    const fs = as(EDITOR);
    const b = writeBatch(fs);
    b.update(content(fs), next(1));
    b.update(proj(fs), { updatedAt: 5 });
    await assertSucceeds(b.commit());
  });

  it('el viewer lee pero no escribe contenido', async () => {
    const fs = as(VIEWER);
    await assertSucceeds(getDoc(content(fs)));
    await assertFails(updateDoc(content(fs), next(1)));
    await assertFails(updateDoc(proj(fs), { updatedAt: 5 }));
  });

  it('un no miembro no lee lo privado ni escribe', async () => {
    const fs = as(STRANGER);
    await assertFails(getDoc(proj(fs)));
    await assertFails(getDoc(content(fs)));
    await assertFails(updateDoc(content(fs), next(1)));
  });

  it('el editor no cambia título, visibilidad ni miembros', async () => {
    const fs = as(EDITOR);
    await assertFails(updateDoc(proj(fs), { title: 'Otro', updatedAt: 5 }));
    await assertFails(updateDoc(proj(fs), { isPublic: true, updatedAt: 5 }));
    await assertFails(updateDoc(proj(fs), { [`members.${STRANGER}`]: 'editor' }));
    await assertFails(updateDoc(proj(fs), { [`members.${EDITOR}`]: deleteField() }));
  });

  it('el dueño gestiona miembros (añadir y quitar) y no admite roles inválidos', async () => {
    const fs = as(OWNER);
    await assertSucceeds(
      updateDoc(proj(fs), { [`members.${STRANGER}`]: 'viewer', updatedAt: 3, aclRev: increment(1) }),
    );
    await assertSucceeds(
      updateDoc(proj(fs), { [`members.${VIEWER}`]: deleteField(), updatedAt: 4, aclRev: increment(1) }),
    );
    await assertFails(
      updateDoc(proj(fs), { [`members.${STRANGER}`]: 'admin', updatedAt: 5, aclRev: increment(1) }),
    );
  });

  it('un miembro no puede borrar el proyecto ni cambiar su dueño', async () => {
    await assertFails(updateDoc(proj(as(EDITOR)), { ownerId: EDITOR }));
    await assertFails(updateDoc(proj(as(OWNER)), { ownerId: EDITOR, updatedAt: 3 }));
  });
});

describe('compartir · lista', () => {
  it('los compartidos se listan por members.<uid> y los propios por ownerId', async () => {
    const mine = query(
      collection(as(EDITOR), 'projects'),
      where(new FieldPath('members', EDITOR), 'in', ['editor', 'viewer']),
    );
    const snap = await assertSucceeds(getDocs(mine));
    if (snap.size !== 1) throw new Error(`esperaba 1 compartido y hay ${snap.size}`);
    await assertSucceeds(getDocs(query(collection(as(OWNER), 'projects'), where('ownerId', '==', OWNER))));
  });

  it('no se puede listar todo ni los de otro', async () => {
    await assertFails(getDocs(collection(as(EDITOR), 'projects')));
    await assertFails(getDocs(query(collection(as(EDITOR), 'projects'), where('ownerId', '==', OWNER))));
  });
});

describe('compartir · invitaciones', () => {
  it('el dueño crea una invitación de su proyecto; otro no', async () => {
    const data = { projectId: 'p', role: 'viewer', createdBy: OWNER, expiresAt: Date.now() + 86_400_000 };
    await assertSucceeds(setDoc(doc(as(OWNER), 'invites', TOKEN), data));
    await assertFails(setDoc(doc(as(STRANGER), 'invites', TOKEN + 'b'), { ...data, createdBy: STRANGER }));
    await assertFails(setDoc(doc(as(OWNER), 'invites', TOKEN + 'c'), { ...data, projectId: 'ajeno' }));
  });

  it('rechaza roles raros, tokens cortos y caducidades fuera de 7 días', async () => {
    const fs = as(OWNER);
    const ok = { projectId: 'p', role: 'editor', createdBy: OWNER, expiresAt: Date.now() + 86_400_000 };
    await assertFails(setDoc(doc(fs, 'invites', TOKEN), { ...ok, role: 'owner' }));
    await assertFails(setDoc(doc(fs, 'invites', 'corto'), ok));
    await assertFails(setDoc(doc(fs, 'invites', TOKEN), { ...ok, expiresAt: Date.now() + 9 * 86_400_000 }));
    await assertFails(setDoc(doc(fs, 'invites', TOKEN), { ...ok, expiresAt: Date.now() - 1000 }));
  });

  it('el invitado entra con una invitación válida y luego puede escribir', async () => {
    await seedInvite();
    const fs = as(STRANGER);
    await assertSucceeds(join(fs, STRANGER, 'editor'));
    await assertSucceeds(updateDoc(content(fs), next(1)));
  });

  it('con rol viewer entra pero no escribe', async () => {
    await seedInvite({ role: 'viewer' });
    const fs = as(STRANGER);
    await assertSucceeds(join(fs, STRANGER, 'viewer'));
    await assertSucceeds(getDoc(content(fs)));
    await assertFails(updateDoc(content(fs), next(1)));
  });

  it('sin invitación no se añade a nadie', async () => {
    const fs = as(STRANGER);
    await assertFails(updateDoc(proj(fs), { [`members.${STRANGER}`]: 'editor' }));
    await assertFails(join(fs, STRANGER, 'editor')); // el token no existe
  });

  it('una invitación caducada se rechaza', async () => {
    await seedInvite({ expiresAt: Date.now() - 1000 });
    await assertFails(join(as(STRANGER), STRANGER, 'editor'));
  });

  it('el rol pedido debe coincidir con el de la invitación', async () => {
    await seedInvite({ role: 'viewer' });
    await assertFails(join(as(STRANGER), STRANGER, 'editor'));
  });

  it('la invitación vale solo para su proyecto', async () => {
    await seedInvite();
    await assertFails(join(as(STRANGER), STRANGER, 'editor', TOKEN, 'ajeno'));
  });

  it('al unirse solo puede cambiar members.<uid>: ni título ni visibilidad', async () => {
    await seedInvite();
    const fs = as(STRANGER);
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', 'p', 'joins', STRANGER), { token: TOKEN, name: 'x' });
    b.update(proj(fs), { [`members.${STRANGER}`]: 'editor', isPublic: true });
    await assertFails(b.commit());
  });

  it('el rastro joins/{uid} no se escribe con un token inexistente ni a nombre de otro', async () => {
    await seedInvite();
    const fs = as(STRANGER);
    await assertFails(
      setDoc(doc(fs, 'projects', 'p', 'joins', STRANGER), { token: 'no-existe-0123456789abcd', name: 'x' }),
    );
    await assertFails(setDoc(doc(fs, 'projects', 'p', 'joins', 'otra-persona'), { token: TOKEN, name: 'x' }));
  });

  it('nadie añade a otra persona con su invitación', async () => {
    await seedInvite();
    const fs = as(STRANGER);
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', 'p', 'joins', STRANGER), { token: TOKEN, name: 'x' });
    b.update(proj(fs), { 'members.otra-persona': 'editor' });
    await assertFails(b.commit());
  });

  it('la invitación no se lista (solo get) y solo la borra su creador', async () => {
    await seedInvite();
    await assertFails(getDocs(collection(as(STRANGER), 'invites')));
    await assertSucceeds(getDoc(doc(as(STRANGER), 'invites', TOKEN)));
    await assertFails(setDoc(doc(as(STRANGER), 'invites', TOKEN), { projectId: 'p' }));
    await assertSucceeds(getDocs(query(collection(as(OWNER), 'invites'), where('createdBy', '==', OWNER))));
  });
});

describe('compartir · revocar y quitar', () => {
  it('el dueño borra la invitación y quita en un batch a quienes entraron con ella; un miembro no', async () => {
    await seedInvite();
    await assertSucceeds(join(as(STRANGER), STRANGER, 'editor'));
    const owner = as(OWNER);
    const joined = await assertSucceeds(
      getDocs(query(collection(owner, 'projects', 'p', 'joins'), where('token', '==', TOKEN))),
    );
    const b = writeBatch(owner);
    b.delete(doc(owner, 'invites', TOKEN));
    b.update(
      proj(owner),
      new FieldPath('members', joined.docs[0]!.id),
      deleteField(),
      'updatedAt',
      5,
      'aclRev',
      increment(1),
    );
    await assertSucceeds(b.commit());
    await assertFails(getDoc(content(as(STRANGER))));
    await assertSucceeds(getDoc(content(as(EDITOR))));
  });

  it('un miembro no puede borrar la invitación ni quitar a otro miembro', async () => {
    await seedInvite();
    const e = as(EDITOR);
    const b = writeBatch(e);
    b.delete(doc(e, 'invites', TOKEN));
    b.update(proj(e), new FieldPath('members', VIEWER), deleteField(), 'updatedAt', 5);
    await assertFails(b.commit());
  });
});

describe('compartir · aclRev (versión del espejo de presencia)', () => {
  const rm = (fs: ReturnType<typeof as>, ...extra: unknown[]) =>
    updateDoc(proj(fs), new FieldPath('members', VIEWER), deleteField(), 'updatedAt', 5, ...extra);

  it('el dueño sube aclRev exactamente 1 con cada cambio de members (o de invitaciones); sin bump o con otro salto se rechaza', async () => {
    const owner = as(OWNER);
    await assertFails(rm(owner)); // quitar sin avanzar la versión
    await assertFails(rm(owner, 'aclRev', 7)); // saltarla
    await assertFails(rm(owner, 'aclRev', increment(2)));
    await assertSucceeds(rm(owner, 'aclRev', increment(1)));
    expect((await getDoc(proj(owner))).data()?.aclRev).toBe(1);
    await assertFails(updateDoc(proj(owner), { aclRev: 5 })); // sin cambiar members, tampoco salta
    await assertFails(updateDoc(proj(owner), { aclRev: 0 })); // ni retrocede
    await assertSucceeds(updateDoc(proj(owner), { aclRev: increment(1) })); // +1 sin members: cambio de invitaciones
    expect((await getDoc(proj(owner))).data()?.aclRev).toBe(2);
    await assertSucceeds(updateDoc(proj(owner), { title: 'otro', updatedAt: 9 }));
  });

  it('ni un editor ni un invitado tocan aclRev; unirse no la mueve', async () => {
    await assertFails(updateDoc(proj(as(EDITOR)), { updatedAt: 3, aclRev: 99 }));
    await seedInvite();
    const fs = as(STRANGER);
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', 'p', 'joins', STRANGER), { token: TOKEN, name: 'x' });
    b.update(proj(fs), { [`members.${STRANGER}`]: 'editor', aclRev: 99 });
    await assertFails(b.commit());
    await assertSucceeds(join(as(STRANGER), STRANGER, 'editor'));
    expect((await getDoc(proj(as(OWNER)))).data()?.aclRev).toBeUndefined();
  });
});

describe('presencia', () => {
  it('Firestore ya no admite latidos: la presencia vive en Realtime Database', async () => {
    const pres = (fs: ReturnType<typeof as>, uid: string) => doc(fs, 'projects', 'p', 'presence', uid);
    const data = { name: 'Ana', color: '#e11d48', at: 1 };
    await assertFails(setDoc(pres(as(OWNER), OWNER), data));
    await assertFails(setDoc(pres(as(EDITOR), EDITOR), data));
    await assertFails(getDocs(collection(as(OWNER), 'projects', 'p', 'presence')));
  });
});
