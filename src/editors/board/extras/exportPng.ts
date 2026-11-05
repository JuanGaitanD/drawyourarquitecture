import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import type { BoardNode } from '../model/board';
import { toAbsolute } from '../model/geometry';

// Exportar PNG: `toPng` sobre el `.react-flow__viewport` del editor, con el recuadro de TODOS los nodos
// (no solo lo visible) en coordenadas absolutas, tras cargar las fuentes y a escala 2.

export const PNG_SCALE = 2;
export const PNG_PADDING = 48;
/** Lado máximo en px de CSS (a escala 2 son 8192 px reales); más allá se reduce el zoom. */
export const PNG_MAX_SIDE = 4096;
const SKIP = ['react-flow__handle', 'react-flow__resize-control', 'react-flow__nodesselection'];

export async function renderBoardPng(root: HTMLElement | null, nodes: readonly BoardNode[]): Promise<string> {
  const viewport = root?.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport) throw new Error('No encuentro el lienzo del diagrama.');
  if (nodes.length === 0) throw new Error('El diagrama está vacío.');

  // Los hijos guardan posición relativa: para medir se aplanan a absolutas.
  const flat = nodes.map((n) => ({ ...n, position: toAbsolute(n, nodes), parentId: undefined }));
  const bounds = getNodesBounds(flat);
  const width = Math.min(Math.ceil(bounds.width + PNG_PADDING * 2), PNG_MAX_SIDE);
  const height = Math.min(Math.ceil(bounds.height + PNG_PADDING * 2), PNG_MAX_SIDE);
  const vp = getViewportForBounds(bounds, width, height, 0.05, 1, `${PNG_PADDING}px`);

  await document.fonts.ready;
  const { toPng } = await import('html-to-image');
  return toPng(viewport, {
    // El dibujo no cambia con el tema: el PNG siempre sale sobre blanco.
    backgroundColor: '#ffffff',
    width,
    height,
    pixelRatio: PNG_SCALE,
    filter: (el) => !(el instanceof Element && SKIP.some((c) => el.classList.contains(c))),
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
  });
}
