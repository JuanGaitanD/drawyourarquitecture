import { useEffect, useRef, useState, type RefObject } from 'react';
import { ContentTooLargeError, encode } from '@/domain/codec';
import type { Viewport } from '../model/board';
import type { BoardStore } from '../store/boardStore';

const DELAY_MS = 250;

function compute(store: BoardStore, viewport: Viewport): { encoded: string | null; tooLarge: boolean } {
  try {
    return { encoded: encode(store.getState().toContent(viewport)), tooLarge: false };
  } catch (e) {
    if (e instanceof ContentTooLargeError) return { encoded: null, tooLarge: true };
    throw e;
  }
}

/**
 * El contenido del store ya codificado para `useAutosave`. El primer valor es síncrono (es la base de
 * comparación); después se recalcula 250 ms tras el último cambio de nodos o aristas (no de la selección ni del
 * viewport: el viewport viaja con el siguiente cambio de contenido). `tooLarge` avisa de que pasa de 900 KB.
 * `drain` calcula ya lo pendiente (para `pagehide`, ocultar la pestaña o desmontar) y devuelve `null` si no hay.
 * Sigue valiendo después de desmontar: el cambio pendiente no depende del orden en que React limpia los efectos.
 */
export function useEncodedContent(store: BoardStore, viewport: RefObject<Viewport>) {
  const [state, setState] = useState(() => compute(store, viewport.current));
  const last = useRef({ nodes: store.getState().nodes, edges: store.getState().edges });
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const off = store.subscribe((s) => {
      if (s.nodes === last.current.nodes && s.edges === last.current.edges) return;
      last.current = { nodes: s.nodes, edges: s.edges };
      pending.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        pending.current = false;
        const next = compute(store, viewport.current);
        setState((cur) => (cur.encoded === next.encoded && cur.tooLarge === next.tooLarge ? cur : next));
      }, DELAY_MS);
    });
    return () => {
      off();
      clearTimeout(timer.current); // `pending` se queda: `drain` aún puede recoger el último cambio
    };
  }, [store, viewport]);

  const drain = (): string | null => {
    if (!pending.current) return null;
    pending.current = false;
    clearTimeout(timer.current);
    const next = compute(store, viewport.current);
    setState((cur) => (cur.encoded === next.encoded && cur.tooLarge === next.tooLarge ? cur : next));
    return next.encoded;
  };

  return { ...state, drain };
}
