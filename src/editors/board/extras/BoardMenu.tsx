import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  FileCode2,
  FileDown,
  FileUp,
  ImageDown,
  LayoutTemplate,
  Workflow,
} from 'lucide-react';
import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  useReturnFocus,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useToast,
} from '@/ui';
import type { BoardContent, Viewport } from '../model/board';
import { autoLayout } from '../model/layout';
import { useBoardFiles } from '../nodes';
import { useBoard, useBoardStore } from '../store/BoardStoreProvider';
import { describeContent, placeBelow, type ApplyMode } from './content';
import { buildDya, dyaToText, readDya, uploadImages, type DyaImages } from './dyaFile';
import { downloadText, downloadUrl, slug } from './files';
import { track } from '@/app/services';
import { renderBoardPng } from './exportPng';
import { MermaidExportDialog } from './MermaidExportDialog';
import { MermaidImportDialog } from './MermaidImportDialog';
import { TemplatesDialog } from './TemplatesDialog';

export interface BoardMenuProps {
  /** Título del proyecto: nombre de los archivos que se descargan (PNG y JSON). */
  title: string;
  /** Contenedor del editor; se busca dentro `.react-flow__viewport` para exportar el PNG. */
  viewportRef: RefObject<HTMLElement | null>;
  /** Viewport actual de React Flow, para que el JSON exportado conserve la vista. Por defecto, origen y zoom 1. */
  getViewport?: () => Viewport;
  /** Se llama tras importar, insertar una plantilla u ordenar, para que el editor encuadre (`fitView`). */
  onContentChanged?: () => void;
}

const ORIGIN: Viewport = { x: 0, y: 0, zoom: 1 };

type DialogName = 'templates' | 'mermaid-in' | 'mermaid-out';
interface Pending {
  content: BoardContent;
  mode: ApplyMode;
  /** Imágenes de un `.dya.json` por subir al aplicar (después de confirmar, antes de cambiar el lienzo). */
  files?: DyaImages;
  /** Qué se va a reemplazar y por qué, para el texto de la confirmación. */
  source: string;
}

/**
 * Menú «Diagrama» del editor de boards: Mermaid, plantillas, ordenar, PNG y JSON.
 * Debe montarse dentro de `<BoardStoreProvider>` y de `ToastProvider`. Todas las mutaciones pasan por
 * `replaceAll` del store, así que cada una es un único paso del historial.
 */
