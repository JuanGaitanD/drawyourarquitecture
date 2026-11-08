import { createContext, useContext } from 'react';

/** Dónde y con qué tamaño entra una imagen al diagrama cuando su subida se confirma. */
export interface ImageMeta {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** Acceso a los archivos del proyecto (imágenes). Sin proveedor, las imágenes muestran un marcador. */
export interface BoardFiles {
  /** Proyecto al que pertenecen estos archivos (para saber si lo pegado viene de otro). */
  projectId?: string;
  load(fileId: string): Promise<Blob>;
  /** Lee un archivo de otro proyecto (pegar entre proyectos copia las imágenes). */
  loadFrom?(projectId: string, fileId: string): Promise<Blob>;
  upload?(fileId: string, blob: Blob): Promise<void>;
  /**
   * Imagen nueva: se copia a disco, se sube con reintentos y el nodo entra al confirmarse (D23). Si falla, sigue en
   * disco y se repone al recuperar la conexión o al reabrir el diagrama.
   */
  addImage?(fileId: string, blob: Blob, meta: ImageMeta): void;
  /** Borra un archivo del proyecto (limpieza de lo subido por una importación que no se completó). */
  remove?(fileId: string): Promise<void>;
}
export const BoardFilesContext = createContext<BoardFiles | null>(null);
export const useBoardFiles = () => useContext(BoardFilesContext);
