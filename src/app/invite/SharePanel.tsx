import { Copy, Link2, Trash2, UserMinus, UserX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { MemberJoin } from '@/application/ports';
import type { Invite } from '@/domain/invite';
import type { Role } from '@/domain/project';
import { Button, IconButton, useToast } from '@/ui';
import { identity, inviteRepo, projectRepo } from '../services';
import styles from './SharePanel.module.css';
import { syncAcl, syncAclWithRetry } from './syncAcl';

const ROLE_LABEL: Record<Role, string> = { editor: 'Editor', viewer: 'Solo lectura' };
export const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;
const day = (t: number) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

/** Compartir con personas (solo el dueño): enlaces de invitación con rol y lista de miembros. */
export function SharePanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [role, setRole] = useState<Role>('editor');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<[string, Role][]>([]);
  const [joins, setJoins] = useState<Record<string, MemberJoin>>({});
  const [busy, setBusy] = useState(false);
  // Enlaces ya revocados a los que falta quitar a quienes entraron (la limpieza falló): se reintenta desde aquí.
  const [cleanup, setCleanup] = useState<string[]>([]);
  // El espejo de presencia no se pudo actualizar: quien perdió el acceso aún podría ver cursores hasta reintentarlo.
  const [aclFailed, setAclFailed] = useState(false);
  const uid = identity.current()?.uid ?? '';
  const sync = useCallback(
    () =>
      syncAcl(projectId, uid).then(
        () => setAclFailed(false),
        () => setAclFailed(true),
      ),
    [projectId, uid],
  );
  // Publica el espejo sin bloquear a nadie: reintenta y, si falla del todo, avisa (y deja el «Reintentar» del panel).
  const syncInBackground = useCallback(
    () =>
      syncAclWithRetry(projectId, uid, () => true).then((ok) => {
        setAclFailed(!ok);
        if (!ok)
          toast({
            kind: 'error',
            title: 'No se pudo publicar el acceso a la presencia',
            description: 'El enlace funciona, pero quien entre no verá cursores hasta que se reintente.',
          });
      }),
    [projectId, uid, toast],
  );

  const load = useCallback(
    () =>
      Promise.all([
        projectRepo.get(projectId),
        inviteRepo.listFor(projectId, uid),
        inviteRepo.memberJoins(projectId),
      ]),
    [projectId, uid],
  );
  const apply = useCallback(([p, inv, nm]: Awaited<ReturnType<typeof load>>) => {
    setMembers(Object.entries(p?.members ?? {}));
    setInvites(inv);
    setJoins(nm);
  }, []);
  const refresh = useCallback(
    () => load().then(apply, () => toast({ kind: 'error', title: 'No se pudo cargar quién tiene acceso' })),
    [load, apply, toast],
  );

  useEffect(() => {
    let cancelled = false;
    load().then(
      (r) => {
        if (cancelled) return;
        apply(r);
        // Al abrir el panel se vuelve a publicar el acceso vigente (reintenta lo que hubiera fallado antes).
        void sync();
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [load, apply, sync]);

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      toast({ kind: 'success', title: 'Enlace de invitación copiado' });
    } catch {
      toast({ kind: 'error', title: 'No se pudo copiar', description: inviteUrl(token), duration: 0 });
    }
  };
  const act = async (fn: () => Promise<unknown>, fail: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch {
      toast({ kind: 'error', title: fail });
    } finally {
      setBusy(false);
    }
  };

  // Cierra el enlace y quita a quienes entraron con él. Si la limpieza falla, el enlace ya está cerrado y queda un
  // aviso con «Reintentar» (la operación es idempotente).
  const revokeAndRemove = (token: string) =>
    act(async () => {
      try {
        await inviteRepo.revokeAndRemove(projectId, token);
        setCleanup((c) => c.filter((t) => t !== token));
      } catch (e) {
        setCleanup((c) => (c.includes(token) ? c : [...c, token]));
        void refresh();
        throw e;
      }
      await sync();
    }, 'No se pudo quitar a quienes entraron con el enlace');

  return (
    <div className={styles.panel}>
      <p className={styles.title}>Invitar a personas</p>
      <p className={styles.hint}>
        Quien abra el enlace con su cuenta de Google entra al proyecto. Caduca a los 7 días. Revocar un enlace
        impide nuevos accesos, pero no saca a quienes ya entraron con él: para eso usa «Revocar y quitar».
      </p>
      <div className={styles.row}>
        <select
          className={styles.select}
          aria-label="Rol de la invitación"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          <option value="editor">Puede editar</option>
          <option value="viewer">Solo lectura</option>
        </select>
        <Button
          size="sm"
          variant="primary"
          icon={<Link2 size={14} />}
          loading={busy}
          onClick={() =>
            void act(async () => {
              const inv = await inviteRepo.create(projectId, role, uid);
              // D43: el enlace sale de Firestore al instante; el espejo de presencia se publica aparte, con reintento.
              void syncInBackground();
              await copy(inv.token);
            }, 'No se pudo crear la invitación')
          }
        >
          Crear enlace
        </Button>
      </div>

      {aclFailed ? (
        <p className={styles.hint} role="alert">
          No se pudo actualizar el acceso a la presencia en tiempo real: quien perdió el acceso aún podría ver
          cursores.{' '}
          <Button size="sm" disabled={busy} onClick={() => void act(sync, 'No se pudo reintentar')}>
            Reintentar
          </Button>
        </p>
      ) : null}
      {cleanup.map((token) => (
        <p key={token} className={styles.hint} role="alert">
          Enlace revocado, pero falta quitar a quienes entraron con él.{' '}
          <Button size="sm" disabled={busy} onClick={() => void revokeAndRemove(token)}>
            Reintentar
          </Button>
        </p>
      ))}

      {invites.length > 0 ? (
        <ul className={styles.list} aria-label="Invitaciones vigentes">
          {invites.map((i) => {
            const entered = members.filter(([id]) => joins[id]?.token === i.token).length;
            return (
              <li key={i.token} className={styles.item}>
                <span className={styles.name}>
                  {ROLE_LABEL[i.role]} <span className={styles.muted}>· hasta el {day(i.expiresAt)}</span>
                  {entered > 0 ? (
                    <span className={styles.muted}>
                      {' '}
                      · {entered === 1 ? 'ha entrado 1 persona' : `han entrado ${entered} personas`}
                    </span>
                  ) : null}
                </span>
                <IconButton
                  label="Copiar enlace de invitación"
                  size="sm"
                  icon={<Copy size={14} />}
                  onClick={() => void copy(i.token)}
                />
                <IconButton
                  label="Revocar invitación"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={() =>
                    void act(async () => {
                      await inviteRepo.revoke(projectId, i.token);
                      await sync();
                    }, 'No se pudo revocar')
                  }
                />
                {entered > 0 ? (
                  <IconButton
                    label="Revocar y quitar a quienes entraron con este enlace"
                    size="sm"
                    icon={<UserX size={14} />}
                    onClick={() => void revokeAndRemove(i.token)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className={`${styles.title} ${styles.spaced}`}>Con acceso</p>
      {members.length === 0 ? (
        <p className={styles.hint}>Solo tú, por ahora.</p>
      ) : (
        <ul className={styles.list} aria-label="Miembros">
          {members.map(([id, r]) => (
            <li key={id} className={styles.item}>
              <span className={styles.name}>
                {joins[id]?.name ?? id.slice(0, 8)} <span className={styles.muted}>· {ROLE_LABEL[r]}</span>
              </span>
              <IconButton
                label={`Quitar a ${joins[id]?.name ?? id}`}
                size="sm"
                icon={<UserMinus size={14} />}
                onClick={() =>
                  void act(async () => {
                    await projectRepo.setMember(projectId, id, null);
                    await sync();
                  }, 'No se pudo quitar')
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
