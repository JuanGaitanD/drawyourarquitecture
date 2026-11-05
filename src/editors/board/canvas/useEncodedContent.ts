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
 */
export function useEncodedContent(store: BoardStore, viewport: RefObject<Viewport>) {
  const [state, setState] = useState(() => compute(store, viewport.current));
  const last = useRef({ nodes: store.getState().nodes, edges: store.getState().edges });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = store.subscribe((s) => {
      if (s.nodes === last.current.nodes && s.edges === last.current.edges) return;
      last.current = { nodes: s.nodes, edges: s.edges };
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = compute(store, viewport.current);
        setState((cur) => (cur.encoded === next.encoded && cur.tooLarge === next.tooLarge ? cur : next));
      }, DELAY_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [store, viewport]);

  return state;
}
