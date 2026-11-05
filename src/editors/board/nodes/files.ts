import { createContext, useContext } from 'react';

/** Acceso a los archivos del proyecto (imágenes). Sin proveedor, las imágenes muestran un marcador. */
export interface BoardFiles {
  /** Proyecto al que pertenecen estos archivos (para saber si lo pegado viene de otro). */
  projectId?: string;
  load(fileId: string): Promise<Blob>;
  /** Lee un archivo de otro proyecto (pegar entre proyectos copia las imágenes). */
  loadFrom?(projectId: string, fileId: string): Promise<Blob>;
  upload?(fileId: string, blob: Blob): Promise<void>;
  /** Borra un archivo del proyecto (limpieza de lo subido por una importación que no se completó). */
  remove?(fileId: string): Promise<void>;
}
export const BoardFilesContext = createContext<BoardFiles | null>(null);
export const useBoardFiles = () => useContext(BoardFilesContext);
