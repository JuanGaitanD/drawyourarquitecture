import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// Reglas de Realtime Database (presencia y espejo de acceso). Necesitan el emulador `database` (9000 por defecto,
// o FIREBASE_DATABASE_EMULATOR_HOST). La API del test es la compat de firebase (`ref().set()`).
const [host = '127.0.0.1', port = '9000'] = (
  process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000'
).split(':');

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: `${process.env.RULES_PROJECT ?? 'demo-dya-rules'}-rtdb`,
    database: { rules: readFileSync('database.rules.json', 'utf8'), host, port: Number(port) },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearDatabase());

const OWNER = 'owner-test';
const EDITOR = 'editor-uid';
const OTHER = 'otra-cuenta';
const P = 'proyecto1';
const TOKEN = 'tok-0123456789abcdefghij';
const db = (uid: string) => env.authenticatedContext(uid).database();
const seed = (
  fn: (
    root: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['database']>,
  ) => Promise<unknown>,
) => env.withSecurityRulesDisabled(async (ctx) => void (await fn(ctx.database())));

const acl = (path = '') => `acl/${OWNER}/${P}${path}`;
const node = (uid: string) => `presence/${OWNER}/${P}/${uid}`;
const me = (over: Record<string, unknown> = {}) => ({ name: 'Ana', color: '#2563eb', at: 1, ...over });

beforeEach(async () => {
  await seed((r) => r.ref(acl('/members/' + EDITOR)).set({ role: 'editor' }));
});

describe('espejo de acceso', () => {
  it('solo el dueño escribe bajo su rama; nadie reclama el proyecto de otro', async () => {
    await assertSucceeds(
      db(OWNER)
        .ref(acl('/invites/' + TOKEN))
        .set({ role: 'editor', expiresAt: Date.now() + 1000 }),
    );
    await assertSucceeds(db(OWNER).ref(acl('/members/otro')).set({ role: 'viewer' }));
    await assertFails(
      db(OTHER)
        .ref(acl('/members/' + OTHER))
        .set({ role: 'editor' }),
    );
    await assertFails(db(OTHER).ref(`acl/${OTHER}x/${P}/members/${OWNER}`).set({ role: 'editor' }));
    await assertFails(
      db(EDITOR)
        .ref(acl('/invites/' + TOKEN))
        .set({ role: 'editor', expiresAt: 1 }),
    );
  });

  it('valida roles y la forma de las invitaciones', async () => {
    await assertFails(db(OWNER).ref(acl('/members/x')).set({ role: 'admin' }));
    await assertFails(
      db(OWNER)
        .ref(acl('/invites/' + TOKEN))
        .set({ role: 'owner', expiresAt: 1 }),
    );
    await assertFails(db(OWNER).ref(acl('/invites/corto')).set({ role: 'editor', expiresAt: 1 }));
    await assertFails(
      db(OWNER)
        .ref(acl('/invites/' + TOKEN))
        .set({ role: 'editor', expiresAt: 1, extra: 1 }),
    );
  });

  it('un invitado se registra con una invitación vigente y su rol exacto', async () => {
    await seed((r) =>
      r.ref(acl('/invites/' + TOKEN)).set({ role: 'viewer', expiresAt: Date.now() + 60_000 }),
    );
    await assertSucceeds(
      db(OTHER)
        .ref(acl('/members/' + OTHER))
        .set({ role: 'viewer', token: TOKEN }),
    );
    await assertFails(db('tercero').ref(acl('/members/tercero')).set({ role: 'editor', token: TOKEN }));
    await assertFails(db('tercero').ref(acl('/members/tercero')).set({ role: 'viewer' }));
    await assertFails(
      db('tercero').ref(acl('/members/tercero')).set({ role: 'viewer', token: 'inventado-0123456789ab' }),
    );
  });

  it('una invitación caducada o a nombre de otro no registra a nadie; el miembro puede salir', async () => {
    await seed((r) => r.ref(acl('/invites/' + TOKEN)).set({ role: 'editor', expiresAt: Date.now() - 1 }));
    await assertFails(
      db(OTHER)
        .ref(acl('/members/' + OTHER))
        .set({ role: 'editor', token: TOKEN }),
    );
    await seed((r) =>
      r.ref(acl('/invites/' + TOKEN)).set({ role: 'editor', expiresAt: Date.now() + 60_000 }),
    );
    await assertFails(
      db(OTHER)
        .ref(acl('/members/' + EDITOR))
        .set({ role: 'editor', token: TOKEN }),
    );
    await assertSucceeds(
      db(EDITOR)
        .ref(acl('/members/' + EDITOR))
        .remove(),
    );
  });
});

describe('presencia', () => {
  it('dueño y miembros escriben su nodo y lo leen entre sí', async () => {
    await assertSucceeds(
      db(OWNER)
        .ref(node(OWNER))
        .set(me({ x: 10, y: 20 })),
    );
    await assertSucceeds(db(EDITOR).ref(node(EDITOR)).set(me()));
    await assertSucceeds(db(EDITOR).ref(`presence/${OWNER}/${P}`).once('value'));
    await assertSucceeds(db(OWNER).ref(`presence/${OWNER}/${P}`).once('value'));
  });

  it('un no miembro no lee la sala ni escribe en ella', async () => {
    await assertFails(db(OTHER).ref(`presence/${OWNER}/${P}`).once('value'));
    await assertFails(db(OTHER).ref(node(OTHER)).set(me()));
    await assertFails(env.unauthenticatedContext().database().ref(`presence/${OWNER}/${P}`).once('value'));
  });

  it('nadie escribe el nodo de otro; cada uno puede borrar el suyo (onDisconnect)', async () => {
    await assertFails(db(EDITOR).ref(node(OWNER)).set(me()));
    await assertSucceeds(db(EDITOR).ref(node(EDITOR)).set(me()));
    await assertFails(db(OWNER).ref(node(EDITOR)).remove());
    await assertSucceeds(db(EDITOR).ref(node(EDITOR)).remove());
  });

  it('valida la forma del nodo y el cursor', async () => {
    await assertFails(
      db(EDITOR)
        .ref(node(EDITOR))
        .set(me({ color: 'rojo' })),
    );
    await assertFails(
      db(EDITOR)
        .ref(node(EDITOR))
        .set(me({ name: 'x'.repeat(81) })),
    );
    await assertFails(
      db(EDITOR)
        .ref(node(EDITOR))
        .set(me({ x: 'a' })),
    );
    await assertFails(
      db(EDITOR)
        .ref(node(EDITOR))
        .set(me({ intruso: 1 })),
    );
    await assertFails(db(EDITOR).ref(node(EDITOR)).set({ name: 'Ana' }));
    await assertSucceeds(
      db(EDITOR)
        .ref(node(EDITOR))
        .set(me({ x: -3.5, y: 1e3 })),
    );
  });

  it('quitar al miembro del espejo le corta la sala', async () => {
    await assertSucceeds(
      db(OWNER)
        .ref(acl('/members/' + EDITOR))
        .remove(),
    );
    await assertFails(db(EDITOR).ref(`presence/${OWNER}/${P}`).once('value'));
    await assertFails(db(EDITOR).ref(node(EDITOR)).set(me()));
  });
});
