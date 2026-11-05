import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const publish = vi.fn();
vi.mock('../services', () => ({
  inviteRepo: { aclSnapshot: async () => ({ version: 1, members: {}, invites: {} }) },
  presenceAcl: { publish: (...a: unknown[]) => publish(...a) },
}));
const { syncAclWithRetry } = await import('./syncAcl');

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
