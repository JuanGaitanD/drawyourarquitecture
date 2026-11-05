import { useEffect, useState } from 'react';
import { onlineNow, presenceColor, PRESENCE_BEAT_MS, type Presence } from '@/application/ports';
import { identity, presenceRepo } from '../services';
import { useAuth } from './useAuth';

/**
 * Presencia del proyecto: manda un latido al abrir y cada 60 s, y devuelve a las demás personas conectadas
 * (latido de menos de 2 min). Sin cursores: cada escritura cuesta cuota gratuita. Solo miembros y dueño pueden
 * escribir; si las reglas lo deniegan (enlace público), se ignora.
 */
export function usePresence(projectId: string): Presence[] {
  const { user } = useAuth();
  const uid = user?.uid;
  const [list, setList] = useState<Presence[]>([]);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const me = identity.current();
    if (!me) return;
    const beat = () =>
      void presenceRepo
        .beat(projectId, { uid: me.uid, name: me.name, color: presenceColor(me.uid) })
        .catch(() => undefined);
    const leave = () => void presenceRepo.leave(projectId, me.uid).catch(() => undefined);
    beat();
    const t = setInterval(() => {
      beat();
      setNow(Date.now());
    }, PRESENCE_BEAT_MS);
    window.addEventListener('pagehide', leave);
    const off = presenceRepo.subscribe(projectId, setList, () => undefined);
    return () => {
      clearInterval(t);
      window.removeEventListener('pagehide', leave);
      off();
      leave();
    };
  }, [projectId, uid]);

  return onlineNow(list, now, uid);
}
