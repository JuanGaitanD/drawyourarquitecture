import {
  Box,
  Cloud,
  Cpu,
  CreditCard,
  Database,
  Globe,
  HardDrive,
  Lock,
  Mail,
  Network,
  Rows3,
  Server,
  Shield,
  Smartphone,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { IconName, ShapeKind } from '../model/board';

// Vistas previas del Toolbar (formas e iconos). Son solo para el chrome: el dibujo real de cada nodo
// lo hacen los nodos de C1.

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

export const ICON_COMPONENT: Record<IconName, LucideIcon> = {
  server: Server,
  database: Database,
  cloud: Cloud,
  user: User,
  globe: Globe,
  smartphone: Smartphone,
  lock: Lock,
  queue: Rows3,
  cpu: Cpu,
  'hard-drive': HardDrive,
  network: Network,
  shield: Shield,
  mail: Mail,
  'credit-card': CreditCard,
  box: Box,
};

const SHAPE_PATH: Record<ShapeKind, string> = {
  rectangle: 'M4 5h24v14H4z',
  round_rectangle: 'M9 5h14a5 5 0 0 1 5 5v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-4a5 5 0 0 1 5-5z',
  ellipse: 'M16 4c7 0 12 3.6 12 8s-5 8-12 8S4 16.4 4 12 9 4 16 4z',
  rhombus: 'M16 3l13 9-13 9L3 12z',
  triangle: 'M16 3l13 18H3z',
  parallelogram: 'M10 5h19l-7 14H3z',
  hexagon: 'M9 4h14l7 8-7 8H9l-7-8z',
  cylinder:
    'M5 6v12c0 1.9 4.9 3.5 11 3.5s11-1.6 11-3.5V6M5 6c0 1.9 4.9 3.5 11 3.5S27 7.9 27 6s-4.9-3.5-11-3.5S5 4.1 5 6z',
  cloud: 'M9 19.5a4.5 4.5 0 0 1-.6-8.96A6.5 6.5 0 0 1 21 8.6a5 5 0 0 1 2 10.9z',
  document: 'M4 4h24v13c-4 3-8-3-12 0s-8 3-12 0z',
  terminator: 'M9 6h14a6 6 0 0 1 0 12H9A6 6 0 0 1 9 6z',
  arrow_right: 'M3 8h15V3l11 9-11 9v-5H3z',
  callout: 'M4 4h24v12H14l-6 6v-6H4z',
  actor: 'M16 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM16 8.5V16M8 12h16M16 16l-6 6M16 16l6 6',
};

export function ShapePreview({ shape, size = 24 }: { shape: ShapeKind; size?: number }) {
  return (
    <svg
      width={size}
      height={(size * 24) / 32}
      viewBox="0 0 32 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={SHAPE_PATH[shape]} />
    </svg>
  );
}
