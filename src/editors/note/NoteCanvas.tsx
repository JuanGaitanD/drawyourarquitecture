import { lazy, Suspense, type ReactNode } from 'react';
import { PageFallback } from '@/app/PageFallback';
import type { ContentMerger } from '@/application/ports';
import type { NoteContent } from './codec';

/** Control imperativo para el editor que envuelve el lienzo (recuperar un borrador). */
export interface NoteHandle {
  /** Sustituye la escena por `content` (no entra en el historial) y carga sus imágenes. */
  applyContent(content: NoteContent): Promise<void>;
  /**
   * Saca ya el último cambio retenido por el respiro de 150 ms (o `null` si no hay). Sigue valiendo después de
   * desmontar el lienzo: el editor lo llama al `pagehide`, al ocultar la pestaña y al desmontar.
   */
  drain(): NoteContent | null;
  /** Fusiona con la escena viva lo que guardó otra persona (no entra en el historial local). */
  applyRemote(content: NoteContent): Promise<void>;
  /** Fusión de dos contenidos codificados, para el guardado en transacción. */
  merge: ContentMerger;
  /** Lo que esta pestaña acaba de escribir sin fusión: pasa a ser lo último conocido del servidor (fondo). */
  saved(content: NoteContent): void;
}

/** Lo que el lienzo ofrece a su barra superior: la Biblioteca de Excalidraw con un botón propio. */
export interface CanvasUi {
  libraryOpen: boolean;
  toggleLibrary: () => void;
  /**
   * La barra va en una fila propia encima del lienzo (ventana estrecha) en vez de flotar en la esquina de
   * Excalidraw, cuya fila superior no la deja caber en ventanas estrechas (ver `DOCK_QUERY` en NoteCanvasInner).
   */
  docked: boolean;
}

export interface NoteCanvasProps {
  projectId: string;
  content: NoteContent;
  readonly: boolean;
  /** Cada cambio de la escena (con un respiro de 150 ms). Nunca se llama antes de hidratar. */
  onChange?: (content: NoteContent) => void;
  /** Barra de la esquina superior derecha (título, guardado, compartir…). Solo en edición. */
  topRight?: ReactNode | ((ui: CanvasUi) => ReactNode);
  /** Entrega el control imperativo cuando el lienzo está listo (y `null` al desmontar). */
  onHandle?: (handle: NoteHandle | null) => void;
}

// El motor (Excalidraw ≈ 1,6 MB gzip) va en su propio chunk: quien importe NoteCanvas no lo arrastra.
const NoteCanvasInner = lazy(() => import('./NoteCanvasInner'));

export function NoteCanvas(props: NoteCanvasProps) {
  return (
    <Suspense fallback={<PageFallback label="Cargando la nota…" />}>
      <NoteCanvasInner {...props} />
    </Suspense>
  );
}
