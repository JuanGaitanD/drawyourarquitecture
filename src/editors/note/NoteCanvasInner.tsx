import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  newElementWith,
  restoreElements,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  LibraryItems,
} from '@excalidraw/excalidraw/types';
import { LayoutDashboard } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ImageTooLargeError, optimizeImage } from '@/application/imageOptimize';
import { fileStore } from '@/app/services';
import { useTheme, useToast } from '@/ui';
import { BoardEmbed } from './BoardEmbed';
import {
  buildNoteContent,
  pickBackground,
  referencedFileIds,
  unionFiles,
  type NoteContent,
  type NoteFiles,
} from './codec';
import {
  boardEmbedLink,
  embedOrigin,
  newEmbeddable,
  parseBoardLink,
  validateEmbeddable,
  viewportCenter,
} from './embed';
import {
  blobToDataUrl,
  createUploadQueue,
  dataUrlToBlob,
  diffNewFiles,
  type BinaryLike,
  type UploadQueue,
} from './files';
import { InsertBoardDialog } from './InsertBoardDialog';
import { mergeNoteData, reconcileScene } from './merge';
import { readLibrary, writeLibrary } from './library';
import type { NoteCanvasProps } from './NoteCanvas';
import styles from './NoteCanvas.module.css';

const CHANGE_THROTTLE_MS = 150;
const REJECTION_TEXT = 'Solo se admiten PNG, JPEG, GIF y WebP (hasta 4 MiB tras optimizar).';

type SceneState = { viewBackgroundColor?: string; openSidebar?: { name: string } | null };
type Scene = { elements: readonly unknown[]; appState: SceneState };

