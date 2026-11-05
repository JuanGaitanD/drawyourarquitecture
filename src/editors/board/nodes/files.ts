import { createContext, useContext } from 'react';

/** Acceso a los archivos del proyecto (imágenes). Sin proveedor, las imágenes muestran un marcador. */
export interface BoardFiles {
  load(fileId: string): Promise<Blob>;
  upload?(fileId: string, blob: Blob): Promise<void>;
}
export const BoardFilesContext = createContext<BoardFiles | null>(null);
export const useBoardFiles = () => useContext(BoardFilesContext);
