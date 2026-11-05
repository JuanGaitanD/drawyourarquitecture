import { Copy, Link2, Trash2, UserMinus, UserX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemberJoin } from '@/application/ports';
import type { Invite } from '@/domain/invite';
import type { Role } from '@/domain/project';
import { Button, IconButton, useToast } from '@/ui';
import { identity, inviteRepo, presenceAcl, projectRepo } from '../services';
import styles from './SharePanel.module.css';

const ROLE_LABEL: Record<Role, string> = { editor: 'Editor', viewer: 'Solo lectura' };
export const inviteUrl = (token: string) => `${location.origin}/invite/${token}`;
/** Espejo de acceso de la presencia: mejor esfuerzo, Firestore manda. */
const mirror = (p: Promise<unknown>) => p.catch(() => undefined);
const day = (t: number) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

/** Compartir con personas (solo el dueño): enlaces de invitación con rol y lista de miembros. */
export function SharePanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [role, setRole] = useState<Role>('editor');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<[string, Role][]>([]);
  const [joins, setJoins] = useState<Record<string, MemberJoin>>({});
  const [busy, setBusy] = useState(false);
  const uid = identity.current()?.uid ?? '';
  const room = useMemo(() => ({ ownerId: uid, projectId }), [uid, projectId]);

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
        // Las invitaciones creadas antes de la presencia se publican en el espejo al abrir el panel.
        for (const i of r[1])
          void mirror(presenceAcl.setInvite(room, i.token, { role: i.role, expiresAt: i.expiresAt }));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [load, apply, room]);

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
              await mirror(
                presenceAcl.setInvite(room, inv.token, { role: inv.role, expiresAt: inv.expiresAt }),
              );
              await copy(inv.token);
            }, 'No se pudo crear la invitación')
          }
        >
          Crear enlace
        </Button>
      </div>

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
                      await inviteRepo.revoke(i.token);
                      await mirror(presenceAcl.setInvite(room, i.token, null));
                    }, 'No se pudo revocar')
                  }
                />
                {entered > 0 ? (
                  <IconButton
                    label="Revocar y quitar a quienes entraron con este enlace"
                    size="sm"
                    icon={<UserX size={14} />}
                    onClick={() =>
                      void act(async () => {
                        const removed = await inviteRepo.revokeAndRemove(projectId, i.token);
                        await mirror(presenceAcl.setInvite(room, i.token, null));
                        await mirror(
                          presenceAcl.setMembers(room, Object.fromEntries(removed.map((u) => [u, null]))),
                        );
                      }, 'No se pudo revocar y quitar')
                    }
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
                    await mirror(presenceAcl.setMembers(room, { [id]: null }));
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
