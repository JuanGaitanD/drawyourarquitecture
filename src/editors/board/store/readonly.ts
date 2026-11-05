import { createContext, useContext } from 'react';

/** Invariante 7: con `true` los nodos no editan ni muestran resizer o handles. */
export const BoardReadonlyContext = createContext(false);
export const useBoardReadonly = () => useContext(BoardReadonlyContext);
