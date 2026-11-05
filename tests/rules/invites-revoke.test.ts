import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FirestoreModule } from '../../src/infrastructure/firebase/firestoreModule';
import { createInviteRepo } from '../../src/infrastructure/firebase/invites';
import { OWNER, STRANGER, createEnv, seedProject } from './env';

// D32: «Revocar y quitar» frente a aceptaciones concurrentes, con el repo real y las reglas reales. Un `FirestoreModule`
// envuelto deja ejecutar una aceptación justo entre los pasos del repo (el intercalado que antes dejaba entrar a alguien).
let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());

const TOKEN = 'tok-0123456789abcdefghij';
const TOKEN_B = 'tok-b-0123456789abcdefg';
const EDITOR = 'editor-uid';

beforeEach(async () => {
  await env.clearFirestore();
  await seedProject(env, 'p', { members: { [EDITOR]: 'editor' } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'invites', TOKEN), {
      projectId: 'p',
      role: 'editor',
      createdBy: OWNER,
      expiresAt: Date.now() + 3_600_000,
    });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
type Db = ReturnType<typeof as>;

/** Lo que hace `inviteRepo.accept`, con el Firestore de `uid`: devuelve si el servidor lo aceptó. */
async function accept(uid: string): Promise<boolean> {
  const fs = as(uid);
  const b = writeBatch(fs);
  b.set(doc(fs, 'projects', 'p', 'joins', uid), { token: TOKEN, name: uid });
  b.update(doc(fs, 'projects', 'p'), { [`members.${uid}`]: 'editor' });
  return b.commit().then(
    () => true,
    () => false,
  );
}

/** El SDK real del dueño, con un gancho `after(paso)` que corre tras cada operación del repo. */
function ownerRepo(after: (step: string) => Promise<void>, failUpdate = false) {
  const wrap =
    <A extends unknown[], R>(step: string, fn: (...a: A) => Promise<R>) =>
    async (...a: A) => {
      if (failUpdate && step === 'updateDoc') throw new Error('red caída');
      const r = await fn(...a);
      await after(step);
      return r;
    };
  const fs = {
    ...sdk,
    getDoc: wrap('getDoc', sdk.getDoc as never),
    getDocs: wrap('getDocs', sdk.getDocs as never),
    writeBatch: (db: Db) => {
      const b = sdk.writeBatch(db as never);
      b.commit = wrap('commit', b.commit.bind(b));
      return b;
    },
    updateDoc: wrap('updateDoc', sdk.updateDoc as never),
  } as unknown as FirestoreModule['fs'];
  return createInviteRepo(async () => ({ fs, db: as(OWNER) as never }));
}

const members = async (): Promise<string[]> =>
  Object.keys(((await getDoc(doc(as(OWNER), 'projects', 'p'))).data()?.members ?? {}) as object);

describe('D32 · «Revocar y quitar» con aceptaciones concurrentes', () => {
  it('nadie que entre mientras se revoca conserva el acceso (acepta tras cada paso del repo)', async () => {
    expect(await accept(STRANGER)).toBe(true);
    let n = 0;
    const accepted: string[] = [];
    const repo = ownerRepo(async () => {
      const uid = `tardio-${n++}`;
      if (await accept(uid)) accepted.push(uid);
    });
    await repo.revokeAndRemove('p', TOKEN);

    // Cada aceptación posterior al cierre se rechazó y las anteriores quedaron en `joins`, así que se retiraron.
    expect(await members()).toEqual([EDITOR]);
    await assertFails(getDoc(doc(as(STRANGER), 'projects', 'p', 'content', 'main')));
    for (const uid of accepted) await assertFails(getDoc(doc(as(uid), 'projects', 'p', 'content', 'main')));
    // La invitación está cerrada: nadie puede aceptarla ya.
    expect(await accept('otro-tardio')).toBe(false);
  });

  it('si falla la limpieza, la invitación ya está cerrada y un reintento quita a quienes entraron', async () => {
    expect(await accept(STRANGER)).toBe(true);
    await expect(ownerRepo(async () => undefined, true).revokeAndRemove('p', TOKEN)).rejects.toThrow(
      'red caída',
    );

    expect(await members()).toContain(STRANGER); // sin quitar aún: estado recuperable
    expect(await accept('tardio')).toBe(false); // pero nadie más entra
    const uids = await ownerRepo(async () => undefined).revokeAndRemove('p', TOKEN); // la invitación ya no existe
    expect(uids).toEqual([STRANGER]);
    expect(await members()).toEqual([EDITOR]);
  });
});

describe('D32 · las reglas rechazan aceptar una invitación ya borrada', () => {
  it('un batch preparado antes del borrado y confirmado después no entra', async () => {
    const fs: Db = as(STRANGER);
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', 'p', 'joins', STRANGER), { token: TOKEN, name: 'x' });
    b.update(doc(fs, 'projects', 'p'), { [`members.${STRANGER}`]: 'editor' });
    await assertSucceeds(sdk.deleteDoc(doc(as(OWNER), 'invites', TOKEN)));
    await assertFails(b.commit());
    expect(await members()).toEqual([EDITOR]);
  });
});

describe('D44 · el rastro `joins` no se reescribe solo', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', TOKEN_B), {
        projectId: 'p',
        role: 'viewer',
        createdBy: OWNER,
        expiresAt: Date.now() + 3_600_000,
      });
    });
  });

  const joinsOf = (uid: string) => doc(as(uid), 'projects', 'p', 'joins', uid);

  it('entra con A (editor): cambiar `joins` a B (viewer) sin tocar `members` se deniega y revocar A lo quita', async () => {
    expect(await accept(STRANGER)).toBe(true);
    await assertFails(setDoc(joinsOf(STRANGER), { token: TOKEN_B, name: 'x' }));
    await assertFails(sdk.updateDoc(joinsOf(STRANGER), { token: TOKEN_B }));
    await assertFails(setDoc(joinsOf(STRANGER), { token: TOKEN, name: 'otro nombre' })); // ni siquiera el mismo token
    await assertFails(sdk.deleteDoc(joinsOf(STRANGER))); // ni esconder el rastro
    expect((await getDoc(doc(as(OWNER), 'projects', 'p', 'joins', STRANGER))).data()?.token).toBe(TOKEN);

    expect(await ownerRepo(async () => undefined).revokeAndRemove('p', TOKEN)).toEqual([STRANGER]);
    expect(await members()).toEqual([EDITOR]);
    await assertFails(getDoc(doc(as(STRANGER), 'projects', 'p', 'content', 'main')));
  });

  it('cambiar de enlace es posible solo aceptando el otro: `members` y `joins` cambian a la vez, con el rol de B', async () => {
    expect(await accept(STRANGER)).toBe(true);
    const fs = as(STRANGER);
    const bad = writeBatch(fs); // joins a B pero el rol queda en editor
    bad.set(doc(fs, 'projects', 'p', 'joins', STRANGER), { token: TOKEN_B, name: 'x' });
    bad.update(doc(fs, 'projects', 'p'), { [`members.${STRANGER}`]: 'editor' });
    await assertFails(bad.commit());

    const ok = writeBatch(fs);
    ok.set(doc(fs, 'projects', 'p', 'joins', STRANGER), { token: TOKEN_B, name: 'x' });
    ok.update(doc(fs, 'projects', 'p'), { [`members.${STRANGER}`]: 'viewer' });
    await assertSucceeds(ok.commit());
    // Revocar A ya no lo toca (ahora entró por B); revocar B sí.
    expect(await ownerRepo(async () => undefined).revokeAndRemove('p', TOKEN)).toEqual([]);
    expect(await members()).toContain(STRANGER);
    expect(await ownerRepo(async () => undefined).revokeAndRemove('p', TOKEN_B)).toEqual([STRANGER]);
  });
});
