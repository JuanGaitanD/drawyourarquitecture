import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupSessions, throttleCursor } from './presence';
import { presenceColor } from './ports';

describe('color de presencia', () => {
  it('es estable por persona', () => {
    expect(presenceColor('uid-1')).toBe(presenceColor('uid-1'));
    expect(presenceColor('uid-1')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('throttleCursor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('envía el primero al instante y agrupa el resto en el último de cada ventana de 80 ms', () => {
    const send = vi.fn();
    const t = throttleCursor(send, 80);
    t.push(1, 1);
    expect(send).toHaveBeenCalledTimes(1);
    t.push(2, 2);
    t.push(3, 3);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(80);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(3, 3);
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('un movimiento tras un descanso sale al instante y cancel descarta el pendiente', () => {
    const send = vi.fn();
    const t = throttleCursor(send, 80);
    t.push(1, 1);
    vi.advanceTimersByTime(200);
    t.push(2, 2);
    expect(send).toHaveBeenCalledTimes(2);
    t.push(3, 3);
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('groupSessions (D25)', () => {
  const node = (at: number, extra: Record<string, unknown> = {}) => ({ name: 'Ana', color: '#2563eb', at, ...extra });

  it('dos pestañas de la misma persona cuentan una vez, con el cursor de la que lo movió', () => {
    const list = groupSessions({
      ana: { a: node(5, { x: 1, y: 2 }), b: node(9) },
      luis: { c: node(1, { name: 'Luis' }) },
    });
    expect(list).toEqual([
      { uid: 'ana', name: 'Ana', color: '#2563eb', x: 1, y: 2, at: 9 },
      { uid: 'luis', name: 'Luis', color: '#2563eb', x: undefined, y: undefined, at: 1 },
    ]);
  });

  it('excluye al propio uid (sus otras pestañas no son otra persona) y tolera una sala vacía o con datos viejos', () => {
    expect(groupSessions({ yo: { a: node(1) }, ana: { a: node(1) } }, 'yo').map((p) => p.uid)).toEqual(['ana']);
    expect(groupSessions(null)).toEqual([]);
    expect(groupSessions({ ana: { a: null }, luis: 'basura' as never })).toEqual([]);
  });
});
