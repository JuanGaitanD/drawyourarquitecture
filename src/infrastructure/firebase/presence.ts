import type { PresenceAcl, PresenceRepo, PresenceRoom } from '@/application/ports';
import { groupSessions } from '@/application/presence';
import { loadDatabase } from './database';

const roomPath = (r: PresenceRoom) => `presence/${r.ownerId}/${r.projectId}`;
const aclPath = (r: PresenceRoom) => `acl/${r.ownerId}/${r.projectId}`;

// `randomUUID` solo existe en contextos seguros (https o localhost); el respaldo vale igual para un id de sesión.
const newSessionId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Presencia y cursores: `presence/{ownerId}/{projectId}/{uid}/{sessionId} = { name, color, x?, y?, at }`. Cada
 * pestaña tiene su sesión (`onDisconnect` por sesión: cerrar una no borra a la otra) y la lista las agrupa por uid.
 * El nodo vive mientras haya conexión (`onDisconnect().remove()`, reabierto en cada reconexión): sin latidos.
 */
export const presenceRepo: PresenceRepo = {
  join(room, me, onList, onError) {
    let closed = false;
    const mePath = `${roomPath(room)}/${me.uid}/${newSessionId()}`;
    let cursor: { x: number; y: number } | null = null;
    let teardown: (() => void) | null = null;
    const fail = (e: unknown) => onError?.(e instanceof Error ? e : new Error(String(e)));

    loadDatabase().then((mod) => {
      if (closed || !mod) return;
      const { rtdb, db } = mod;
      const roomRef = rtdb.ref(db, roomPath(room));
      const mine = rtdb.ref(db, mePath);
      const payload = () => ({ name: me.name.slice(0, 80), color: me.color, ...cursor, at: Date.now() });

      const offConnected = rtdb.onValue(rtdb.ref(db, '.info/connected'), (snap) => {
        if (snap.val() !== true) return;
        void rtdb
          .onDisconnect(mine)
          .remove()
          .then(() => rtdb.set(mine, payload()))
          .catch(fail);
      });
      const offList = rtdb.onValue(
        roomRef,
        (snap) => {
          onList(groupSessions(snap.val(), me.uid));
        },
        fail,
      );
      teardown = () => {
        offConnected();
        offList();
        void rtdb.onDisconnect(mine).cancel();
        void rtdb.remove(mine).catch(() => undefined);
      };
    }, fail);

    return {
      move(x, y) {
        cursor = { x, y };
        loadDatabase().then((mod) => {
          if (closed || !mod) return;
          const { rtdb, db } = mod;
          void rtdb
            .set(rtdb.ref(db, mePath), {
              name: me.name.slice(0, 80),
              color: me.color,
              x,
              y,
              at: Date.now(),
            })
            .catch(fail);
        }, fail);
      },
      close() {
        closed = true;
        teardown?.();
      },
    };
  },
};

/** Espejo de acceso (ver `database.rules.json`): mejor esfuerzo, nunca rompe el compartir. */
export const presenceAcl: PresenceAcl = {
  async setInvite(room, token, invite) {
    const mod = await loadDatabase();
    if (!mod) return;
    await mod.rtdb.set(mod.rtdb.ref(mod.db, `${aclPath(room)}/invites/${token}`), invite);
  },

  async setMembers(room, members) {
    const mod = await loadDatabase();
    if (!mod || Object.keys(members).length === 0) return;
    const patch = Object.fromEntries(
      Object.entries(members).map(([uid, role]) => [uid, role ? { role } : null]),
    );
    await mod.rtdb.update(mod.rtdb.ref(mod.db, `${aclPath(room)}/members`), patch);
  },

  async joinWithInvite(room, uid, role, token) {
    const mod = await loadDatabase();
    if (!mod) return;
    await mod.rtdb.set(mod.rtdb.ref(mod.db, `${aclPath(room)}/members/${uid}`), { role, token });
  },
};
