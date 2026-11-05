import { STICKY_COLORS } from '../model/board';

// Colores DEL DIBUJO (se guardan literales y no cambian con el tema), no del chrome.

export interface Swatch {
  value: string;
  name: string;
}

const STICKY_NAME: Record<string, string> = {
  gray: 'Gris',
  light_yellow: 'Amarillo claro',
  yellow: 'Amarillo',
  orange: 'Naranja',
  light_green: 'Verde claro',
  green: 'Verde',
  dark_green: 'Verde oscuro',
  cyan: 'Cian',
  light_pink: 'Rosa claro',
  pink: 'Rosa',
  violet: 'Violeta',
  red: 'Rojo',
  light_blue: 'Azul claro',
  blue: 'Azul',
  dark_blue: 'Azul oscuro',
  black: 'Negro',
};

export const NO_FILL: Swatch = { value: 'transparent', name: 'Sin relleno' };
export const NO_STROKE: Swatch = { value: 'transparent', name: 'Sin borde' };

export const FILL_COLORS: Swatch[] = [
  NO_FILL,
  { value: '#ffffff', name: 'Blanco' },
  ...Object.entries(STICKY_COLORS).map(([key, value]) => ({ value, name: STICKY_NAME[key] ?? key })),
];

export const STROKE_COLORS: Swatch[] = [
  { value: '#1f2937', name: 'Grafito' },
  { value: '#475569', name: 'Pizarra' },
  { value: '#94a3b8', name: 'Gris azulado' },
  { value: '#ffffff', name: 'Blanco' },
  { value: '#dc2626', name: 'Rojo' },
  { value: '#ea580c', name: 'Naranja' },
  { value: '#ca8a04', name: 'Ámbar' },
  { value: '#16a34a', name: 'Verde' },
  { value: '#0891b2', name: 'Cian' },
  { value: '#2563eb', name: 'Azul' },
  { value: '#7c3aed', name: 'Violeta' },
  { value: '#db2777', name: 'Rosa' },
];

export const TEXT_COLORS: Swatch[] = [
  { value: '#111827', name: 'Negro' },
  { value: '#475569', name: 'Gris' },
  { value: '#ffffff', name: 'Blanco' },
  { value: '#dc2626', name: 'Rojo' },
  { value: '#2563eb', name: 'Azul' },
  { value: '#16a34a', name: 'Verde' },
  { value: '#d97706', name: 'Ámbar' },
  { value: '#7c3aed', name: 'Violeta' },
];

export const WIDTHS = [
  { value: 1, label: 'Fino' },
  { value: 2, label: 'Medio' },
  { value: 4, label: 'Grueso' },
  { value: 6, label: 'Muy grueso' },
];
export const FONT_SIZES = [12, 14, 18, 24, 32, 48];
export const OPACITIES = [100, 75, 50, 25];

/** Valor común de `get` en todos los elementos, o `undefined` si difieren (selección mixta). */
export function common<T, V>(items: readonly T[], get: (x: T) => V): V | undefined {
  if (!items.length) return undefined;
  const first = get(items[0]);
  return items.every((x) => get(x) === first) ? first : undefined;
}
