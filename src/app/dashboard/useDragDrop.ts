import { useState, type DragEvent } from 'react';
import { canMove, type Folder } from '@/domain/folder';
import { useToast } from '@/ui';
import { moveFolder, projectRepo } from '../services';

/**
 * Arrastrar y soltar nativo (HTML5) para mover proyectos y carpetas a un chip o a una miga. Es un atajo del ratón:
 * el teclado sigue con «Mover a…» de los menús, que usa los mismos casos de uso.
 */
export interface Dragged {
  kind: 'project' | 'folder';
  id: string;
  /** Carpeta de la que sale (`null` = Inicio): soltarla ahí no hace nada. */
  from: string | null;
}

const MIME = 'application/x-dya-item';

// `dataTransfer.getData` no se puede leer durante `dragover`, y ahí hay que decidir si el destino vale.
let current: Dragged | null = null;

/** ¿Vale `target` (`null` = Inicio) como destino? No su carpeta actual, ni ella misma ni sus descendientes. */
export function canDrop(folders: readonly Folder[], d: Dragged, target: string | null): boolean {
  return d.from !== target && (d.kind === 'project' || canMove(folders, d.id, target));
}

/** Props para el enlace que se arrastra (no para el botón de menú, que queda fuera) y si se está arrastrando. */
export function useDragSource(item: Dragged) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    props: {
      draggable: true,
      'data-dragging': dragging || undefined,
      onDragStart(e: DragEvent) {
        current = item;
        e.dataTransfer.clearData(); // fuera el enlace: soltarlo en otro sitio no debe navegar
        e.dataTransfer.setData(MIME, JSON.stringify(item));
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      },
      onDragEnd() {
        current = null;
        setDragging(false);
      },
    },
  };
}

/** Props de un destino (`target` = id de carpeta o `null` para Inicio): solo acepta y resalta lo que vale. */
export function useDropTarget(target: string | null, name: string, folders: readonly Folder[]) {
  const { toast } = useToast();
  const [over, setOver] = useState(false);

  async function move(d: Dragged) {
    try {
      if (d.kind === 'project') await projectRepo.setFolder(d.id, target);
      else await moveFolder(folders, d.id, target);
      toast({ kind: 'success', title: `Movido a ${name}` });
    } catch {
      toast({
        kind: 'error',
        title: 'No se pudo mover',
        description: 'Comprueba tu conexión e inténtalo de nuevo.',
        action: { label: 'Reintentar', onClick: () => void move(d) },
      });
    }
  }

  const accept = (e: DragEvent) => {
    if (!current || !canDrop(folders, current, target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOver(true);
  };

  return {
    'data-drop': over ? 'over' : undefined,
    onDragEnter: accept,
    onDragOver: accept,
    onDragLeave(e: DragEvent) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop(e: DragEvent) {
      setOver(false);
      const d = current;
      current = null; // la tarjeta arrastrada puede desmontarse antes de que `dragend` llegue
      if (!d || !canDrop(folders, d, target)) return;
      e.preventDefault();
      void move(d);
    },
  };
}
