// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

/** `matchMedia` de mentira con una sola consulta cuyo resultado se puede cambiar. */
function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((l) => l());
    },
    listeners,
  };
}

describe('useMediaQuery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refleja la consulta y se actualiza cuando cambia', () => {
    const mq = fakeMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 1100px)'));
    expect(result.current).toBe(false);
    act(() => mq.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(mq.listeners.size).toBe(0);
  });

  it('sin matchMedia devuelve false', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery('(max-width: 1100px)'));
    expect(result.current).toBe(false);
  });
});
