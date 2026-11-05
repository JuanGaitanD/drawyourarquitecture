import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminDb } from './admin';
import type { Identity } from './authz';
import { RATE_LIMIT, RATE_WINDOW_MS, consumeRate, recordAudit } from './limits';
import { EMULATOR, loadRules, seedToken, uniq } from './testkit';
import { closeUserDbs, getUserDb } from './userDb';

// Límite de tasa y auditoría contra los emuladores: las escribe el usuario autenticado bajo las reglas.
describe.skipIf(!EMULATOR)('límite de tasa y auditoría · emulador', () => {
  beforeAll(loadRules);
  afterAll(closeUserDbs);

  async function identity(): Promise<Identity & { db: Awaited<ReturnType<typeof getUserDb>> }> {
    const uid = uniq('limite');
    const { hash } = await seedToken(getAdminDb(), uid);
    return { uid, tokenHash: hash, db: await getUserDb(uid) };
  }

  it('60 peticiones por ventana pasan; la 61 da 429 con Retry-After; la siguiente ventana reinicia', async () => {
    const id = await identity();
    const t0 = 10 * RATE_WINDOW_MS + 5_000; // 5 s dentro de una ventana
    for (let i = 0; i < RATE_LIMIT; i++) await consumeRate(id.db, id, t0 + i);
    await expect(consumeRate(id.db, id, t0 + 100)).rejects.toMatchObject({
      status: 429,
      retryAfter: 55, // quedan 55 s de ventana
    });
    await expect(consumeRate(id.db, id, t0 + 200)).rejects.toMatchObject({ status: 429 });
    await consumeRate(id.db, id, 11 * RATE_WINDOW_MS);
    const doc = (await getAdminDb().collection('rateLimits').doc(id.tokenHash).get()).data();
    expect(doc).toEqual({ uid: id.uid, window: 11, count: 1 });
  });

  it('cada token tiene su propio contador', async () => {
    const [a, b] = [await identity(), await identity()];
    for (let i = 0; i < RATE_LIMIT; i++) await consumeRate(a.db, a, 1_000 + i);
    await expect(consumeRate(a.db, a, 2_000)).rejects.toMatchObject({ status: 429 });
    await expect(consumeRate(b.db, b, 2_000)).resolves.toBeUndefined();
  });

  it('recordAudit guarda {uid, tokenHash, tool, projectId, ok, at, expireAt} y la lee solo su dueño', async () => {
    const id = await identity();
    await recordAudit(id.db, id, { tool: 'read_board', projectId: 'p1', ok: true }, 1_700_000_000_000);
    await recordAudit(id.db, id, { tool: 'list_projects', ok: false }, 1_700_000_000_001);
    const snap = await getAdminDb().collection('mcpAudit').where('tokenHash', '==', id.tokenHash).get();
    const rows = snap.docs.map((d) => d.data()).sort((a, b) => a.at - b.at);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ uid: id.uid, tool: 'read_board', projectId: 'p1', ok: true });
    expect(rows[0].expireAt.toMillis()).toBe(1_700_000_000_000 + 30 * 86_400_000);
    expect(rows[1]).toMatchObject({ tool: 'list_projects', ok: false });
    expect('projectId' in rows[1]).toBe(false);
  });

  it('la auditoría con un token ajeno la rechazan las reglas y no rompe la llamada', async () => {
    const owner = await identity();
    const other = await identity();
    // `other` intenta anotar con el hash del token de `owner`: denegado, solo se registra en el log.
    await expect(
      recordAudit(other.db, { uid: other.uid, tokenHash: owner.tokenHash }, { tool: 'read_note', ok: true }),
    ).resolves.toBeUndefined();
    const snap = await getAdminDb().collection('mcpAudit').where('tokenHash', '==', owner.tokenHash).get();
    expect(snap.empty).toBe(true);
  });
});
