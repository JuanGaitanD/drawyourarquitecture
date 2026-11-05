import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { BoardState, BoardStore } from './boardStore';

// Fontanería del contexto (T0). C1 puede ampliarla, pero no cambia estas firmas.

const StoreContext = createContext<BoardStore | null>(null);

export function BoardStoreProvider({ store, children }: { store: BoardStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useBoardStore(): BoardStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useBoard necesita un <BoardStoreProvider>.');
  return s;
}

/** Suscripción con selector estrecho al store de la instancia actual. */
export function useBoard<T>(selector: (s: BoardState) => T): T {
  return useStore(useBoardStore(), selector);
}
