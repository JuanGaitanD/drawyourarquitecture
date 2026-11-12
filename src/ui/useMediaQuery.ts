import { useSyncExternalStore } from 'react';

/** `true` mientras la consulta de medios coincide. Sin `matchMedia` (SSR, pruebas) devuelve `false`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof matchMedia !== 'function') return () => undefined;
      const mq = matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    () => false,
  );
}
