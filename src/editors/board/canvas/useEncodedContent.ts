import { useEffect, useRef, useState, type RefObject } from 'react';
import { ContentTooLargeError, encode } from '@/domain/codec';
import type { Viewport } from '../model/board';
import { validateBoardContent } from '../model/validate';
import type { BoardStore } from '../store/boardStore';

// Corto a propósito: con colaboración el cambio debe salir en menos de un segundo (el guardado agrupa después).
const DELAY_MS = 120;
// Pan y zoom solos: se guardan más tarde (cada movimiento es una escritura y no entran al historial).
const VIEWPORT_DELAY_MS = 1500;

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
 * comparación); después se recalcula 120 ms tras el último cambio de nodos o aristas (no de la selección) y, con
 * retraso (`touchViewport`), tras un pan o zoom aunque el contenido no cambie (el viewport se guarda sin pasar por el
 * historial). `tooLarge` avisa de que pasa de 900 KB e `invalid` de que el contenido no valida (no se guarda).
 * `drain` calcula ya lo pendiente (para `pagehide`, ocultar la pestaña o desmontar) y devuelve `null` si no hay.
 * Sigue valiendo después de desmontar: el cambio pendiente no depende del orden en que React limpia los efectos.
 */
export function useEncodedContent(store: BoardStore, viewport: RefObject<Viewport>) {
  const [state, setState] = useState(() => computeEncoded(store, viewport.current));
  const last = useRef({ nodes: store.getState().nodes, edges: store.getState().edges });
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const recompute = () => {
    pending.current = false;
    const next = computeEncoded(store, viewport.current);
    setState((cur) => (same(cur, next) ? cur : next));
    return next;
  };

  useEffect(() => {
    const off = store.subscribe((s) => {
      if (s.nodes === last.current.nodes && s.edges === last.current.edges) return;
      last.current = { nodes: s.nodes, edges: s.edges };
      pending.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(recompute, DELAY_MS);
    });
    return () => {
      off();
      // `pending` se queda: `drain` aún puede recoger el último cambio
      clearTimeout(timer.current);
      clearTimeout(viewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `recompute` solo lee refs y el store
  }, [store, viewport]);

  /** El viewport cambió (pan o zoom): se recodifica con retraso aunque el contenido no cambie. */
  const touchViewport = () => {
    pending.current = true;
    clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(recompute, VIEWPORT_DELAY_MS);
  };

  const drain = (): string | null => {
    if (!pending.current) return null;
    clearTimeout(timer.current);
    clearTimeout(viewTimer.current);
    return recompute().encoded;
  };

  return { ...state, drain, touchViewport };
}
