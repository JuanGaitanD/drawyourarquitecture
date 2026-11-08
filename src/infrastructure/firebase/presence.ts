import type { PresenceAcl, PresenceRepo, PresenceRoom } from '@/application/ports';
import { groupSessions } from '@/application/presence';
import { loadDatabase, type DatabaseModule } from './database';

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

type GuestEntry = { role?: unknown; token?: unknown };

/**
 * Espejo de acceso (ver `database.rules.json`). Lo publica el dueño entero y versionado: `{ version, members, invites }`
 * con la `aclRev` del proyecto. Una instantánea anterior a la publicada se descarta; publicar reemplaza todo, así que
 * lo que ya no está en Firestore desaparece, salvo las altas de invitados de la misma versión con invitación vigente
 * (D40: entraron entre la lectura de Firestore y la publicación; unirse no sube `aclRev`). Los errores se propagan
 * (el llamador reintenta o avisa).
 */
export function createPresenceAcl(load: () => Promise<DatabaseModule | null>): PresenceAcl {
  return {
    async publish(room, snap) {
      const mod = await load();
      if (!mod) return 'off';
      const base = {
        version: snap.version,
        members: Object.fromEntries(Object.entries(snap.members).map(([uid, role]) => [uid, { role }])),
        invites: snap.invites,
      };
      // Transacción: compara con lo publicado y aborta si es más nuevo; las reglas lo imponen también en el servidor.
      const r = await mod.rtdb.runTransaction(
        mod.rtdb.ref(mod.db, aclPath(room)),
        (cur: { version?: unknown; members?: Record<string, GuestEntry> } | null) => {
          if (typeof cur?.version === 'number' && cur.version > snap.version) return undefined;
          // D40: un invitado que se registró después de leer Firestore no está en `snap`. Con la misma versión nadie
          // fue quitado (quitar o revocar sube `aclRev`), así que se conserva si su invitación sigue vigente.
          const members: Record<string, unknown> = { ...base.members };
          if (cur?.version === snap.version)
            for (const [uid, g] of Object.entries(cur.members ?? {})) {
              const inv = typeof g?.token === 'string' ? snap.invites[g.token] : undefined;
              if (!(uid in members) && inv && inv.role === g.role) members[uid] = g; // con su token, por si llega otra publicación igual
            }
          return { ...base, members };
        },
      );
      return r.committed ? 'ok' : 'stale';
    },

    async joinWithInvite(room, uid, role, token) {
      const mod = await load();
      if (!mod) return;
      await mod.rtdb.set(mod.rtdb.ref(mod.db, `${aclPath(room)}/members/${uid}`), { role, token });
    },
  };
}

export const presenceAcl: PresenceAcl = createPresenceAcl(loadDatabase);
