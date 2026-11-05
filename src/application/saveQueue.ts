import type { ContentRepo } from './ports';

// Autosave sin React (plan · invariante 2). Una sola escritura en vuelo, la última gana;
// transacción con revisión esperada; borrador local en cada cambio.

export type SaveStatus = 'guardando' | 'guardado' | 'sin conexión' | 'conflicto' | 'error';
export interface SaveState {
  status: SaveStatus;
  error?: Error;
}

export interface Draft {
  data: string;
  at: number;
  revision: number;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEBOUNCE_MS = 800;
export const draftKey = (id: string) => `draft:${id}`;

function defaultStorage(): DraftStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // acceso denegado (modo privado estricto)
  }
}

export function readDraft(id: string, storage: DraftStorage | null = defaultStorage()): Draft | null {
  try {
    const raw = storage?.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return typeof d.data === 'string' && typeof d.at === 'number' && typeof d.revision === 'number'
      ? (d as Draft)
      : null;
  } catch {
    return null;
  }
}

export function clearDraft(id: string, storage: DraftStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(draftKey(id));
  } catch {
    /* sin almacenamiento: nada que borrar */
  }
}

/** El borrador solo se ofrece si es más reciente que lo guardado en el servidor. */
export function recoverableDraft(
  id: string,
  record: { data: string; updatedAt: number } | null,
  storage: DraftStorage | null = defaultStorage(),
): Draft | null {
  const d = readDraft(id, storage);
  if (!d || !record) return null;
  return d.at > record.updatedAt && d.data !== record.data ? d : null;
}

/**
 * Pasa a la cola lo que el editor aún retiene en su throttle (`drain` devuelve el contenido codificado más
 * reciente, o `null` si no hay nada pendiente) y la escribe ya. `push` deja el borrador local de forma
 * síncrona, así que sirve también en `pagehide` o al desmontar, donde no hay tiempo de esperar al debounce
 * ni a un nuevo render de React.
 */
export function drainAndFlush(
  q: Pick<SaveQueue, 'push' | 'flush'>,
  drain?: () => string | null,
): Promise<void> {
  const pending = drain?.();
  if (pending != null) q.push(pending);
  return q.flush();
}

export interface SaveQueueOptions {
  debounceMs?: number;
  storage?: DraftStorage | null;
  now?: () => number;
  isOffline?: () => boolean;
}

export interface SaveQueue {
  /** Encola el texto codificado. Antes de `hydrate` se ignora (gate de hidratación). */
  push(data: string): void;
  /** Escribe ya lo pendiente y espera a que termine. Si hay conflicto no escribe. */
  flush(): Promise<void>;
  onStatus(cb: (s: SaveState) => void): () => void;
  /** Abre el gate tras cargar con éxito: `lastSaved` es lo que hay en el servidor. */
  hydrate(revision: number, lastSaved: string): void;
  readonly hydrated: boolean;
  readonly revision: number;
  readonly state: SaveState;
  hasPending(): boolean;
  /** Cancela el debounce y deja de escribir (al desmontar, tras `flush`). */
  dispose(): void;
}

/**
 * `initialRevision = null` significa «aún sin hidratar»: se puede crear la cola antes de cargar
 * y no escribirá nada hasta `hydrate()`.
 */
export function createSaveQueue(
  repo: ContentRepo,
  id: string,
  initialRevision: number | null,
  opts: SaveQueueOptions = {},
): SaveQueue {
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? Date.now;
  const isOffline = opts.isOffline ?? (() => typeof navigator !== 'undefined' && navigator.onLine === false);

  let revision = initialRevision ?? 0;
  let hydrated = initialRevision !== null;
  let lastSaved: string | null = null;
  let latest: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;
  let state: SaveState = { status: 'guardado' };
  const listeners = new Set<(s: SaveState) => void>();

  const setState = (s: SaveState) => {
    state = s;
    listeners.forEach((cb) => cb(s));
  };
  const dirty = () => latest !== null && latest !== lastSaved;

  function writeDraft(data: string) {
    try {
      storage?.setItem(draftKey(id), JSON.stringify({ data, at: now(), revision } satisfies Draft));
    } catch {
      /* cuota llena o sin almacenamiento: seguimos sin borrador */
    }
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function run(): Promise<void> {
    if (inFlight) return inFlight; // el bucle de abajo reintenta con lo más reciente al terminar
    if (!hydrated || disposed || state.status === 'conflicto' || !dirty()) return Promise.resolve();
    inFlight = (async () => {
      try {
        while (dirty() && !disposed && state.status !== 'conflicto') {
          const data = latest as string;
          setState({ status: 'guardando' });
          try {
            const res = await repo.save(id, data, revision);
            if ('conflict' in res) {
              setState({ status: 'conflicto' });
              return;
            }
            revision = res.revision;
            lastSaved = data;
            if (latest === data) clearDraft(id, storage);
            setState({ status: 'guardado' });
          } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            setState({ status: isOffline() ? 'sin conexión' : 'error', error });
            return; // se reintenta con flush() (online, botón «Reintentar») o con el siguiente cambio
          }
        }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    push(data) {
      if (!hydrated || disposed) return;
      latest = data;
      if (data === lastSaved) {
        clearTimer();
        clearDraft(id, storage);
        if (state.status === 'error') setState({ status: 'guardado' });
        return;
      }
      writeDraft(data);
      clearTimer();
      timer = setTimeout(() => void run(), debounceMs);
    },
    async flush() {
      clearTimer();
      if (inFlight) await inFlight;
      await run();
    },
    onStatus(cb) {
      listeners.add(cb);
      cb(state);
      return () => listeners.delete(cb);
    },
    hydrate(rev, saved) {
      revision = rev;
      lastSaved = saved;
      hydrated = true;
    },
    get hydrated() {
      return hydrated;
    },
    get revision() {
      return revision;
    },
    get state() {
      return state;
    },
    hasPending: () => dirty(),
    dispose() {
      clearTimer();
      disposed = true;
    },
  };
}
