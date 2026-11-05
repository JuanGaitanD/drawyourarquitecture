import type { ContentMerger, ContentRepo } from './ports';

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
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEBOUNCE_MS = 800;
/** Un borrador por cola (pestaña): dos pestañas del mismo proyecto no se pisan. */
export const draftKey = (id: string, sessionId: string) => `draft:${id}:${sessionId}`;

function defaultStorage(): DraftStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // acceso denegado (modo privado estricto)
  }
}

export function readDraft(key: string, storage: DraftStorage | null = defaultStorage()): Draft | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return typeof d.data === 'string' && typeof d.at === 'number' && typeof d.revision === 'number'
      ? (d as Draft)
      : null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string, storage: DraftStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(key);
  } catch {
    /* sin almacenamiento: nada que borrar */
  }
}

export interface StoredDraft extends Draft {
  key: string;
  /** La base del borrador no es la revisión guardada: otra pestaña guardó entre medias. */
  stale: boolean;
}

/**
 * Borradores de cualquier sesión de `id` cuyo contenido difiere del servidor, el más reciente primero.
 * No se descartan por fecha (el servidor puede ser más nuevo que el borrador de una pestaña en conflicto);
 * los idénticos al servidor ya no sirven y se borran.
 */
export function recoverableDrafts(
  id: string,
  record: { data: string; revision: number } | null,
  storage: DraftStorage | null = defaultStorage(),
): StoredDraft[] {
  if (!storage || !record) return [];
  const prefix = `draft:${id}:`;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
  } catch {
    return [];
  }
  const out: StoredDraft[] = [];
  for (const key of keys) {
    const d = readDraft(key, storage);
    if (!d) continue;
    if (d.data === record.data) clearDraft(key, storage);
    else out.push({ ...d, key, stale: d.revision !== record.revision });
  }
  return out.sort((x, y) => y.at - x.at);
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
  /** Identifica el borrador de esta cola; por defecto uno aleatorio por instancia. */
  sessionId?: string;
  /**
   * Si se pasa, un guardado con la revisión desfasada se fusiona contra el remoto en la transacción en vez de
   * dar conflicto (colaboración en tiempo real). Sin él, el desfase es `conflicto` como antes.
   */
  merge?: ContentMerger;
  /** Tras cada guardado correcto. `merged` viene si el servidor tenía algo más y se escribió la fusión. */
  onSaved?: (r: { data: string; revision: number; merged?: string }) => void;
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
  readonly sessionId: string;
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
  const sessionId = opts.sessionId ?? Math.random().toString(36).slice(2, 10);
  const myDraft = draftKey(id, sessionId);
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
      storage?.setItem(myDraft, JSON.stringify({ data, at: now(), revision } satisfies Draft));
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
            const res = await repo.save(id, data, revision, opts.merge);
            if ('conflict' in res) {
              setState({ status: 'conflicto' });
              return;
            }
            revision = res.revision;
            lastSaved = data;
            opts.onSaved?.({ data, revision, merged: res.merged });
            if (latest === data) clearDraft(myDraft, storage);
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
        clearDraft(myDraft, storage);
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
    sessionId,
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
