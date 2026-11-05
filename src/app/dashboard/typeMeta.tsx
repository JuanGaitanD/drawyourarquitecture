import { PenLine, Workflow } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ProjectType } from '@/domain/project';

export interface TypeMeta {
  label: string;
  plural: string;
  description: string;
  Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
}

/** Texto e icono de cada tipo de proyecto: lo comparten «Nuevo», las tarjetas y los tabs. */
export const TYPE_META: Record<ProjectType, TypeMeta> = {
  note: {
    label: 'Nota',
    plural: 'Notas',
    description: 'Pizarra libre para dibujar, escribir y pegar imágenes. Puede incrustar tus diagramas.',
    Icon: PenLine,
  },
  board: {
    label: 'Diagrama',
    plural: 'Diagramas',
    description: 'Lienzo estructurado con formas, conectores, frames e iconos, y autolayout.',
    Icon: Workflow,
  },
};
