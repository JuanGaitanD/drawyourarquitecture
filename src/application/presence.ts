export const CURSOR_THROTTLE_MS = 80;

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
