import { useEffect, useRef, type RefObject } from 'react';
import { useBoardStore } from '../store/BoardStoreProvider';
import { useBoardReadonly } from '../store/readonly';
import { runShortcut, useBoardActions } from './actions';
import { isShortcutBlocked, resolveShortcut } from './shortcuts';

/** Evento de ventana con el que `useShortcuts` pide abrir la búsqueda (lo escucha SearchBox). */
export const SEARCH_EVENT = 'dya:board-search';

/**
 * Atajos del editor (invariante 11): solo con foco dentro de `container`; se ignoran en inputs, textarea,
 * contentEditable y durante la composición IME. El contenedor necesita `tabIndex={-1}` para recibir el foco
 * al hacer clic en el lienzo. Debe llamarse dentro de <ReactFlowProvider> (ver también `<Shortcuts>`).
 */
export function useShortcuts(container: RefObject<HTMLElement | null>): void {
  const store = useBoardStore();
  const readonly = useBoardReadonly();
  const actions = useBoardActions();
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  useEffect(() => {
    const el = container.current;
    if (!el || readonly) return;
    // Las flechas repetidas son un solo gesto (un paso de deshacer): se abre en la primera y se cierra al soltar.
    let nudging = false;
    const endNudge = () => {
      if (!nudging) return;
      nudging = false;
      store.getState().endGesture();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isShortcutBlocked(e.target as HTMLElement | null, e)) return;
      const action = resolveShortcut(e);
      if (!action) return;
      // Fase de captura + stopPropagation: así los atajos mandan sobre los de React Flow (flechas, Supr)
      // aunque el foco esté en un nodo, y no se ejecutan dos veces.
      e.preventDefault();
      e.stopPropagation();
      if (action.type === 'search') {
        window.dispatchEvent(new Event(SEARCH_EVENT));
        return;
      }
      if (action.type === 'nudge' && !nudging && store.getState().nodes.some((n) => n.selected)) {
        nudging = true;
        store.getState().beginGesture();
      }
      runShortcut(actionsRef.current, action);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) endNudge();
    };
    el.addEventListener('keydown', onKeyDown, true);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('focusout', endNudge);
    return () => {
      el.removeEventListener('keydown', onKeyDown, true);
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('focusout', endNudge);
      endNudge();
    };
  }, [container, store, readonly]);
}

/** Para montar los atajos desde un hijo cuando es BoardEditor quien crea el <ReactFlowProvider>. */
export function Shortcuts({ container }: { container: RefObject<HTMLElement | null> }): null {
  useShortcuts(container);
  return null;
}
