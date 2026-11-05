/**
 * Retiene el registro remoto más reciente mientras el lienzo aún no puede aplicarlo (Excalidraw se carga diferido)
 * y lo entrega cuando está listo: sin otra escritura, la nota no se quedaría mostrando una revisión antigua.
 */
export function createRemoteInbox<R extends { revision: number }>() {
  let pending: R | null = null;
  return {
    /** Aplica `r` si `ready`; si no, lo guarda (gana la revisión más alta). */
    push(r: R, ready: boolean, apply: (r: R) => void): void {
      if (ready) apply(r);
      else if (!pending || r.revision > pending.revision) pending = r;
    },
    /** El lienzo ya puede aplicar: entrega lo retenido, si hay algo. */
    flush(apply: (r: R) => void): void {
      const p = pending;
      pending = null;
      if (p) apply(p);
    },
  };
}
