// Embed de diagramas en la nota (plan · B): un elemento `embeddable` cuyo `link` es la URL absoluta
// `/embed/board/<id>` del propio sitio. Se pinta con `renderEmbeddable`, no con iframe.

export const EMBED_SIZE = { width: 640, height: 400 } as const;
export const MAX_EMBED_DEPTH = 1;

const BOARD_PATH = /^\/embed\/board\/([\w-]+)\/?$/;

export const boardEmbedLink = (boardId: string, origin: string): string => `${origin}/embed/board/${boardId}`;

/** Id del board si el enlace es del mismo origen y de la forma `/embed/board/<id>`; si no, `null`. */
export function parseBoardLink(link: string | null | undefined, origin: string): string | null {
  try {
    const u = new URL(link ?? '');
    const m = BOARD_PATH.exec(u.pathname);
    return u.origin === origin && !u.search && !u.hash && m ? m[1] : null;
  } catch {
    return null; // enlace vacío o relativo
  }
}

/**
 * `validateEmbeddable` de Excalidraw: `true` solo para nuestros boards; `undefined` para el resto
 * (cae en la lista de sitios permitidos de serie, que no incluye nuestro dominio).
 */
export const validateEmbeddable = (link: string, origin: string): true | undefined =>
  parseBoardLink(link, origin) ? true : undefined;

/** Centro del viewport en coordenadas de escena (Excalidraw: pantalla = (escena + scroll) · zoom). */
export function viewportCenter(s: {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  zoom: { value: number };
}) {
  return { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
}

/** Esquina superior izquierda del embed de 640×400 centrado en `center`. */
export const embedOrigin = (center: { x: number; y: number }) => ({
  x: Math.round(center.x - EMBED_SIZE.width / 2),
  y: Math.round(center.y - EMBED_SIZE.height / 2),
});
