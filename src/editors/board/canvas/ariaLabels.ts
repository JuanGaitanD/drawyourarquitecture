import type { ReactFlowProps } from '@xyflow/react';

/** Textos de accesibilidad de React Flow en español. */
export const ARIA_LABELS: NonNullable<ReactFlowProps['ariaLabelConfig']> = {
  'node.a11yDescription.default':
    'Pulsa Intro o Espacio para seleccionar el elemento. Pulsa Escape para cancelar la selección.',
  'node.a11yDescription.keyboardDisabled': 'El movimiento con teclado está desactivado.',
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
    `Elemento movido hacia ${direction}. Nueva posición: x ${x}, y ${y}.`,
  'edge.a11yDescription.default': 'Pulsa Intro o Espacio para seleccionar la conexión.',
  'controls.ariaLabel': 'Controles del lienzo',
  'controls.zoomIn.ariaLabel': 'Acercar',
  'controls.zoomOut.ariaLabel': 'Alejar',
  'controls.fitView.ariaLabel': 'Ajustar a la vista',
  'controls.interactive.ariaLabel': 'Bloquear o desbloquear la interacción',
  'minimap.ariaLabel': 'Minimapa',
  'handle.ariaLabel': 'Punto de conexión',
};
