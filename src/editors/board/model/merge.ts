import type { BoardContent, BoardEdge, BoardNode, SyncInfo } from './board';
import { sortParentsFirst, toAbsolute, toRelative } from './geometry';

// Fusión por elemento para la colaboración en tiempo real (docs/plan-fases-2-3.md · Fase 2).
// Cada nodo y arista tiene un contador `v` (en `content.sync.v`); un borrado es un tombstone en `sync.dead`.
// El local no lleva contadores: `stamp` los calcula comparando con la `base` (el último contenido del servidor
// que se conoce) y `mergeStamped` decide por elemento: gana el `v` mayor; en empate, el JSON mayor (así los dos
// lados convergen al mismo resultado) y el borrado gana al empate con una edición.

/** Los tombstones se purgan al guardar cuando tienen más de un minuto. */
export const TOMBSTONE_TTL_MS = 60_000;

type El = BoardNode | BoardEdge;

/** JSON con las claves ordenadas: dos elementos iguales comparan igual aunque difiera el orden de sus claves. */
export function canon(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

const elements = (c: BoardContent): El[] => [...c.nodes, ...c.edges];

/** Marca lo que el local cambió respecto a `base`: `v + 1` en lo nuevo o modificado, tombstone en lo borrado. */
export function stamp(local: BoardContent, base: BoardContent | null, now: number): BoardContent {
  const bv = base?.sync?.v ?? {};
  const bd = base?.sync?.dead ?? {};
  const before = new Map<string, string>();
  if (base) for (const e of elements(base)) before.set(e.id, canon(e));

  const v: Record<string, number> = {};
  const dead: Record<string, { v: number; at: number }> = {};
  const alive = new Set<string>();
  for (const e of elements(local)) {
    alive.add(e.id);
    const b = before.get(e.id);
    const ver = b === undefined ? (bd[e.id]?.v ?? 0) + 1 : b === canon(e) ? (bv[e.id] ?? 0) : (bv[e.id] ?? 0) + 1;
    if (ver > 0) v[e.id] = ver;
  }
  for (const id of before.keys()) if (!alive.has(id)) dead[id] = { v: (bv[id] ?? 0) + 1, at: now };
  for (const [id, d] of Object.entries(bd)) if (!alive.has(id) && !dead[id]) dead[id] = d;
  return { ...local, sync: purge({ v, dead }, now) };
}

export function purge(s: SyncInfo, now: number): SyncInfo {
  return {
    v: s.v,
    dead: Object.fromEntries(Object.entries(s.dead).filter(([, d]) => now - d.at <= TOMBSTONE_TTL_MS)),
  };
}

interface Pick1<T> {
  el: T;
  v: number;
}

/** Elige entre dos versiones del mismo elemento: `v` mayor; en empate, el JSON mayor (determinista). */
function pick<T extends El>(a: Pick1<T> | undefined, b: Pick1<T> | undefined): Pick1<T> | undefined {
  if (!a || !b) return a ?? b;
  if (a.v !== b.v) return a.v > b.v ? a : b;
  return canon(a.el) >= canon(b.el) ? a : b;
}

function mergeList<T extends El>(
  a: BoardContent,
  b: BoardContent,
  pickList: (c: BoardContent) => T[],
): { items: T[]; v: Record<string, number>; dead: Record<string, { v: number; at: number }> } {
  const index = (c: BoardContent) => new Map(pickList(c).map((e) => [e.id, { el: e, v: c.sync?.v[e.id] ?? 0 }]));
  const ia = index(a);
  const ib = index(b);
  const dead: Record<string, { v: number; at: number }> = {};
  for (const src of [a.sync?.dead, b.sync?.dead])
    for (const [id, d] of Object.entries(src ?? {})) if (!dead[id] || dead[id].v < d.v) dead[id] = d;

  const items: T[] = [];
  const v: Record<string, number> = {};
  const seen = new Set<string>();
  for (const id of [...ia.keys(), ...ib.keys()]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const win = pick(ia.get(id), ib.get(id))!;
    const d = dead[id];
    if (d && d.v >= win.v) continue; // el borrado gana al empate
    delete dead[id];
    items.push(win.el);
    if (win.v > 0) v[id] = win.v;
  }
  return { items, v, dead };
}

/**
 * Fusión de dos contenidos ya marcados (con `sync`). Quita lo que queda colgando: aristas sin extremo y nodos
 * cuyo padre se borró (pasan a la raíz conservando su posición absoluta).
 */
export function mergeStamped(a: BoardContent, b: BoardContent): BoardContent {
  const n = mergeList(a, b, (c) => c.nodes);
  const e = mergeList(a, b, (c) => c.edges);
  const ids = new Set(n.items.map((x) => x.id));
  const everyNode = new Map([...a.nodes, ...b.nodes, ...n.items].map((x) => [x.id, x] as const));
  const finalNodes = new Map(n.items.map((x) => [x.id, x] as const));
  const nodes = n.items.map((x) => {
    if (!x.parentId || ids.has(x.parentId)) return x;
    const { parentId: _p, ...rest } = x;
    return { ...rest, position: toRelative(toAbsolute(x, everyNode), undefined, finalNodes) } as BoardNode;
  });
  const edges = e.items.filter((x) => ids.has(x.source) && ids.has(x.target));
  return {
    schemaVersion: 1,
    nodes: sortParentsFirst(nodes),
    edges,
    viewport: a.viewport,
    sync: { v: { ...n.v, ...e.v }, dead: { ...n.dead, ...e.dead } },
  };
}

/** Fusiona el estado local (sin marcar) con el remoto: marca el local contra `base` y decide por elemento. */
export function mergeBoards(
  local: BoardContent,
  remote: BoardContent,
  base: BoardContent | null,
  now = Date.now(),
): BoardContent {
  return mergeStamped(stamp(local, base, now), remote);
}
