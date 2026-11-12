import { PenLine, Workflow } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ProjectType } from '@/domain/project';

/** Esbozo decorativo de un tipo de proyecto (no es la miniatura real): trazo `currentColor`, ancho en px. */
export interface SketchProps {
  size?: number;
  className?: string;
}

export interface TypeMeta {
  label: string;
  plural: string;
  description: string;
  Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  Sketch: ComponentType<SketchProps>;
}

const sketchProps = {
  viewBox: '0 0 64 48',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

/** Nota: tres renglones a mano alzada y un garabato. */
function NoteSketch({ size = 64, className }: SketchProps) {
  return (
    <svg {...sketchProps} width={size} height={(size * 3) / 4} className={className}>
      <path d="M6 9c8-1.5 16 1 24-.5s14 .5 18-.5" />
      <path d="M6 19c10 1 14-1.5 22 0s16-1 24 .5" />
      <path d="M6 29c7-1 12 1 20 0" />
      <path d="M36 37c3-7 6 5 9-2s5 3 8-3 4 2 6 0" />
    </svg>
  );
}

/** Diagrama: tres cajas unidas por dos conectores con punta. */
function BoardSketch({ size = 64, className }: SketchProps) {
  return (
    <svg {...sketchProps} width={size} height={(size * 3) / 4} className={className}>
      <rect x="4" y="7" width="18" height="12" rx="2" />
      <rect x="42" y="7" width="18" height="12" rx="2" />
      <rect x="23" y="30" width="18" height="12" rx="2" />
      <path d="M22 13h18M36.5 10l3.5 3-3.5 3" />
      <path d="M51 19v11h-8M46.5 27.5 43 30.5l3.5 3" />
    </svg>
  );
}

/** Texto, icono y esbozo de cada tipo de proyecto: lo comparten «Nuevo», las tarjetas y los tabs. */
export const TYPE_META: Record<ProjectType, TypeMeta> = {
  note: {
    label: 'Nota',
    plural: 'Notas',
    description: 'Pizarra libre para dibujar, escribir y pegar imágenes. Puede incrustar tus diagramas.',
    Icon: PenLine,
    Sketch: NoteSketch,
  },
  board: {
    label: 'Diagrama',
    plural: 'Diagramas',
    description: 'Lienzo estructurado con formas, conectores, frames e iconos, y autolayout.',
    Icon: Workflow,
    Sketch: BoardSketch,
  },
};
