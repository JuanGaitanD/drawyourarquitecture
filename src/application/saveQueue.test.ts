import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentRepo } from './ports';
import {
  DEBOUNCE_MS,
  createSaveQueue,
  drainAndFlush,
  draftKey,
  readDraft,
  recoverableDrafts,
  type DraftStorage,
} from './saveQueue';

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Repo falso con revisión en memoria; `hold` retiene la respuesta para probar la cola. */
function fakeRepo(serverRevision = 0) {
  let rev = serverRevision;
  const calls: { data: string; expected: number }[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  let failNext: Error | null = null;
  const repo: ContentRepo = {
    load: async () => null,
    async save(_id, data, expected) {
      calls.push({ data, expected });
      if (hold) await new Promise<void>((r) => (release = r));
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      if (expected !== rev) return { conflict: true };
      rev += 1;
      return { revision: rev };
    },
  };
  return {
    repo,
    calls,
    hold: () => (hold = true),
    release: () => {
      hold = false;
      release?.();
    },
    failNext: (e: Error) => (failNext = e),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('saveQueue · gate de hidratación', () => {
  it('no escribe ni deja borrador mientras no se ha hidratado', async () => {
    const f = fakeRepo();
    const storage = memoryStorage();
    const q = createSaveQueue(f.repo, 'p1', null, { storage });
    q.push('{"a":1}');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3);
    await q.flush();
    expect(f.calls).toHaveLength(0);
    expect(storage.map.size).toBe(0);
    expect(q.hydrated).toBe(false);
  });

  it('tras hidratar escribe, pero lo igual a lo guardado no genera escritura', async () => {
    const f = fakeRepo(3);
    const q = createSaveQueue(f.repo, 'p1', null, { storage: memoryStorage() });
    q.hydrate(3, '{"v":0}');
    q.push('{"v":0}');
    await q.flush();
    expect(f.calls).toHaveLength(0);
    q.push('{"v":1}');
    await q.flush();
    expect(f.calls).toEqual([{ data: '{"v":1}', expected: 3 }]);
    expect(q.revision).toBe(4);
  });
});

describe('saveQueue · cola serial', () => {
  it('agrupa con debounce: varios cambios seguidos, una escritura con el último', async () => {
    const f = fakeRepo();
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage() });
    q.push('1');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
    q.push('2');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
    expect(f.calls).toHaveLength(0);
    q.push('3');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(f.calls).toEqual([{ data: '3', expected: 0 }]);
  });

  it('una sola escritura en vuelo; la última gana y usa la revisión nueva', async () => {
    const f = fakeRepo();
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage() });
    f.hold();
    q.push('a');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(f.calls).toHaveLength(1);
    q.push('b');
    q.push('c');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(f.calls).toHaveLength(1); // 'b' y 'c' esperan: nunca dos a la vez
    f.release();
    await vi.advanceTimersByTimeAsync(0);
    await q.flush();
    expect(f.calls.map((c) => [c.data, c.expected])).toEqual([
      ['a', 0],
      ['c', 1],
    ]);
    expect(q.state.status).toBe('guardado');
  });

  it('flush escribe sin esperar al debounce', async () => {
    const f = fakeRepo();
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage() });
    q.push('x');
    await q.flush();
    expect(f.calls).toHaveLength(1);
    expect(q.hasPending()).toBe(false);
  });

  it('un fallo sin conexión deja «sin conexión» y flush reintenta', async () => {
    const f = fakeRepo();
    let offline = true;
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage(), isOffline: () => offline });
    f.failNext(new Error('network'));
    q.push('x');
    await q.flush();
    expect(q.state.status).toBe('sin conexión');
    offline = false;
    await q.flush();
    expect(q.state.status).toBe('guardado');
    expect(f.calls).toHaveLength(2);
  });

  it('un fallo con conexión deja «error» con la causa', async () => {
    const f = fakeRepo();
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage(), isOffline: () => false });
    f.failNext(new Error('permission-denied'));
    q.push('x');
    await q.flush();
    expect(q.state.status).toBe('error');
    expect(q.state.error?.message).toBe('permission-denied');
  });

  it('emite los estados guardando → guardado', async () => {
    const f = fakeRepo();
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage() });
    const seen: string[] = [];
    q.onStatus((s) => seen.push(s.status));
    q.push('x');
    await q.flush();
    expect(seen).toEqual(['guardado', 'guardando', 'guardado']);
  });
});

describe('saveQueue · conflicto de revisión', () => {
  it('si otra pestaña guardó, pasa a «conflicto» y deja de escribir', async () => {
    const f = fakeRepo(5);
    const q = createSaveQueue(f.repo, 'p1', 4, { storage: memoryStorage() }); // el servidor ya va por la 5
    q.push('mío');
    await q.flush();
    expect(q.state.status).toBe('conflicto');
    const n = f.calls.length;
    q.push('otro');
    await q.flush();
    expect(f.calls).toHaveLength(n); // no vuelve a intentarlo
  });

  it('conserva el borrador local al haber conflicto', async () => {
    const f = fakeRepo(5);
    const storage = memoryStorage();
    const q = createSaveQueue(f.repo, 'p1', 4, { storage });
    q.push('mío');
    await q.flush();
    expect(readDraft(draftKey('p1', q.sessionId), storage)?.data).toBe('mío');
  });
});

