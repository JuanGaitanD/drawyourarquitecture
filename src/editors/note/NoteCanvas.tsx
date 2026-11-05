import { lazy, Suspense, type ReactNode } from 'react';
import { PageFallback } from '@/app/PageFallback';
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
}

export interface NoteCanvasProps {
  projectId: string;
  content: NoteContent;
  readonly: boolean;
  /** Cada cambio de la escena (con un respiro de 150 ms). Nunca se llama antes de hidratar. */
  onChange?: (content: NoteContent) => void;
  /** Barra de la esquina superior derecha (título, guardado, compartir…). Solo en edición. */
  topRight?: ReactNode;
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
