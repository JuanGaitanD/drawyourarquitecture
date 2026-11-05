import type { ShapeKind } from '../model/board';

// Trazado SVG de las 14 formas en el cajón (0,0)-(w,h). Función pura: la prueba comprueba que ninguna produce NaN.

export interface ShapePath {
  /** Contorno con relleno. */
  d: string;
  /** Línea extra solo de trazo (p. ej. la tapa del cilindro). */
  detail?: string;
}

const r = (n: number) => Math.round(n * 100) / 100;

export function shapePath(kind: ShapeKind, w: number, h: number): ShapePath {
  const W = Math.max(w, 1);
  const H = Math.max(h, 1);
  const hw = W / 2;
  const hh = H / 2;
  switch (kind) {
    case 'rectangle':
      return { d: `M0 0H${W}V${H}H0Z` };
    case 'round_rectangle': {
      const k = r(Math.min(14, hw, hh));
      return {
        d: `M${k} 0H${W - k}Q${W} 0 ${W} ${k}V${H - k}Q${W} ${H} ${W - k} ${H}H${k}Q0 ${H} 0 ${H - k}V${k}Q0 0 ${k} 0Z`,
      };
    }
    case 'ellipse':
      return { d: `M0 ${hh}A${hw} ${hh} 0 1 0 ${W} ${hh}A${hw} ${hh} 0 1 0 0 ${hh}Z` };
    case 'rhombus':
      return { d: `M${hw} 0L${W} ${hh}L${hw} ${H}L0 ${hh}Z` };
    case 'triangle':
      return { d: `M${hw} 0L${W} ${H}L0 ${H}Z` };
    case 'parallelogram': {
      const k = r(W * 0.2);
      return { d: `M${k} 0H${W}L${W - k} ${H}H0Z` };
    }
    case 'hexagon': {
      const k = r(W * 0.22);
      return { d: `M${k} 0H${W - k}L${W} ${hh}L${W - k} ${H}H${k}L0 ${hh}Z` };
    }
    case 'cylinder': {
      const ry = r(Math.min(14, H * 0.16));
      return {
        d: `M0 ${ry}A${hw} ${ry} 0 0 1 ${W} ${ry}V${H - ry}A${hw} ${ry} 0 0 1 0 ${H - ry}Z`,
        detail: `M0 ${ry}A${hw} ${ry} 0 0 0 ${W} ${ry}`,
      };
    }
    case 'cloud':
      return {
        d:
          `M${r(W * 0.25)} ${r(H * 0.88)}C${r(W * 0.05)} ${r(H * 0.88)} ${r(W * 0.01)} ${r(H * 0.58)} ${r(W * 0.2)} ${r(H * 0.5)}` +
          `C${r(W * 0.14)} ${r(H * 0.2)} ${r(W * 0.42)} ${r(H * 0.08)} ${r(W * 0.5)} ${r(H * 0.3)}` +
          `C${r(W * 0.6)} ${r(H * 0.02)} ${r(W * 0.92)} ${r(H * 0.14)} ${r(W * 0.82)} ${r(H * 0.46)}` +
          `C${r(W * 1.02)} ${r(H * 0.52)} ${r(W * 1)} ${r(H * 0.88)} ${r(W * 0.75)} ${r(H * 0.88)}Z`,
      };
    case 'document':
      return {
        d: `M0 0H${W}V${r(H * 0.85)}C${r(W * 0.8)} ${r(H * 0.7)} ${r(W * 0.7)} ${r(H * 0.7)} ${hw} ${r(H * 0.85)}S${r(W * 0.2)} ${H} 0 ${r(H * 0.85)}Z`,
      };
    case 'terminator': {
      const k = r(hh);
      return { d: `M${k} 0H${W - k}A${k} ${k} 0 0 1 ${W - k} ${H}H${k}A${k} ${k} 0 0 1 ${k} 0Z` };
    }
    case 'arrow_right':
      return {
        d: `M0 ${r(H * 0.25)}H${r(W * 0.6)}V0L${W} ${hh}L${r(W * 0.6)} ${H}V${r(H * 0.75)}H0Z`,
      };
    case 'callout':
      return {
        d: `M0 0H${W}V${r(H * 0.78)}H${r(W * 0.4)}L${r(W * 0.2)} ${H}L${r(W * 0.24)} ${r(H * 0.78)}H0Z`,
      };
    case 'actor': {
      const hr = r(Math.min(H * 0.14, hw));
      return {
        // cabeza rellena; cuerpo, brazos y piernas solo trazo
        d: `M${hw} 0A${hr} ${hr} 0 1 1 ${hw} ${hr * 2}A${hr} ${hr} 0 1 1 ${hw} 0Z`,
        detail:
          `M${hw} ${hr * 2}V${r(H * 0.62)}M${r(W * 0.2)} ${r(H * 0.34)}H${r(W * 0.8)}` +
          `M${hw} ${r(H * 0.62)}L${r(W * 0.24)} ${H}M${hw} ${r(H * 0.62)}L${r(W * 0.76)} ${H}`,
      };
    }
  }
}

/** Relleno interior (padding CSS) donde cabe el texto de cada forma. */
export const LABEL_INSET: Record<ShapeKind, string> = {
  rectangle: '6px 10px',
  round_rectangle: '6px 12px',
  ellipse: '12% 14%',
  rhombus: '22% 24%',
  triangle: '38% 22% 6% 22%',
  parallelogram: '6px 22%',
  hexagon: '6px 20%',
  cylinder: '22% 10px 8px',
  cloud: '22% 18% 20%',
  document: '6px 10px 20%',
  terminator: '6px 20px',
  arrow_right: '24% 24% 24% 10px',
  callout: '6px 10px 28%',
  actor: '0 0 0',
};
