import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttleCursor } from './presence';
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
