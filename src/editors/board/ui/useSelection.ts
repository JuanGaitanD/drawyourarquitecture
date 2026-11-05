import { useShallow } from 'zustand/react/shallow';
import type { BoardEdge, BoardNode } from '../model/board';
import { useBoard } from '../store/BoardStoreProvider';

// `selected` lo mantiene React Flow dentro de los nodos y aristas del store. useShallow devuelve la misma
// referencia mientras los elementos sean los mismos: sin él, el filter() crearía un array nuevo en cada
// lectura del store y React entraría en bucle.

export const useSelectedNodes = (): BoardNode[] =>
  useBoard(useShallow((s) => s.nodes.filter((n) => n.selected)));

export const useSelectedEdges = (): BoardEdge[] =>
  useBoard(useShallow((s) => s.edges.filter((e) => e.selected)));
