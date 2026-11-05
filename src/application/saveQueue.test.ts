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
  let remoteData = '';
  const repo: ContentRepo = {
    load: async () => null,
    subscribe: () => () => undefined,
    async save(_id, data, expected, merge) {
      calls.push({ data, expected });
      if (hold) await new Promise<void>((r) => (release = r));
      if (failNext) {
        const e = failNext;
        failNext = null;
        throw e;
      }
      if (expected !== rev) {
        if (!merge) return { conflict: true };
        rev += 1;
        const merged = merge(data, remoteData);
        remoteData = merged;
        return merged === data ? { revision: rev } : { revision: rev, merged };
      }
      rev += 1;
      remoteData = data;
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
    /** Simula que otro cliente guardó: sube la revisión y deja su contenido. */
    remoteSave: (data: string) => {
      rev += 1;
      remoteData = data;
    },
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

describe('saveQueue · fusión con el remoto', () => {
  const merge = (local: string, remote: string) => (local === remote ? local : `${remote}+${local}`);

  it('con merge, un desfase de revisión no da conflicto: escribe la fusión y sigue guardando', async () => {
    const f = fakeRepo(0);
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage(), merge });
    f.remoteSave('R');
    q.push('L1');
    await q.flush();
    expect(q.state.status).toBe('guardado');
    // lo escrito fue una fusión con algo ajeno: la revisión esperada no sube
    expect(q.revision).toBe(0);
    // la cola ya no está sucia: no reescribe lo que ya mandó
    await q.flush();
    expect(f.calls).toHaveLength(1);
    q.push('L2');
    await q.flush();
    expect(f.calls[1]).toEqual({ data: 'L2', expected: 0 });
    expect(q.state.status).toBe('guardado');
  });

  it('un pendiente encolado durante una fusión no pisa lo ajeno recién confirmado', async () => {
    // Servidor con la lógica del adaptador: con la revisión esperada escribe tal cual; si no, fusiona.
    let rev = 0;
    let remote = 'A0|B0';
    const calls: { data: string; expected: number }[] = [];
    let release = (): void => undefined;
    const repo: ContentRepo = {
      load: async () => null,
      subscribe: () => () => undefined,
      async save(_id, data, expected, mergeFn) {
        calls.push({ data, expected });
        if (calls.length === 1) await new Promise<void>((r) => (release = r));
        let out = data;
        if (expected !== rev) out = mergeFn!(data, remote);
        rev += 1;
        remote = out;
        return out === data ? { revision: rev } : { revision: rev, merged: out };
      },
    };
    // A y B son campos independientes: gana el valor más alto de cada uno.
    const fields = (s: string) => s.split('|').map((x) => Number(x.slice(1)));
    const join = (a: number, b: number) => `A${a}|B${b}`;
    const mergeAB = (l: string, r: string) => {
      const [la, lb] = fields(l);
      const [ra, rb] = fields(r);
      return join(Math.max(la!, ra!), Math.max(lb!, rb!));
    };
    const q = createSaveQueue(repo, 'p1', 0, { storage: memoryStorage(), merge: mergeAB });
    q.push('A1|B0');
    const first = q.flush(); // A1/B0 en vuelo
    await vi.advanceTimersByTimeAsync(0);
    rev = 1; // otro cliente guardó B1 mientras tanto
    remote = 'A0|B1';
    q.push('A2|B0'); // pendiente anterior a lo ajeno
    release();
    await first;
    await q.flush();
    expect(remote).toBe('A2|B1');
  });

  it('sin merge el mismo desfase sigue siendo conflicto', async () => {
    const f = fakeRepo(0);
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage() });
    f.remoteSave('R');
    q.push('L1');
    await q.flush();
    expect(q.state.status).toBe('conflicto');
  });
});

