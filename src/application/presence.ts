import type { Presence } from './ports';

export const CURSOR_THROTTLE_MS = 80;

/**
 * Una persona puede tener varias sesiones (pestañas) en la sala: `presence/…/{uid}/{sessionId}`. Se agrupan por
 * uid para que cuente una sola vez (un avatar, un cursor): nombre y color de la sesión más reciente y el cursor de
 * la más reciente que lo haya movido. `exclude` es el uid propio (sus otras pestañas tampoco son «otra persona»).
 */
export function groupSessions(
  room: Record<string, Record<string, Partial<Record<keyof Presence, unknown>> | null> | null> | null,
  exclude?: string,
): Presence[] {
  const out: Presence[] = [];
  for (const [uid, sessions] of Object.entries(room ?? {})) {
    if (uid === exclude || !sessions || typeof sessions !== 'object') continue;
    const list = Object.values(sessions)
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({
        name: String(v!.name ?? ''),
        color: String(v!.color ?? '#4b5563'),
        x: typeof v!.x === 'number' ? v!.x : undefined,
        y: typeof v!.y === 'number' ? v!.y : undefined,
        at: Number(v!.at) || 0,
      }))
      .sort((a, b) => b.at - a.at);
    const last = list[0];
    if (!last) continue;
    const moved = list.find((v) => v.x !== undefined && v.y !== undefined);
    out.push({ uid, name: last.name, color: last.color, x: moved?.x, y: moved?.y, at: last.at });
  }
  return out;
}

/**
 * Limita los envíos del cursor: el primero sale al instante y, mientras dura la ventana, solo se guarda el último,
 * que sale al cerrarse. `cancel` descarta el pendiente (al salir de la sala).
 */
export function throttleCursor(send: (x: number, y: number) => void, ms = CURSOR_THROTTLE_MS) {
  let last = -Infinity;
  let pending: [number, number] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const [x, y] = pending;
    pending = null;
    last = Date.now();
    send(x, y);
  };
  return {
    push(x: number, y: number) {
      pending = [x, y];
      if (timer) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    cancel() {
      pending = null;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
