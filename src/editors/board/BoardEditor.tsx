import { ReactFlowProvider, useReactFlow, type Viewport } from '@xyflow/react';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'wouter';
import { useAutosave, useProject } from '@/app/hooks';
import { fileStore, projectRepo } from '@/app/services';
import type { Draft } from '@/application/saveQueue';
import { decode } from '@/domain/codec';
import { Button, useToast } from '@/ui';
import { BoardCanvas } from './canvas/BoardCanvas';
import { BackButton, SaveBadge, ShareButton, ThemeToggle, TitleField, UserMenu } from './canvas/EditorChrome';
import { useEncodedContent } from './canvas/useEncodedContent';
import styles from './canvas/editor.module.css';
import { BoardMenu } from './extras/BoardMenu';
import type { BoardContent } from './model/board';
import { validateBoardContent } from './model/validate';
import { BoardFilesContext, type BoardFiles } from './nodes';
import { BoardStoreProvider } from './store/BoardStoreProvider';
import { createBoardStore } from './store/boardStore';
import { ActionBar } from './ui/ActionBar';
import { SearchBox } from './ui/SearchBox';
import { StylePanel } from './ui/StylePanel';
import { Toolbar } from './ui/Toolbar';
import { Shortcuts } from './ui/useShortcuts';

export interface BoardEditorProps {
  id: string;
}

/** Parsea y valida lo guardado (invariante 8). Si no vale, el editor no se monta y nunca guarda. */
function parse(data: string): { ok: true; value: BoardContent } | { ok: false; error: string } {
  try {
    return validateBoardContent(decode<unknown>(data));
  } catch {
    return { ok: false, error: 'El contenido no es JSON válido.' };
  }
}

/** Editor del diagrama: carga → validación → hidratación → autosave. La ruta lo monta con `key={id}`. */
export function BoardEditor({ id }: BoardEditorProps) {
  const p = useProject(id);
  const [, navigate] = useLocation();
  const parsed = useMemo(() => (p.content ? parse(p.content.data) : null), [p.content]);

  if (p.status === 'loading') return <Full title="Cargando diagrama…" busy />;
  if (p.status === 'missing')
    return (
      <Full
        title="No existe o es privado"
        text="Comprueba el enlace o vuelve al panel."
        actions={<Button onClick={() => navigate('/')}>Volver al panel</Button>}
      />
    );
  if (p.status === 'error' || !p.project || !p.content || !parsed)
    return (
      <Full
        title="No se pudo cargar el diagrama"
        text={`${p.error?.message ?? 'Error de red.'} No se guardará nada hasta que cargue bien.`}
        actions={
          <>
            <Button variant="primary" onClick={p.reload}>
              Reintentar
            </Button>
            <Button onClick={() => navigate('/')}>Volver al panel</Button>
          </>
        }
      />
    );
  if (!parsed.ok)
    return (
      <Full
        title="El diagrama no se puede abrir"
        text={`Su contenido no es válido (${parsed.error}). No se modificará.`}
        actions={<Button onClick={() => navigate('/')}>Volver al panel</Button>}
      />
    );

  return (
    <Loaded
      id={id}
      title={p.project.title}
      isPublic={p.project.isPublic}
      revision={p.content.revision}
      initial={parsed.value}
      draft={p.draft}
      discardDraft={p.discardDraft}
    />
  );
}

function Full({
  title,
  text,
  actions,
  busy,
}: {
  title: string;
  text?: string;
  actions?: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className={styles.full} role={busy ? 'status' : undefined} aria-busy={busy || undefined}>
      {busy ? null : <TriangleAlert size={28} aria-hidden="true" className={styles.fullIcon} />}
      <h1 className={styles.fullTitle}>{title}</h1>
      {text ? <p className={styles.fullText}>{text}</p> : null}
      {actions ? <div className={styles.fullActions}>{actions}</div> : null}
    </div>
  );
}

/** `BoardMenu` con el viewport y el encuadre de React Flow (necesita estar dentro de su provider). */
function EditorMenu({ title, stageRef }: { title: string; stageRef: RefObject<HTMLElement | null> }) {
  const rf = useReactFlow();
  return (
    <BoardMenu
      title={title}
      viewportRef={stageRef}
      getViewport={rf.getViewport}
      onContentChanged={() => void rf.fitView({ padding: 0.15, duration: 0 })}
    />
  );
}

interface LoadedProps {
  id: string;
  title: string;
  isPublic: boolean;
  revision: number;
  initial: BoardContent;
  draft: Draft | null;
  discardDraft: () => void;
}