describe('saveQueue · dos clientes sin ping-pong', () => {
  type Rec = Parameters<Parameters<ContentRepo['subscribe']>[1]>[0];
  const parse = (d: string) => JSON.parse(d) as string[];
  const union = (a: string, b: string) => JSON.stringify([...new Set([...parse(a), ...parse(b)])].sort());

  /** Servidor compartido: cada escritura se notifica a todos los suscriptores, también al que escribió. */
  function server() {
    let rev = 0;
    let data = '[]';
    let writes = 0;
    const subs = new Set<(r: Rec) => void>();
    const repo: ContentRepo = {
      load: async () => null,
      subscribe: (_id, cb) => (subs.add(cb), () => subs.delete(cb)),
      async save(_id, d, expected, merge) {
        let out = d;
        if (expected !== rev) {
          if (!merge) return { conflict: true };
          out = merge(d, data);
        }
        rev += 1;
        writes += 1;
        data = out;
        subs.forEach((cb) => cb({ data: out, schemaVersion: 1, revision: rev, updatedAt: 0 }));
        return out === d ? { revision: rev } : { revision: rev, merged: out };
      },
    };
    return { repo, writes: () => writes, data: () => data };
  }

  /** Un editor mínimo: estado local (conjunto), cola con fusión y la misma lógica de eco que los editores reales. */
  function client(srv: ReturnType<typeof server>) {
    const local = new Set<string>();
    const enc = () => JSON.stringify([...local].sort());
    let seen = 0;
    const q = createSaveQueue(srv.repo, 'p', 0, {
      storage: memoryStorage(),
      merge: union,
      onSaved: (r) => {
        if (r.merged === undefined && r.revision > seen) seen = r.revision;
      },
    });
    q.hydrate(0, '[]');
    srv.repo.subscribe('p', (r) => {
      if (r.revision <= seen) return; // el snapshot propio ya se vio
      seen = r.revision;
      parse(r.data).forEach((x) => local.add(x));
      q.acceptRemote(r.data);
      q.push(enc()); // el editor re-emite tras aplicar el remoto
    });
    return { add: (x: string) => (local.add(x), q.push(enc())), local, q };
  }

  it('ediciones simultáneas convergen y, al asentarse, nadie vuelve a escribir', async () => {
    const srv = server();
    const a = client(srv);
    const b = client(srv);
    a.add('a');
    b.add('b');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 4);
    expect([...a.local].sort()).toEqual(['a', 'b']);
    expect([...b.local].sort()).toEqual(['a', 'b']);
    expect(srv.data()).toBe('["a","b"]');
    const writes = srv.writes();
    expect(writes).toBeLessThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(srv.writes()).toBe(writes);
  });

  it('muchas ediciones alternas no multiplican las escrituras', async () => {
    const srv = server();
    const a = client(srv);
    const b = client(srv);
    for (let i = 0; i < 5; i++) {
      a.add(`a${i}`);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
      b.add(`b${i}`);
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50);
    }
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 4);
    expect(parse(srv.data())).toHaveLength(10);
    // una escritura por edición como mucho (10), nunca más por eco
    expect(srv.writes()).toBeLessThanOrEqual(10);
    expect(a.q.state.status).toBe('guardado');
    expect(b.q.state.status).toBe('guardado');
  });
});

describe('saveQueue · primer cambio rápido (colaboración)', () => {
  it('tras un descanso el primer cambio sale a fastFirstMs y una ráfaga sigue agrupándose', async () => {
    const f = fakeRepo(0);
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage(), fastFirstMs: 100 });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 1);
    q.push('1');
    await vi.advanceTimersByTimeAsync(110);
    expect(f.calls).toHaveLength(1); // salió sin esperar al debounce
    q.push('2'); // justo después de escribir: ráfaga, debounce normal
    await vi.advanceTimersByTimeAsync(110);
    expect(f.calls).toHaveLength(1);
    q.push('3');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(f.calls.map((c) => c.data)).toEqual(['1', '3']);
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

describe('saveQueue · contenido grande (D17)', () => {
  it('envía tal cual 6 MB al repo aunque el borrador local no quepa (cuota de localStorage)', async () => {
    const f = fakeRepo();
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new DOMException('cuota', 'QuotaExceededError');
    };
    const big = JSON.stringify({ t: 'x'.repeat(6_000_000) });
    const q = createSaveQueue(f.repo, 'p1', 0, { storage });
    q.push(big);
    await q.flush();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.data).toBe(big);
    expect(q.state.status).toBe('guardado');
    expect(q.revision).toBe(1);
  });

  it('un contenido grande que pasa por la fusión se guarda y deja la cola limpia', async () => {
    const f = fakeRepo(1);
    const q = createSaveQueue(f.repo, 'p1', 0, { storage: memoryStorage(), merge: (l, r) => l + r });
    f.remoteSave('{"ajeno":1}'); // el servidor va por delante: la transacción fusiona
    q.push('y'.repeat(3_000_000));
    await q.flush();
    expect(q.state.status).toBe('guardado');
    expect(q.hasPending()).toBe(false);
  });
});
