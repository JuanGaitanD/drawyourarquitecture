import { useCallback, useSyncExternalStore } from 'react';
import { presenceColor, type Presence, type PresenceSession } from '@/application/ports';
import { throttleCursor } from '@/application/presence';
import { syncAclWithRetry } from '../invite/syncAcl';
import { identity, presenceRepo, projectRepo } from '../services';

/** Una sala por proyecto, compartida por avatares y capas de cursores (una sola conexión y un solo oyente). */
interface Room {
  refs: number;
  others: Presence[];
  subs: Set<() => void>;
  move: (x: number, y: number) => void;
  close: () => void;
}

const rooms = new Map<string, Room>();
const NONE: Presence[] = [];

function open(projectId: string): Room {
  let session: PresenceSession | null = null;
  let closed = false;
  const throttle = throttleCursor((x, y) => session?.move(x, y));
  const room: Room = {
    refs: 0,
    others: NONE,
    subs: new Set(),
    move: throttle.push,
    close() {
      closed = true;
      throttle.cancel();
      session?.close();
    },
  };

  const me = identity.current();
  if (me) {
    // El dueño del proyecto es parte de la ruta de la sala (las reglas no leen Firestore); el dueño, además,
    // sincroniza el espejo de acceso con Firestore (completo y versionado; reintenta si falla).
    void projectRepo.get(projectId).then(
      (p) => {
        if (closed || !p) return;
        const target = { ownerId: p.ownerId, projectId };
        if (p.ownerId === me.uid) {
          void syncAclWithRetry(projectId, me.uid, () => !closed);
        }
        session = presenceRepo.join(
          target,
          { uid: me.uid, name: me.name, color: presenceColor(me.uid) },
          (others) => {
            room.others = others;
            room.subs.forEach((cb) => cb());
          },
          () => undefined, // sin permiso (enlace público) o sin red: sin presencia
        );
      },
      () => undefined,
    );
  }
  return room;
}

function acquire(projectId: string): Room {
  let room = rooms.get(projectId);
  if (!room) rooms.set(projectId, (room = open(projectId)));
  room.refs++;
  return room;
}

function release(projectId: string, room: Room) {
  if (--room.refs > 0) return;
  room.close();
  if (rooms.get(projectId) === room) rooms.delete(projectId);
}

/** Cuántas personas hay y dónde tienen el cursor (`others`), y `move` para publicar el propio (limitado a 80 ms). */
export function usePresence(projectId: string): { others: Presence[]; move: (x: number, y: number) => void } {
  const others = useSyncExternalStore(
    useCallback(
      (cb) => {
        const room = acquire(projectId);
        room.subs.add(cb);
        return () => {
          room.subs.delete(cb);
          release(projectId, room);
        };
      },
      [projectId],
    ),
    () => rooms.get(projectId)?.others ?? NONE,
  );
  const move = useCallback((x: number, y: number) => rooms.get(projectId)?.move(x, y), [projectId]);
  return { others, move };
}
