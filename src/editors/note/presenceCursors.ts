import type {
  Collaborator,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  SocketId,
} from '@excalidraw/excalidraw/types';
import { useCallback, useEffect } from 'react';
import { usePresence } from '@/app/hooks';
import { cursorIdFor } from './cursorColor';

/**
 * Cursores de las demás personas en la nota: se pasan a Excalidraw como `collaborators` (coordenadas de escena) y
 * el propio puntero se publica con el `onPointerUpdate` que devuelve (el límite de 80 ms lo pone la sala).
 */
export function useNoteCursors(
  projectId: string,
  api: ExcalidrawImperativeAPI | null,
): NonNullable<ExcalidrawProps['onPointerUpdate']> {
  const { others, move } = usePresence(projectId);

  useEffect(() => {
    if (!api) return;
    const collaborators = new Map<SocketId, Collaborator>();
    for (const p of others) {
      if (p.x === undefined || p.y === undefined) continue;
      collaborators.set(p.uid as SocketId, {
        pointer: { x: p.x, y: p.y, tool: 'pointer' },
        username: p.name,
        color: { background: p.color, stroke: p.color },
        id: cursorIdFor(p.color), // Excalidraw 0.18.1 pinta por `id`, no por `color` (ver cursorColor.ts)
      });
    }
    api.updateScene({ collaborators });
  }, [api, others]);

  return useCallback(({ pointer }) => move(pointer.x, pointer.y), [move]);
}
