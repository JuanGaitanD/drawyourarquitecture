import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import * as rtdb from 'firebase/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AclSnapshot } from '../../src/application/ports';
import { createPresenceAcl } from '../../src/infrastructure/firebase/presence';

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
const SID = 'sesion-0123456789';
const node = (uid: string, sid = SID) => `presence/${OWNER}/${P}/${uid}/${sid}`;
const me = (over: Record<string, unknown> = {}) => ({ name: 'Ana', color: '#2563eb', at: 1, ...over });

beforeEach(async () => {
  await seed((r) => r.ref(acl()).set({ version: 1, members: { [EDITOR]: { role: 'editor' } } }));
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

const snap = (version: number, over: Partial<AclSnapshot> = {}): AclSnapshot => ({
  version,
  members: { [EDITOR]: 'editor' },
  invites: {},
  ...over,
});
/** El repo real del dueño (o de `uid`) sobre el emulador: el módulo modular opera sobre la base de pruebas. */
const aclFor = (uid: string) => createPresenceAcl(async () => ({ rtdb, db: db(uid) as never }));
const room = { ownerId: OWNER, projectId: P };
const read = async () => {
  let v: { version?: number; members?: Record<string, unknown> } = {};
  await env.withSecurityRulesDisabled(async (ctx) => {
    v = (await ctx.database().ref(acl()).once('value')).val() ?? {};
  });
  return v;
};

describe('espejo de acceso · versión (D33)', () => {
  it('el dueño no escribe una versión anterior a la publicada, ni sin versión', async () => {
    const full = (version?: number) => ({
      ...(version === undefined ? {} : { version }),
      members: { [EDITOR]: { role: 'editor' } },
    });
    await assertFails(db(OWNER).ref(acl()).set(full(0)));
    await assertFails(db(OWNER).ref(acl()).set(full()));
    await assertSucceeds(db(OWNER).ref(acl()).set(full(1))); // la misma versión: idempotente
    await assertSucceeds(db(OWNER).ref(acl()).set(full(2)));
    await assertFails(db(OWNER).ref(acl()).set(full(1)));
    await assertFails(db(OWNER).ref(acl()).set({ version: -1, members: {} }));
    await assertFails(
      db(OWNER)
        .ref(acl())
        .set({ ...full(3), intruso: 1 }),
    );
    await assertSucceeds(db(OWNER).ref(acl()).remove()); // el proyecto se elimina
  });

  it('un snapshot antiguo se rechaza: no restaura a un miembro expulsado', async () => {
    const quitado = 'expulsado-uid';
    // Pestaña 1 lee Firestore (v1, con el miembro); pestaña 2 lo quita y publica v2; después publica la pestaña 1.
    const viejo = snap(1, { members: { [EDITOR]: 'editor', [quitado]: 'viewer' } });
    expect(await aclFor(OWNER).publish(room, snap(2))).toBe('ok');
    expect(await aclFor(OWNER).publish(room, viejo)).toBe('stale');
    expect((await read()).members).toEqual({ [EDITOR]: { role: 'editor' } });
    await assertFails(db(quitado).ref(`presence/${OWNER}/${P}`).once('value'));
    // Y las reglas lo impiden aunque el cliente no comprobara nada (escritura directa con la versión vieja).
    await assertFails(
      db(OWNER)
        .ref(acl())
        .set({ version: 1, members: { [quitado]: { role: 'viewer' } } }),
    );
  });

  it('publicar reemplaza la lista completa: los sobrantes de miembros e invitaciones desaparecen', async () => {
    await seed((r) =>
      r.ref(acl()).set({
        version: 3,
        members: { [EDITOR]: { role: 'editor' }, sobrante: { role: 'viewer' } },
        invites: { [TOKEN]: { role: 'viewer', expiresAt: Date.now() + 60_000 } },
      }),
    );
    expect(await aclFor(OWNER).publish(room, snap(4))).toBe('ok');
    expect(await read()).toEqual({ version: 4, members: { [EDITOR]: { role: 'editor' } } });
    await assertFails(db('sobrante').ref(`presence/${OWNER}/${P}`).once('value'));
    // Sin la invitación publicada, nadie se registra con ese token.
    await assertFails(
      db(OTHER)
        .ref(acl('/members/' + OTHER))
        .set({ role: 'viewer', token: TOKEN }),
    );
  });

  it('D40: el invitado que entra entre la lectura y la publicación del dueño conserva su alta', async () => {
    const vigente = { role: 'viewer' as const, expiresAt: Date.now() + 60_000 };
    await seed((r) => r.ref(acl()).set({ version: 3, members: {}, invites: { [TOKEN]: vigente } }));
    // El dueño lee Firestore (v3, sin el invitado); el invitado acepta y se registra; después publica el dueño.
    const leido = snap(3, { members: {}, invites: { [TOKEN]: vigente } });
    await assertSucceeds(
      db(OTHER)
        .ref(acl('/members/' + OTHER))
        .set({ role: 'viewer', token: TOKEN }),
    );
    expect(await aclFor(OWNER).publish(room, leido)).toBe('ok');
    expect((await read()).members).toEqual({ [OTHER]: { role: 'viewer', token: TOKEN } });
    await assertSucceeds(db(OTHER).ref(`presence/${OWNER}/${P}`).once('value'));

    // Quitar al miembro sube la versión: la publicación nueva lo borra aunque su invitación siga vigente.
    expect(await aclFor(OWNER).publish(room, snap(4, { members: {}, invites: { [TOKEN]: vigente } }))).toBe('ok');
    expect((await read()).members).toBeUndefined();
    await assertFails(db(OTHER).ref(`presence/${OWNER}/${P}`).once('value'));
  });

  it('D40: sin invitación vigente en la instantánea, el alta de un invitado no se conserva', async () => {
    await seed((r) =>
      r.ref(acl()).set({
        version: 3,
        members: { [OTHER]: { role: 'viewer', token: TOKEN } },
        invites: { [TOKEN]: { role: 'viewer', expiresAt: Date.now() + 60_000 } },
      }),
    );
    expect(await aclFor(OWNER).publish(room, snap(3, { members: {}, invites: {} }))).toBe('ok');
    expect((await read()).members).toBeUndefined();
  });

  it('solo el dueño lee el espejo; un miembro o un extraño no', async () => {
    await assertSucceeds(db(OWNER).ref(acl()).once('value'));
    await assertFails(db(EDITOR).ref(acl()).once('value'));
    await assertFails(db(OTHER).ref(acl('/members')).once('value'));
  });

  it('solo el dueño publica, y un fallo se propaga (no se silencia)', async () => {
    await expect(aclFor(OTHER).publish(room, snap(9))).rejects.toThrow();
    expect((await read()).version).toBe(1);
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
    await assertFails(db(OWNER).ref(`presence/${OWNER}/${P}/${EDITOR}`).remove());
    await assertSucceeds(db(EDITOR).ref(node(EDITOR)).remove());
  });

  it('una persona tiene una sesión por pestaña y cerrar una no borra la otra (D25)', async () => {
    await assertSucceeds(db(EDITOR).ref(node(EDITOR, 'pestana-a-0001')).set(me()));
    await assertSucceeds(db(EDITOR).ref(node(EDITOR, 'pestana-b-0002')).set(me({ x: 1, y: 2 })));
    await assertSucceeds(db(EDITOR).ref(node(EDITOR, 'pestana-a-0001')).remove());
    const left = await db(OWNER).ref(`presence/${OWNER}/${P}/${EDITOR}`).once('value');
    if (Object.keys(left.val() ?? {}).join() !== 'pestana-b-0002') throw new Error('debía quedar solo la pestaña B');
    // Ni otra persona ni un no miembro escriben sesiones bajo un uid ajeno.
    await assertFails(db(OWNER).ref(node(EDITOR, 'pestana-c-0003')).set(me()));
    await assertFails(db(OTHER).ref(node(EDITOR, 'pestana-c-0003')).set(me()));
  });

  it('el id de sesión tiene forma válida y el nodo no puede ir sin sesión', async () => {
    await assertFails(db(EDITOR).ref(node(EDITOR, 'corto')).set(me()));
    await assertFails(db(EDITOR).ref(node(EDITOR, 'con espacio 0123')).set(me()));
    await assertFails(db(EDITOR).ref(node(EDITOR, 'x'.repeat(65))).set(me()));
    await assertFails(db(EDITOR).ref(`presence/${OWNER}/${P}/${EDITOR}`).set(me()));
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
