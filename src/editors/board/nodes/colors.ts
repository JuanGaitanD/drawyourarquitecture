// Colores «automáticos»: lo dibujado es literal y no cambia con el tema, salvo el color por defecto de lo que
// no tiene fondo propio (texto suelto, iconos, título de frame, aristas): ahí se usa el token para que se lea
// también en tema oscuro. Si la persona elige otro color, se respeta tal cual.
const DEFAULT_INK = '#111827';
const DEFAULT_STROKE = '#1f2937';
const DEFAULT_EDGE = '#475569';

const isDefault = (c: string, base: string) => c.toLowerCase() === base;

/** Texto sobre fondo transparente. */
export const inkText = (color: string, fill: string) =>
  fill === 'transparent' && isDefault(color, DEFAULT_INK) ? 'var(--text)' : color;
/** Trazo de un icono (sin fondo). */
export const inkStroke = (color: string) => (isDefault(color, DEFAULT_STROKE) ? 'var(--text)' : color);
/** Color de arista. */
export const inkEdge = (color: string) => (isDefault(color, DEFAULT_EDGE) ? 'var(--text-muted)' : color);
