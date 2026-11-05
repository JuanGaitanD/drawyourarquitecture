import { createElement } from 'react';
import type { IconName, ShapeKind } from '../model/board';
import { iconComponent, shapePath } from '../nodes';

// Rótulos y vista previa del Toolbar. Los trazados de las formas y el mapa de iconos son los de `nodes/`
// (una sola fuente): aquí solo se reutilizan.

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rectangle: 'Rectángulo',
  round_rectangle: 'Rectángulo redondeado',
  ellipse: 'Elipse',
  rhombus: 'Rombo',
  triangle: 'Triángulo',
  parallelogram: 'Paralelogramo',
  hexagon: 'Hexágono',
  cylinder: 'Cilindro',
  cloud: 'Nube',
  document: 'Documento',
  terminator: 'Terminador',
  arrow_right: 'Flecha',
  callout: 'Llamada',
  actor: 'Actor',
};

export const ICON_LABEL: Record<IconName, string> = {
  server: 'Servidor',
  database: 'Base de datos',
  cloud: 'Nube',
  user: 'Usuario',
  globe: 'Web',
  smartphone: 'Móvil',
  lock: 'Candado',
  queue: 'Cola',
  cpu: 'Procesador',
  'hard-drive': 'Disco',
  network: 'Red',
  shield: 'Escudo',
  mail: 'Correo',
  'credit-card': 'Tarjeta',
  box: 'Contenedor',
};

export function ShapePreview({ shape, size = 24 }: { shape: ShapeKind; size?: number }) {
  const { d, detail } = shapePath(shape, 28, 18);
  return (
    <svg
      width={size}
      height={(size * 24) / 32}
      viewBox="-2 -3 32 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
      {detail ? <path d={detail} /> : null}
    </svg>
  );
}

/** Icono de arquitectura (el mismo mapa que usa `IconNode`). */
export const iconGlyph = (name: IconName, size: number) => createElement(iconComponent(name), { size });
