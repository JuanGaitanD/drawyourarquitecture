import { useEffect, useState } from 'react';

/** Reloj que se actualiza cada `ms`, para que «hace 5 minutos» no se quede congelado. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
