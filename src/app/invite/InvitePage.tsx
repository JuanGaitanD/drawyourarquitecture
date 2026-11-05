import { useEffect, useState } from 'react';
import { Redirect } from 'wouter';
import { isExpired } from '@/domain/invite';
import { Button } from '@/ui';
import { PageFallback } from '../PageFallback';
import { identity, inviteRepo } from '../services';
import styles from '../StatusPage.module.css';

type State =
  | { s: 'loading' }
  | { s: 'invalid' }
  | { s: 'error'; message: string }
  | { s: 'joined'; projectId: string };

/** Ruta `/invite/:token` (con sesión): comprueba la invitación y añade a la persona al proyecto. */
export function InvitePage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const me = identity.current();
    if (!me) return;
    (async () => {
      const inv = await inviteRepo.get(token);
      if (cancelled) return;
      if (!inv || isExpired(inv)) return setState({ s: 'invalid' });
      await inviteRepo.accept(inv, me);
      if (!cancelled) setState({ s: 'joined', projectId: inv.projectId });
    })().catch((e: unknown) => {
      if (!cancelled) setState({ s: 'error', message: e instanceof Error ? e.message : String(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  // El editor de cada tipo redirige si el tipo no coincide: basta con ir a una de las dos rutas.
  if (state.s === 'joined') return <Redirect to={`/note/${state.projectId}`} replace />;
  if (state.s === 'loading') return <PageFallback label="Comprobando la invitación…" />;
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>
        {state.s === 'invalid' ? 'La invitación no es válida o ha caducado' : 'No se pudo aceptar la invitación'}
      </h1>
      <p className={styles.text}>
        {state.s === 'invalid'
          ? 'Pide a quien te invitó que cree un enlace nuevo.'
          : `${state.message} Inténtalo de nuevo.`}
      </p>
      {state.s === 'error' ? (
        <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