function Loaded({
  id,
  title: initialTitle,
  isPublic: initialPublic,
  revision,
  initial,
  draft,
  discardDraft,
}: LoadedProps) {
  const { toast } = useToast();
  // Un store por instancia (invariante 6): se crea y se hidrata una sola vez por montaje (key={id}).
  const [store] = useState(() => {
    const s = createBoardStore();
    s.getState().load(initial);
    return s;
  });
  const viewport = useRef<Viewport>(initial.viewport);
  const { encoded, tooLarge } = useEncodedContent(store, viewport);
  const { status, flush, resolveConflict } = useAutosave(id, encoded, true, revision);
  const [title, setTitle] = useState(initialTitle);
  const [isPublic, setPublic] = useState(initialPublic);
  const [draftOpen, setDraftOpen] = useState(draft !== null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Solo en desarrollo: el store a mano para probar mientras la barra de herramientas es de otro carril.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __board?: unknown }).__board = store;
    return () => {
      (window as unknown as { __board?: unknown }).__board = undefined;
    };
  }, [store]);

  const files = useMemo<BoardFiles>(
    () => ({
      load: (fileId) => fileStore.load(id, fileId),
      upload: (fileId, blob) => fileStore.upload(id, fileId, blob),
    }),
    [id],
  );

  const rename = useCallback(
    (next: string) => {
      const prev = title;
      setTitle(next);
      projectRepo.update(id, { title: next }).catch(() => {
        setTitle(prev);
        toast({ title: 'No se pudo cambiar el título', kind: 'error' });
      });
    },
    [id, title, toast],
  );
  const share = useCallback(
    async (next: boolean) => {
      await projectRepo.update(id, { isPublic: next });
      setPublic(next);
    },
    [id],
  );

  const recover = () => {
    const r = draft ? parse(draft.data) : null;
    if (r?.ok) store.getState().load(r.value);
    else toast({ title: 'El borrador no es válido', kind: 'error' });
    setDraftOpen(false);
    discardDraft();
  };

  return (
    <BoardStoreProvider store={store}>
      <BoardFilesContext.Provider value={files}>
        <ReactFlowProvider>
          <div className={styles.root} ref={rootRef} tabIndex={-1}>
            <Shortcuts container={rootRef} />
            <header className={styles.header}>
              <BackButton />
              <TitleField value={title} onCommit={rename} />
              <div className={styles.spacer} />
              <SaveBadge status={status} onRetry={() => void flush()} />
              <EditorMenu title={title} stageRef={stageRef} />
              <ShareButton id={id} isPublic={isPublic} onChange={share} />
              <ThemeToggle />
              <UserMenu />
            </header>

            {status === 'conflicto' ? (
              <div className={styles.banner} data-kind="danger" role="alert">
                <span>Otra pestaña guardó este diagrama. Tus cambios no se han perdido.</span>
                <Button size="sm" onClick={() => void resolveConflict('reload')}>
                  Recargar
                </Button>
                <Button size="sm" variant="primary" onClick={() => void resolveConflict('copy')}>
                  Guardar como copia
                </Button>
              </div>
            ) : null}
            {tooLarge ? (
              <div className={styles.banner} data-kind="danger" role="alert">
                <span>
                  El diagrama supera el tamaño máximo (900 KB) y no se guarda. Quita imágenes o simplifícalo.
                </span>
              </div>
            ) : null}
            {draftOpen && draft ? (
              <div className={styles.banner} data-kind="info" role="region" aria-label="Cambios sin guardar">
                <span>
                  Hay cambios sin guardar de {new Date(draft.at).toLocaleString('es')} en este navegador.
                </span>
                <Button size="sm" variant="primary" onClick={recover}>
                  Recuperar cambios
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setDraftOpen(false);
                    discardDraft();
                  }}
                >
                  Descartar
                </Button>
              </div>
            ) : null}

            <div className={styles.stage} ref={stageRef}>
              <BoardCanvas
                initialViewport={initial.viewport}
                onViewportChange={(v) => {
                  viewport.current = v;
                }}
              />
              <div className={styles.slotToolbar}>
                <Toolbar />
              </div>
              <div className={styles.slotStyle}>
                <StylePanel />
              </div>
              <div className={styles.slotSearch}>
                <SearchBox />
              </div>
              <div className={styles.slotActions}>
                <ActionBar />
              </div>
            </div>
          </div>
        </ReactFlowProvider>
      </BoardFilesContext.Provider>
    </BoardStoreProvider>
  );
}
