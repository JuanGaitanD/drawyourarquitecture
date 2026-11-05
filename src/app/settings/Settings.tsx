import { Check, Copy, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MAX_LABEL_LENGTH, type AllowedUser, type McpTokenRecord } from '@/application/tokens';
import {
  addAllowedUser,
  createToken,
  listAllowedUsers,
  listTokens,
  removeAllowedUser,
  revokeToken,
} from '@/infrastructure/firebase/tokens';
import { Button, IconButton, useToast } from '@/ui';
import { useAuth } from '../hooks';
import { Shell } from '../shell/Shell';
import styles from './Settings.module.css';

const fmt = (t: number) =>
  new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

function Tokens({ uid }: { uid: string }) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<McpTokenRecord[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    listTokens(uid).then(setTokens, () => {
      setTokens([]);
      toast({ kind: 'error', title: 'No se pudieron cargar los tokens' });
    });
  }, [uid, toast]);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const name = label.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const { token } = await createToken(uid, name);
      setFresh(token);
      setCopied(false);
      setLabel('');
      load();
    } catch {
      toast({ kind: 'error', title: 'No se pudo crear el token', description: 'Inténtalo de nuevo.' });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      toast({ kind: 'error', title: 'No se pudo copiar', description: 'Selecciónalo y cópialo a mano.' });
    }
  }

  async function revoke(t: McpTokenRecord) {
    try {
      await revokeToken(t.hash);
      load();
    } catch {
      toast({ kind: 'error', title: 'No se pudo revocar el token' });
    }
  }

  return (
    <section aria-labelledby="tokens-titulo" className={styles.section}>
      <h2 id="tokens-titulo" className={styles.heading}>
        Tokens del servidor MCP
      </h2>
      <p className={styles.help}>
        Un token deja a un agente (p. ej. Claude Code) leer y crear tus proyectos. Se muestra una sola vez:
        guárdalo donde lo uses. Cómo conectarlo: <code>docs/mcp.md</code>.
      </p>

      <form className={styles.form} onSubmit={(e) => void create(e)}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Etiqueta</span>
          <input
            className={styles.input}
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="p. ej. Claude Code en mi portátil"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          icon={<KeyRound size={16} />}
          loading={busy}
          disabled={!label.trim()}
        >
          Crear token
        </Button>
      </form>

      {fresh ? (
        <div className={styles.fresh} role="status">
          <p className={styles.freshTitle}>Copia el token ahora: no se volverá a mostrar.</p>
          <div className={styles.freshRow}>
            <code className={styles.secret}>{fresh}</code>
            <Button icon={copied ? <Check size={16} /> : <Copy size={16} />} onClick={() => void copy()}>
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setFresh(null)}>
            Ya lo guardé
          </Button>
        </div>
      ) : null}

      {tokens === null ? (
        <p className={styles.muted}>Cargando…</p>
      ) : tokens.length === 0 ? (
        <p className={styles.muted}>Aún no has creado tokens.</p>
      ) : (
        <ul className={styles.list}>
          {tokens.map((t) => (
            <li key={t.hash} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>{t.label}</span>
                <span className={styles.muted}>
                  Creado el {fmt(t.createdAt)} · {t.lastUsedAt ? `usado el ${fmt(t.lastUsedAt)}` : 'sin usar'}
                </span>
              </div>
              {t.revoked ? (
                <span className={styles.badge}>Revocado</span>
              ) : (
                <IconButton
                  label={`Revocar el token «${t.label}»`}
                  icon={<Trash2 size={16} />}
                  onClick={() => void revoke(t)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AllowedUsers() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AllowedUser[] | null>(null);
  const [uid, setUid] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    // Solo el dueño puede listar: para el resto las reglas deniegan y la sección no se muestra.
    listAllowedUsers().then(setUsers, () => setUsers(null));
  }, []);

  if (users === null) return null;

  async function add(e: FormEvent) {
    e.preventDefault();
    const id = uid.trim();
    const mail = email.trim();
    if (!id || !mail) return;
    try {
      const u = await addAllowedUser(id, mail);
      setUsers((xs) => [...(xs ?? []).filter((x) => x.uid !== u.uid), u]);
      setUid('');
      setEmail('');
    } catch {
      toast({ kind: 'error', title: 'No se pudo añadir', description: 'Revisa el UID y el correo.' });
    }
  }

  async function remove(u: AllowedUser) {
    try {
      await removeAllowedUser(u.uid);
      setUsers((xs) => (xs ?? []).filter((x) => x.uid !== u.uid));
    } catch {
      toast({ kind: 'error', title: 'No se pudo quitar' });
    }
  }

  return (
    <section aria-labelledby="permitidos-titulo" className={styles.section}>
      <h2 id="permitidos-titulo" className={styles.heading}>
        Personas permitidas
      </h2>
      <p className={styles.help}>
        Pueden crear proyectos propios además de ti. Necesitas su UID de Firebase Auth.
      </p>

      <form className={styles.form} onSubmit={(e) => void add(e)}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>UID</span>
          <input
            className={styles.input}
            value={uid}
            maxLength={128}
            onChange={(e) => setUid(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Correo</span>
          <input
            className={styles.input}
            type="email"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <Button type="submit" icon={<UserPlus size={16} />} disabled={!uid.trim() || !email.trim()}>
          Añadir
        </Button>
      </form>

      {users.length === 0 ? (
        <p className={styles.muted}>Nadie más puede crear proyectos.</p>
      ) : (
        <ul className={styles.list}>
          {users.map((u) => (
            <li key={u.uid} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>{u.email}</span>
                <span className={styles.muted}>
                  <code>{u.uid}</code> · desde el {fmt(u.addedAt)}
                </span>
              </div>
              <IconButton
                label={`Quitar a ${u.email}`}
                icon={<Trash2 size={16} />}
                onClick={() => void remove(u)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Settings() {
  const { user } = useAuth();
  return (
    <Shell>
      <div className={styles.page}>
        <h1 className={styles.title}>Ajustes</h1>
        {user ? <Tokens uid={user.uid} /> : null}
        <AllowedUsers />
      </div>
    </Shell>
  );
}