export default function NoteCanvasInner({
  projectId,
  content,
  readonly,
  onChange,
  topRight,
  onHandle,
}: NoteCanvasProps) {
  const { resolved } = useTheme();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const toggleLibrary = useCallback(() => api?.toggleSidebar({ name: 'default' }), [api]);

  // Estado del puente con Excalidraw. Vive en refs: no pinta nada y no debe re-renderizar el lienzo.
  const known = useRef<NoteFiles>({ ...content.files }); // archivos ya registrados en la nota
  const ready = useRef(false); // abierto cuando initialData ya se aplicó: antes no se emite nada
  const alive = useRef(true);
  const scene = useRef<Scene | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rejected = useRef(new Set<string>());
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // `toast` es estable: el aviso se fija al crear la cola. Un solo aviso aunque fallen varias imágenes.
  const [uploads] = useState<UploadQueue>(() => {
    let shown = false;
    const q: UploadQueue = createUploadQueue({
      store: fileStore,
      projectId,
      onFail: () => {
        if (shown) return;
        shown = true;
        toast({
          kind: 'error',
          title: 'No se pudo subir una imagen',
          description: 'Sigue en esta pestaña. Reintenta antes de cerrarla.',
          duration: 0,
          action: {
            label: 'Reintentar',
            onClick: () => {
              shown = false;
              q.retryFailed();
            },
          },
        });
      },
    });
    return q;
  });

  // Aviso al cerrar la pestaña con subidas sin terminar (el binario solo está en memoria).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (uploads.pending() > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploads]);

  // Fondo del último contenido del servidor que esta pestaña conoce (para fusionar el fondo sin pisar lo propio).
  const knownBg = useRef(content.appState.viewBackgroundColor ?? '#ffffff');

  // initialData solo se lee al montar. Se abre la compuerta de onChange cuando ya se aplicó.
  const [initialData] = useState(() => async () => {
    const elements = restoreElements(content.elements as ExcalidrawElement[], null, {
      repairBindings: true,
    });
    ready.current = true;
    return {
      elements,
      appState: { viewBackgroundColor: content.appState.viewBackgroundColor ?? '#ffffff' },
      scrollToContent: elements.length > 0,
      libraryItems: readLibrary() as LibraryItems,
    };
  });

  /** Descarga de Firestore las imágenes indicadas y las entrega a Excalidraw con `BinaryFileData` completo. */
  const loadFiles = useCallback(
    (a: ExcalidrawImperativeAPI, all: string[]) => {
      const run = async (ids: string[]): Promise<void> => {
        if (ids.length === 0) return;
        const results = await Promise.allSettled(
          ids.map(async (id): Promise<BinaryFileData> => {
            const blob = await fileStore.load(projectId, id);
            const meta = known.current[id];
            return {
              id: id as BinaryFileData['id'],
              mimeType: (blob.type || meta?.mimeType) as BinaryFileData['mimeType'],
              dataURL: (await blobToDataUrl(blob)) as BinaryFileData['dataURL'],
              created: meta?.created ?? Date.now(),
            };
          }),
        );
        if (!alive.current) return;
        const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        if (ok.length) a.addFiles(ok);
        const failed = ids.filter((_, i) => results[i].status === 'rejected');
        if (failed.length) {
          toast({
            kind: 'error',
            title:
              failed.length === 1
                ? 'No se pudo cargar una imagen'
                : `No se pudieron cargar ${failed.length} imágenes`,
            duration: 0,
            action: { label: 'Reintentar', onClick: () => void run(failed) },
          });
        }
      };
      return run(all);
    },
    [projectId, toast],
  );

  // Hidratación de imágenes: al tener el API, se piden las que usa la escena.
  useEffect(() => {
    if (api) void loadFiles(api, referencedFileIds(content.elements));
    // Solo con el contenido inicial: los cambios posteriores los lleva Excalidraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const emit = useCallback(() => {
    timer.current = null;
    const s = scene.current;
    if (s) onChangeRef.current?.(buildNoteContent(s.elements, s.appState, known.current));
  }, []);

  // Lo retenido por el respiro sale por `drain` (lo llama NoteEditor antes de guardar). Al desmontar no se emite
  // aquí: los efectos del padre se limpian antes que los de este componente y el cambio se perdería.
  const drain = useCallback((): NoteContent | null => {
    if (!timer.current) return null;
    clearTimeout(timer.current);
    timer.current = null;
    const s = scene.current;
    return s ? buildNoteContent(s.elements, s.appState, known.current) : null;
  }, []);

  /** Excalidraw acepta SVG y archivos grandes; aquí no. Se retira la imagen de la escena y se explica. */
  const retire = useCallback(
    (ids: string[], why: string) => {
      const fresh = ids.filter((id) => !rejected.current.has(id));
      if (!fresh.length || !api) return;
      fresh.forEach((id) => rejected.current.add(id));
      queueMicrotask(() => {
        api.updateScene({
          elements: api
            .getSceneElementsIncludingDeleted()
            .map((e) =>
              e.type === 'image' && e.fileId && rejected.current.has(e.fileId)
                ? newElementWith(e, { isDeleted: true })
                : e,
            ),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      });
      toast({ kind: 'error', title: 'No se añadió la imagen', description: why });
    },
    [api, toast],
  );

  const handleChange = useCallback(
    (elements: readonly unknown[], appState: SceneState, files: BinaryFiles) => {
      setLibraryOpen(appState.openSidebar?.name === 'default');
      if (!ready.current || readonly) return;
      const { fresh, rejected: bad } = diffNewFiles(
        elements,
        files as Record<string, BinaryLike>,
        known.current,
      );
      for (const f of fresh) {
        known.current[f.id] = { mimeType: f.mimeType, created: f.created };
        dataUrlToBlob(f.dataURL)
          .then(optimizeImage)
          .then(
            (b) => {
              // Se registra el tipo que de verdad se guarda (WebP si se recodificó).
              known.current[f.id] = { mimeType: b.type, created: f.created };
              uploads.add(f.id, b);
            },
            (e: unknown) => {
              if (e instanceof ImageTooLargeError) retire([f.id], e.message);
              else
                toast({
                  kind: 'error',
                  title: 'No se pudo leer una imagen',
                  description: 'Vuelve a pegarla.',
                });
            },
          );
      }
      retire(
        bad.map((b) => b.file.id),
        REJECTION_TEXT,
      );
      scene.current = { elements, appState };
      if (!timer.current) timer.current = setTimeout(emit, CHANGE_THROTTLE_MS);
    },
    [emit, readonly, retire, toast, uploads],
  );

  // Control imperativo para «Recuperar cambios no guardados».
  useEffect(() => {
    if (!api || !onHandle) return;
    onHandle({
      drain,
      merge: (l, r) => mergeNoteData(knownBg.current)(l, r),
      saved(c) {
        knownBg.current = c.appState.viewBackgroundColor ?? '#ffffff';
      },
      async applyRemote(c) {
        known.current = unionFiles(known.current, c.files);
        const elements = reconcileScene(
          api.getSceneElementsIncludingDeleted() as never,
          c.elements as never,
          api.getAppState(),
        );
        // El fondo remoto se toma salvo que esta pestaña lo haya cambiado y aún no esté guardado.
        const remoteBg = c.appState.viewBackgroundColor ?? '#ffffff';
        const bg = pickBackground(api.getAppState().viewBackgroundColor, knownBg.current, remoteBg);
        knownBg.current = remoteBg;
        api.updateScene({
          elements,
          ...(bg !== api.getAppState().viewBackgroundColor ? { appState: { viewBackgroundColor: bg } } : {}),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        const have = api.getFiles();
        await loadFiles(
          api,
          referencedFileIds(elements).filter((id) => !have[id]),
        );
      },
      async applyContent(c) {
        known.current = { ...known.current, ...c.files };
        const elements = restoreElements(c.elements as ExcalidrawElement[], null, { repairBindings: true });
        api.updateScene({
          elements,
          appState: { viewBackgroundColor: c.appState.viewBackgroundColor ?? '#ffffff' },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        const have = api.getFiles();
        await loadFiles(
          api,
          referencedFileIds(elements).filter((id) => !have[id]),
        );
      },
    });
    return () => onHandle(null);
  }, [api, onHandle, loadFiles, drain]);

  const insertBoard = useCallback(
    (boardId: string) => {
      if (!api) return;
      const origin = embedOrigin(viewportCenter(api.getAppState()));
      const [el] = restoreElements(
        [newEmbeddable(origin, boardEmbedLink(boardId, location.origin))] as never,
        null,
      );
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), el],
        appState: { selectedElementIds: { [el.id]: true } },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  const openBoard = useCallback(
    (id: string) => navigate(readonly ? `/view/board/${id}` : `/board/${id}`),
    [navigate, readonly],
  );

  const onLinkOpen = useCallback<NonNullable<ExcalidrawProps['onLinkOpen']>>(
    (el, event) => {
      const id = parseBoardLink(el.link, location.origin);
      if (!id) return;
      event.preventDefault();
      openBoard(id);
    },
    [openBoard],
  );

  return (
    <div className={styles.root}>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={handleChange as ExcalidrawProps['onChange']}
        theme={resolved}
        langCode="es-ES"
        viewModeEnabled={readonly}
        validateEmbeddable={(link) => validateEmbeddable(link, location.origin)}
        renderEmbeddable={(el) => {
          const id = parseBoardLink(el.link, location.origin);
          return id ? <BoardEmbed boardId={id} readonly={readonly} /> : null;
        }}
        onLinkOpen={onLinkOpen}
        onLibraryChange={writeLibrary}
        renderTopRightUI={
          !topRight
            ? undefined
            : () => (
                <div className={styles.topRight}>
                  {typeof topRight === 'function' ? topRight({ libraryOpen, toggleLibrary }) : topRight}
                </div>
              )
        }
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      >
        {readonly ? null : (
          <MainMenu>
            <MainMenu.Item icon={<LayoutDashboard size={16} />} onSelect={() => setInsertOpen(true)}>
              Insertar diagrama
            </MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.ClearCanvas />
          </MainMenu>
        )}
      </Excalidraw>
      {readonly ? null : (
        <InsertBoardDialog
          open={insertOpen}
          onOpenChange={setInsertOpen}
          onPick={insertBoard}
          onOpenBoard={openBoard}
        />
      )}
    </div>
  );
}
