import { ExternalLink, LoaderCircle, LockKeyhole, RefreshCw } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { contentRepo } from '@/app/services';
import { decode } from '@/domain/codec';
import type { BoardContent } from '@/editors/board/model/board';
import { validateBoardContent } from '@/editors/board/model/validate';
import { Button } from '@/ui';
import styles from './BoardEmbed.module.css';
import { MAX_EMBED_DEPTH } from './embed';

// React Flow solo se descarga cuando una nota tiene un diagrama incrustado.
const BoardViewer = lazy(() =>
  import('@/editors/board/BoardViewer').then((m) => ({ default: m.BoardViewer })),
);

export interface BoardEmbedProps {
  boardId: string;
  /** Nivel de anidamiento; por encima de `MAX_EMBED_DEPTH` no se pinta (corta ciclos). */
  depth?: number;
  /** En la vista pública «Abrir» va al visor; con sesión, al editor. */
  readonly?: boolean;
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; content: BoardContent }
  | { status: 'missing' }
  | { status: 'error'; message: string };

/** Carga el diagrama una vez (no se suscribe) y lo muestra en solo lectura. «Recargar» vuelve a leerlo. */
export function BoardEmbed({ boardId, depth = 0, readonly = false }: BoardEmbedProps) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [, navigate] = useLocation();
  const tooDeep = depth > MAX_EMBED_DEPTH;

  useEffect(() => {
    if (tooDeep) return;
    let cancelled = false;
    contentRepo
      .load(boardId)
      .then((record) => {
        if (cancelled) return;
        if (!record) return setState({ status: 'missing' });
        const v = validateBoardContent(decode(record.data));
        setState(
          v.ok
            ? { status: 'ready', content: v.value }
            : { status: 'error', message: 'El diagrama está dañado.' },
        );
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({
            status: 'error',
            message: e instanceof Error ? e.message : 'No se pudo cargar el diagrama.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, attempt, tooDeep]);

  const open = () => navigate(readonly ? `/view/board/${boardId}` : `/board/${boardId}`);
  const reload = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  if (tooDeep) {
    return (
      <div className={styles.frame}>
        <Message
          icon={<LockKeyhole size={22} />}
          title="Diagrama anidado"
          text="Un diagrama no se incrusta dentro de otro."
        />
      </div>
    );
  }

  return (
    <div className={styles.frame} data-embed-board={boardId}>
      {state.status === 'ready' ? (
        <Suspense fallback={<Loading />}>
          <BoardViewer content={state.content} />
        </Suspense>
      ) : null}
      {state.status === 'loading' ? <Loading /> : null}
      {state.status === 'missing' ? (
        <Message
          icon={<LockKeyhole size={22} />}
          title="Diagrama privado o inexistente"
          text="No tienes acceso o ya no existe."
          action={
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
              Recargar
            </Button>
          }
        />
      ) : null}
      {state.status === 'error' ? (
        <Message
          icon={<RefreshCw size={22} />}
          title="No se pudo cargar el diagrama"
          text={state.message}
          action={
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
              Reintentar
            </Button>
          }
        />
      ) : null}
      {state.status === 'ready' ? (
        <div className={styles.actions}>
          <Button size="sm" icon={<ExternalLink size={14} />} onClick={open}>
            Abrir
          </Button>
          <Button size="sm" icon={<RefreshCw size={14} />} onClick={reload}>
            Recargar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Loading() {
  return (
    <div className={styles.center} role="status">
      <LoaderCircle className={styles.spinner} size={22} aria-hidden="true" />
      <span>Cargando diagrama…</span>
    </div>
  );
}

function Message(props: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className={styles.center}>
      <span className={styles.icon} aria-hidden="true">
        {props.icon}
      </span>
      <p className={styles.title}>{props.title}</p>
      <p className={styles.text}>{props.text}</p>
      {props.action}
    </div>
  );
}
