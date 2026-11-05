import { useEffect, useRef, useState, type RefObject } from 'react';
import { ContentTooLargeError, encode } from '@/domain/codec';
import type { Viewport } from '../model/board';
import { validateBoardContent } from '../model/validate';
import type { BoardStore } from '../store/boardStore';

const DELAY_MS = 250;

export interface EncodedContent {
  encoded: string | null;
  tooLarge: boolean;
  /** Motivo por el que el contenido no pasa `validateBoardContent`: no se codifica, así que nunca se guarda. */
  invalid: string | null;
}

export function computeEncoded(store: BoardStore, viewport: Viewport): EncodedContent {
  const content = store.getState().toContent(viewport);
  const v = validateBoardContent(content);
  if (!v.ok) return { encoded: null, tooLarge: false, invalid: v.error };
  try {
    return { encoded: encode(content), tooLarge: false, invalid: null };
  } catch (e) {
    if (e instanceof ContentTooLargeError) return { encoded: null, tooLarge: true, invalid: null };
    throw e;
  }
}
const same = (a: EncodedContent, b: EncodedContent) =>
  a.encoded === b.encoded && a.tooLarge === b.tooLarge && a.invalid === b.invalid;

/**
 * El contenido del store ya codificado para `useAutosave`. El primer valor es síncrono (es la base de
 * comparación); después se recalcula 250 ms tras el último cambio de nodos o aristas (no de la selección ni del
 * viewport: el viewport viaja con el siguiente cambio de contenido). `tooLarge` avisa de que pasa de 900 KB e `invalid` de que el contenido no valida (no se guarda).
 * `drain` calcula ya lo pendiente (para `pagehide`, ocultar la pestaña o desmontar) y devuelve `null` si no hay.
 * Sigue valiendo después de desmontar: el cambio pendiente no depende del orden en que React limpia los efectos.
 */
export function useEncodedContent(store: BoardStore, viewport: RefObject<Viewport>) {
  const [state, setState] = useState(() => computeEncoded(store, viewport.current));
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
        const next = computeEncoded(store, viewport.current);
        setState((cur) => (same(cur, next) ? cur : next));
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
    const next = computeEncoded(store, viewport.current);
    setState((cur) => (same(cur, next) ? cur : next));
    return next.encoded;
  };

  return { ...state, drain };
}