export function BoardMenu({ title, viewportRef, getViewport, onContentChanged }: BoardMenuProps) {
  const store = useBoardStore();
  const nodeCount = useBoard((s) => s.nodes.length);
  const { toast } = useToast();
  const boardFiles = useBoardFiles();
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  // Al terminar una importación se reinicia el diálogo de Mermaid (borra el texto pegado).
  const [importKey, setImportKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const empty = nodeCount === 0;
  // Los diálogos se abren desde el menú: al cerrarlos el foco vuelve al botón «Diagrama».
  useReturnFocus(dialog !== null || pending !== null, trigger);

  const viewport = useCallback(() => getViewport?.() ?? ORIGIN, [getViewport]);
  const getContent = useCallback(() => store.getState().toContent(viewport()), [store, viewport]);

  const commit = useCallback(
    async (content: BoardContent, mode: ApplyMode, done: string, files?: DyaImages) => {
      setPending(null); // la confirmación ya se dio: mientras suben las imágenes no se puede volver a pulsar
      // Las imágenes se suben ANTES de aplicar: si falla una, el diagrama actual no se toca.
      if (files && Object.keys(files).length) {
        const upload = boardFiles?.upload;
        if (!upload) {
          toast({ title: 'No se pueden añadir imágenes aquí', kind: 'error' });
          return;
        }
        setBusy(true);
        try {
          content = await uploadImages(content, files, upload, { remove: boardFiles?.remove });
        } catch (e) {
          toast({
            title: 'No se pudieron subir las imágenes',
            description: e instanceof Error ? `${e.message} No se importó nada.` : undefined,
            kind: 'error',
          });
          return;
        } finally {
          setBusy(false);
        }
      }
      const s = store.getState();
      if (mode === 'insert') {
        const moved = placeBelow(content, s.nodes);
        s.replaceAll([...s.nodes, ...moved.nodes], [...s.edges, ...moved.edges]);
      } else s.replaceAll(content.nodes, content.edges);
      setDialog(null);
      setPending(null);
      setImportKey((k) => k + 1);
      toast({ title: done, description: 'Puedes deshacerlo con Ctrl+Z.', kind: 'success' });
      // Tras el siguiente pintado, para que React Flow ya tenga los nodos nuevos.
      requestAnimationFrame(() => onContentChanged?.());
    },
    [store, toast, onContentChanged, boardFiles],
  );

  /** Reemplazar un diagrama con contenido pide confirmación; insertar y lienzo vacío, no. */
  const request = useCallback(
    (content: BoardContent, mode: ApplyMode, source: string, files?: DyaImages) => {
      const done = mode === 'insert' ? `${source} añadido` : `${source} aplicado`;
      if (mode === 'replace' && store.getState().nodes.length > 0) setPending({ content, mode, source, files });
      else void commit(content, mode, done, files);
    },
    [store, commit],
  );

  const layout = async (dir: 'LR' | 'TB') => {
    setBusy(true);
    try {
      const out = await autoLayout(getContent(), dir);
      store.getState().replaceAll(out.nodes, out.edges);
      toast({ title: 'Diagrama ordenado', description: 'Puedes deshacerlo con Ctrl+Z.', kind: 'success' });
      requestAnimationFrame(() => onContentChanged?.());
    } catch (e) {
      toast({
        title: 'No se pudo ordenar',
        description: e instanceof Error ? e.message : undefined,
        kind: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const exportPng = async () => {
    setBusy(true);
    try {
      const url = await renderBoardPng(viewportRef.current, store.getState().nodes);
      downloadUrl(url, `${slug(title)}.png`);
      track({ name: 'export', params: { format: 'png' } });
      toast({ title: 'PNG exportado', kind: 'success' });
    } catch (e) {
      toast({
        title: 'No se pudo exportar el PNG',
        description: e instanceof Error ? e.message : undefined,
        kind: 'error',
        action: { label: 'Reintentar', onClick: () => void exportPng() },
      });
    } finally {
      setBusy(false);
    }
  };

  const exportJson = async () => {
    if (!boardFiles) return;
    setBusy(true);
    try {
      // `.dya.json`: el contenido y los binarios de las imágenes (base64), para poder importarlo en cualquier proyecto.
      const { file, missing } = await buildDya(getContent(), boardFiles.load);
      downloadText(dyaToText(file), `${slug(title)}.dya.json`);
      track({ name: 'export', params: { format: 'json' } });
      toast({
        title: 'Diagrama exportado',
        description: missing.length
          ? `${missing.length} ${missing.length === 1 ? 'imagen no se pudo leer y no se incluye' : 'imágenes no se pudieron leer y no se incluyen'}.`
          : undefined,
        kind: missing.length ? 'info' : 'success',
      });
    } catch (e) {
      toast({ title: 'No se pudo exportar', description: e instanceof Error ? e.message : undefined, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const importJson = async (file: File) => {
    const v = await readDya(file);
    if (!v.ok) {
      toast({ title: v.title ?? 'No es un diagrama válido', description: v.error, kind: 'error', duration: 8000 });
      return;
    }
    request(v.content, 'replace', `«${file.name}»`, v.files);
  };

  const confirmText = pending
    ? `Se reemplazará el diagrama actual (${describeContent(store.getState())}) por ${pending.source} (${describeContent(pending.content)}). Podrás deshacerlo.`
    : '';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            size="sm"
            variant="secondary"
            icon={<Workflow size={16} />}
            aria-label="Menú del diagrama"
          >
            Diagrama
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" style={{ minWidth: '15rem' }}>
          <DropdownMenuLabel>Insertar</DropdownMenuLabel>
          <DropdownMenuItem icon={<LayoutTemplate size={16} />} onSelect={() => setDialog('templates')}>
            Plantillas…
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FileCode2 size={16} />} onSelect={() => setDialog('mermaid-in')}>
            Importar Mermaid…
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FileUp size={16} />} onSelect={() => fileInput.current?.click()}>
            Importar .dya.json…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Ordenar automáticamente</DropdownMenuLabel>
          <DropdownMenuItem
            icon={<ArrowRight size={16} />}
            disabled={empty || busy}
            onSelect={() => void layout('LR')}
          >
            De izquierda a derecha
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ArrowDown size={16} />}
            disabled={empty || busy}
            onSelect={() => void layout('TB')}
          >
            De arriba abajo
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Exportar</DropdownMenuLabel>
          <DropdownMenuItem
            icon={<ImageDown size={16} />}
            disabled={empty || busy}
            onSelect={() => void exportPng()}
          >
            PNG (alta resolución)
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<FileCode2 size={16} />}
            disabled={empty}
            onSelect={() => setDialog('mermaid-out')}
          >
            Copiar como Mermaid…
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FileDown size={16} />} disabled={empty || busy} onSelect={() => void exportJson()}>
            Descargar .dya.json
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // permite elegir el mismo archivo otra vez
          if (f) void importJson(f);
        }}
      />

      <TemplatesDialog
        open={dialog === 'templates'}
        onOpenChange={(o) => setDialog(o ? 'templates' : null)}
        hasContent={!empty}
        onApply={(c, mode) => request(c, mode, 'Plantilla')}
      />
      <MermaidImportDialog
        key={importKey}
        open={dialog === 'mermaid-in'}
        onOpenChange={(o) => setDialog(o ? 'mermaid-in' : null)}
        hasContent={!empty}
        onApply={(c, mode) => request(c, mode, 'Mermaid')}
      />
      <MermaidExportDialog
        open={dialog === 'mermaid-out'}
        onOpenChange={(o) => setDialog(o ? 'mermaid-out' : null)}
        getContent={getContent}
      />

      <Dialog open={pending !== null} onOpenChange={(o) => (o ? undefined : setPending(null))}>
        <DialogContent
          title="¿Reemplazar el diagrama?"
          initialFocus={cancel}
          description={confirmText}
          size="sm"
          footer={
            <>
              <Button ref={cancel} variant="ghost" onClick={() => setPending(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => pending && void commit(pending.content, pending.mode, `${pending.source} aplicado`, pending.files)}
              >
                Reemplazar
              </Button>
            </>
          }
        />
      </Dialog>
    </>
  );
}
