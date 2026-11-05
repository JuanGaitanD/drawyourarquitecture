const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' });

/**
 * «hace 5 minutos», «ayer», «hace 3 semanas». Menos de 45 s es «ahora»; una fecha futura
 * (reloj desajustado) se trata como ahora. `ts` no finito devuelve cadena vacía.
 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts)) return '';
  const diff = Math.max(0, now - ts);
  if (diff < 45 * SECOND) return rtf.format(0, 'second');
  if (diff < HOUR) return rtf.format(-Math.max(1, Math.round(diff / MINUTE)), 'minute');
  if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), 'hour');
  const days = Math.floor(diff / DAY);
  if (days < 7) return rtf.format(-days, 'day');
  if (days < 30) return rtf.format(-Math.floor(days / 7), 'week');
  if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
  return rtf.format(-Math.floor(days / 365), 'year');
}

/** Fecha completa para el atributo `title` y `<time dateTime>`. */
export function formatAbsolute(ts: number): string {
  return Number.isFinite(ts) ? absolute.format(ts) : '';
}
