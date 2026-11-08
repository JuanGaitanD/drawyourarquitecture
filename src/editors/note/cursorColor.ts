// Excalidraw 0.18.1 ignora `Collaborator.color` al pintar cursores, etiquetas y avatares: calcula el color con
// `hsl(hue, 100%, 83%)` y `hue = (|hash(collaborator.id)| % 37) * 10`. La única entrada que controlamos es el `id`,
// así que se elige uno cuyo matiz sea el más cercano al del avatar (saturación y luminosidad son las de Excalidraw).

/** Misma función que `hashToInteger` de Excalidraw (aritmética de JS incluida: no se normaliza a 32 bits). */
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
  return h;
}
const bucket = (id: string) => Math.abs(hash(id)) % 37;

/** Matiz (0–360) de un `#rrggbb`. */
export function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const cache = new Map<string, string>();

/** `id` de colaborador que hace que Excalidraw pinte el matiz de `color`. Estable por color. */
export function cursorIdFor(color: string): string {
  let id = cache.get(color);
  if (id) return id;
  const want = Math.round(hueOf(color) / 10) % 37;
  for (let n = 0; !id; n++) if (bucket(`dya-${n}`) === want) id = `dya-${n}`;
  cache.set(color, id);
  return id;
}
