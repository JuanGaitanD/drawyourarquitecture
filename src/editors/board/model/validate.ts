import { EDGE_PATHS, ICONS, NODE_KINDS, SHAPES, type BoardContent, type BoardEdge, type BoardNode } from './board';
import { sortParentsFirst } from './geometry';

// Invariante 8: se aplica a import JSON, plantillas, Mermaid y carga.

export const MAX_NODES = 5000;
export const MAX_EDGES = 10000;

export type ValidationResult = { ok: true; value: BoardContent } | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const STYLE_STRINGS = ['fill', 'stroke', 'textColor'] as const;
const STYLE_NUMBERS = ['strokeWidth', 'opacity', 'fontSize'] as const;
const fail = (error: string): ValidationResult => ({ ok: false, error });

/** Busca el primer número no finito (NaN, ±Infinity) dentro de un valor JSON-like. */
function badNumberPath(x: unknown, path: string, depth = 0): string | null {
  if (typeof x === 'number') return Number.isFinite(x) ? null : path;
  if (depth > 12 || typeof x !== 'object' || x === null) return null;
  for (const [k, v] of Object.entries(x)) {
    const p = badNumberPath(v, `${path}.${k}`, depth + 1);
    if (p) return p;
  }
  return null;
}

/** Valida un contenido de board desconocido. Devuelve una copia con los padres antes que los hijos. */
export function validateBoardContent(x: unknown): ValidationResult {
  if (!isObj(x)) return fail('El contenido no es un objeto.');
  if (x.schemaVersion !== 1) return fail(`schemaVersion no admitido: ${String(x.schemaVersion)}.`);
  if (!Array.isArray(x.nodes) || !Array.isArray(x.edges)) return fail('Faltan los arrays nodes y edges.');
  if (x.nodes.length > MAX_NODES) return fail(`Demasiados nodos (${x.nodes.length}; máximo ${MAX_NODES}).`);
  if (x.edges.length > MAX_EDGES) return fail(`Demasiadas aristas (${x.edges.length}; máximo ${MAX_EDGES}).`);

  const vp = x.viewport;
  if (!isObj(vp) || !isNum(vp.x) || !isNum(vp.y) || !isNum(vp.zoom) || vp.zoom <= 0) {
    return fail('El viewport no es válido.');
  }

  const ids = new Set<string>();
  for (const [i, n] of x.nodes.entries()) {
    if (!isObj(n) || typeof n.id !== 'string' || n.id === '') return fail(`Nodo ${i}: falta el id.`);
    if (ids.has(n.id)) return fail(`Id de nodo duplicado: ${n.id}.`);
    ids.add(n.id);
    const data = n.data;
    if (
      !isObj(data) ||
      typeof data.kind !== 'string' ||
      !(NODE_KINDS as readonly string[]).includes(data.kind)
    ) {
      return fail(`Nodo ${n.id}: data.kind no válido.`);
    }
    if (n.type !== data.kind)
      return fail(`Nodo ${n.id}: type (${String(n.type)}) distinto de data.kind (${data.kind}).`);
    if (typeof data.label !== 'string' || !isObj(data.style))
      return fail(`Nodo ${n.id}: faltan label o style.`);
    if (data.kind === 'shape' && !(SHAPES as readonly unknown[]).includes(data.shape))
      return fail(`Nodo ${n.id}: data.shape no válido (${String(data.shape)}).`);
    if (data.kind === 'icon' && !(ICONS as readonly unknown[]).includes(data.icon))
      return fail(`Nodo ${n.id}: data.icon no válido (${String(data.icon)}).`);
    if (data.kind === 'image' && typeof data.fileId !== 'string') return fail(`Nodo ${n.id}: falta data.fileId.`);
    const pos = n.position;
    if (!isObj(pos) || !isNum(pos.x) || !isNum(pos.y)) return fail(`Nodo ${n.id}: posición no finita.`);
    const bad = badNumberPath(n, `nodes[${i}]`);
    if (bad) return fail(`Número no finito en ${bad}.`);
    const st = data.style;
    for (const k of STYLE_STRINGS)
      if (typeof st[k] !== 'string') return fail(`Nodo ${n.id}: style.${k} debe ser texto.`);
    for (const k of STYLE_NUMBERS)
      if (!isNum(st[k])) return fail(`Nodo ${n.id}: style.${k} debe ser un número finito.`);
  }
  for (const n of x.nodes as BoardNode[]) {
    if (n.parentId === undefined) continue;
    if (typeof n.parentId !== 'string' || !ids.has(n.parentId))
      return fail(`Nodo ${n.id}: parentId inexistente (${String(n.parentId)}).`);
  }
  const byId = new Map((x.nodes as BoardNode[]).map((n) => [n.id, n]));
  for (const n of x.nodes as BoardNode[]) {
    const seen = new Set<string>([n.id]);
    for (
      let p = n.parentId ? byId.get(n.parentId) : undefined;
      p;
      p = p.parentId ? byId.get(p.parentId) : undefined
    ) {
      if (seen.has(p.id)) return fail(`parentId cíclico en el nodo ${n.id}.`);
      seen.add(p.id);
    }
  }

  const edgeIds = new Set<string>();
  for (const [i, e] of x.edges.entries()) {
    if (!isObj(e) || typeof e.id !== 'string' || e.id === '') return fail(`Arista ${i}: falta el id.`);
    if (edgeIds.has(e.id)) return fail(`Id de arista duplicado: ${e.id}.`);
    edgeIds.add(e.id);
    if (e.type !== 'labeled') return fail(`Arista ${e.id}: type debe ser «labeled».`);
    if (typeof e.source !== 'string' || typeof e.target !== 'string')
      return fail(`Arista ${e.id}: faltan source o target.`);
    if (!ids.has(e.source) || !ids.has(e.target))
      return fail(`Arista ${e.id}: apunta a un nodo que no existe.`);
    const d = e.data;
    if (!isObj(d) || !(EDGE_PATHS as readonly string[]).includes(d.path as string))
      return fail(`Arista ${e.id}: data.path no válido.`);
    const bad = badNumberPath(e, `edges[${i}]`);
    if (bad) return fail(`Número no finito en ${bad}.`);
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      nodes: sortParentsFirst(x.nodes as BoardNode[]),
      edges: x.edges as BoardEdge[],
      viewport: { x: vp.x, y: vp.y, zoom: vp.zoom },
    },
  };
}