describe('saveQueue · borrador local', () => {
  it('escribe el borrador en cada cambio y lo borra al confirmar', async () => {
    const f = fakeRepo();
    const storage = memoryStorage();
    const q = createSaveQueue(f.repo, 'p1', 0, { storage, now: () => 1234 });
    q.push('x');
    expect(JSON.parse(storage.map.get(draftKey('p1', q.sessionId))!)).toEqual({
      data: 'x',
      at: 1234,
      revision: 0,
    });
    await q.flush();
    expect(storage.map.has(draftKey('p1', q.sessionId))).toBe(false);
  });

  it('si falla el guardado el borrador sigue ahí', async () => {
    const f = fakeRepo();
    const storage = memoryStorage();
    const q = createSaveQueue(f.repo, 'p1', 0, { storage, isOffline: () => true });
    f.failNext(new Error('x'));
    q.push('y');
    await q.flush();
    expect(readDraft(draftKey('p1', q.sessionId), storage)?.data).toBe('y');
  });

  it('ofrece los borradores distintos de lo guardado, sin descartarlos por fecha', () => {
    const storage = memoryStorage();
    storage.setItem(draftKey('p1', 'a'), JSON.stringify({ data: 'viejo-A', at: 100, revision: 3 }));
    storage.setItem(draftKey('p1', 'b'), JSON.stringify({ data: 'nuevo-B', at: 300, revision: 4 }));
    storage.setItem(draftKey('p2', 'a'), JSON.stringify({ data: 'otro', at: 300, revision: 0 }));
    const r = recoverableDrafts('p1', { data: 'servidor', revision: 4 }, storage);
    expect(r.map((d) => d.data)).toEqual(['nuevo-B', 'viejo-A']); // el más reciente primero
    expect(r.map((d) => d.stale)).toEqual([false, true]); // base distinta de la revisión guardada
    expect(recoverableDrafts('p1', null, storage)).toEqual([]);
  });

  it('limpia los borradores idénticos al servidor', () => {
    const storage = memoryStorage();
    storage.setItem(draftKey('p1', 'a'), JSON.stringify({ data: 'servidor', at: 100, revision: 3 }));
    expect(recoverableDrafts('p1', { data: 'servidor', revision: 4 }, storage)).toEqual([]);
    expect(storage.map.size).toBe(0);
  });

  it('ignora borradores corruptos', () => {
    const storage = memoryStorage();
    storage.setItem(draftKey('p1', 'a'), '{no es json');
    expect(readDraft(draftKey('p1', 'a'), storage)).toBeNull();
    expect(recoverableDrafts('p1', { data: 'x', revision: 0 }, storage)).toEqual([]);
  });

  it('dos pestañas: guardar en B no borra el borrador pendiente de A, que sigue recuperable tras el conflicto', async () => {
    const f = fakeRepo();
    const storage = memoryStorage();
    const a = createSaveQueue(f.repo, 'p1', 0, { storage, now: () => 100 });
    const b = createSaveQueue(f.repo, 'p1', 0, { storage, now: () => 200 });
    expect(a.sessionId).not.toBe(b.sessionId);
    a.push('cambios de A');
    b.push('cambios de B');
    await b.flush(); // B guarda y borra solo su borrador
    await a.flush(); // A: conflicto
    expect(a.state.status).toBe('conflicto');
    const r = recoverableDrafts('p1', { data: 'cambios de B', revision: 1 }, storage);
    expect(r.map((d) => d.data)).toEqual(['cambios de A']);
  });

  it('un push idéntico a lo guardado solo limpia el borrador propio', () => {
    const storage = memoryStorage();
    storage.setItem(draftKey('p1', 'otra'), JSON.stringify({ data: 'ajeno', at: 1, revision: 0 }));
    const q = createSaveQueue(fakeRepo().repo, 'p1', null, { storage });
    q.hydrate(0, 'base');
    q.push('base');
    expect(storage.map.has(draftKey('p1', 'otra'))).toBe(true);
  });
});

describe('drainAndFlush · el último cambio retenido por el throttle del editor', () => {
  it('lo pasa a la cola, deja el borrador y lo escribe sin esperar al debounce', async () => {
    const f = fakeRepo();
    const storage = memoryStorage();
    const q = createSaveQueue(f.repo, 'p1', null, { storage });
    q.hydrate(0, 'base');
    q.push('visto por la cola');

    await drainAndFlush(q, () => 'retenido por el throttle');

    expect(f.calls.map((c) => c.data)).toEqual(['retenido por el throttle']);
    expect(readDraft(draftKey('p1', q.sessionId), storage)).toBeNull(); // guardado: el borrador se borra
    expect(q.hasPending()).toBe(false);
  });

  it('sin nada retenido solo escribe lo que ya tenía la cola', async () => {
    const f = fakeRepo();
    const q = createSaveQueue(f.repo, 'p1', null, { storage: memoryStorage() });
    q.hydrate(0, 'base');
    q.push('a');
    await drainAndFlush(q, () => null);
    await drainAndFlush(q);
    expect(f.calls.map((c) => c.data)).toEqual(['a']);
  });

  it('antes de hidratar no escribe nada (gate)', async () => {
    const f = fakeRepo();
    const storage = memoryStorage();
    const q = createSaveQueue(f.repo, 'p1', null, { storage });
    await drainAndFlush(q, () => 'x');
    expect(f.calls).toEqual([]);
    expect(storage.map.size).toBe(0);
  });
});
