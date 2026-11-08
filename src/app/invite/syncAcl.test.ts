import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const publish = vi.fn();
let emit: (access: { members: Record<string, string>; aclRev: number }) => void = () => undefined;
const off = vi.fn();
vi.mock('../services', () => ({
  inviteRepo: { aclSnapshot: async () => ({ version: 1, members: {}, invites: {} }) },
  presenceAcl: { publish: (...a: unknown[]) => publish(...a) },
  projectRepo: {
    watchAccess: (_id: string, cb: typeof emit) => {
      emit = cb;
      return off;
    },
  },
}));
const { keepAclSynced, syncAclWithRetry } = await import('./syncAcl');

describe('syncAclWithRetry (D43)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    publish.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reintenta tras un fallo y devuelve true al publicar', async () => {
    publish.mockRejectedValueOnce(new Error('lento')).mockResolvedValue('ok');
    const p = syncAclWithRetry('p', 'o', () => true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('si falla del todo devuelve false sin lanzar', async () => {
    publish.mockRejectedValue(new Error('caído'));
    const p = syncAclWithRetry('p', 'o', () => true);
    await vi.advanceTimersByTimeAsync(5_000 + 30_000 + 120_000);
    expect(await p).toBe(false);
    expect(publish).toHaveBeenCalledTimes(4);
  });
});

describe('keepAclSynced (D47)', () => {
  beforeEach(() => {
    publish.mockReset();
  });

  it('un cambio de acceso dispara una publicación y dejar de vigilar cierra la suscripción', async () => {
    publish.mockResolvedValue('ok');
    const stop = keepAclSynced('p', 'o', () => true);
    emit({ members: { g: 'editor' }, aclRev: 1 });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    stop();
    expect(off).toHaveBeenCalled();
  });

  it('dos cambios seguidos no solapan: el segundo espera y se publica al terminar el primero', async () => {
    let release: () => void = () => undefined;
    let active = 0;
    let maxActive = 0;
    publish.mockImplementation(async () => {
      maxActive = Math.max(maxActive, ++active);
      await new Promise<void>((r) => (release = r));
      active--;
    });
    keepAclSynced('p', 'o', () => true);
    emit({ members: { a: 'viewer' }, aclRev: 1 });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    emit({ members: { a: 'viewer', b: 'editor' }, aclRev: 2 });
    emit({ members: { a: 'viewer', b: 'viewer' }, aclRev: 3 }); // varios pendientes se funden en una repetición
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    release();
    await vi.waitFor(() => expect(active).toBe(0));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });
});
