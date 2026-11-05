import { describe, expect, it } from 'vitest';
import { onlineNow, presenceColor, PRESENCE_TTL_MS } from './ports';

describe('presencia', () => {
  const now = 1_000_000;
  const p = (uid: string, at: number) => ({ uid, name: uid, color: '#000', at });

  it('cuenta como conectado a quien latió hace menos de 2 minutos y excluye a uno mismo', () => {
    const list = [p('yo', now), p('a', now - 1000), p('b', now - PRESENCE_TTL_MS), p('c', now - PRESENCE_TTL_MS - 1)];
    expect(onlineNow(list, now, 'yo').map((x) => x.uid)).toEqual(['a', 'b']);
  });

  it('el color es estable por persona', () => {
    expect(presenceColor('uid-1')).toBe(presenceColor('uid-1'));
    expect(presenceColor('uid-1')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
