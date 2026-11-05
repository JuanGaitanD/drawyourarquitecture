import type { BoardContent, BoardEdge, BoardNode } from './board';
import { sortParentsFirst, toAbsolute, toRelative } from './geometry';

// Fusión a tres bandas por elemento para la colaboración en tiempo real (docs/plan-fases-2-3.md · Fase 2).
// `base` es el último contenido del servidor que esta pestaña conoce. Lo que difiere de `base` en un lado es un
// cambio de ese lado (alta, edición o borrado, sin contadores ni tombstones). Si solo cambió el remoto se toma el
// remoto; si solo cambió el local, el local; si cambió en los dos, gana el local.

type El = BoardNode | BoardEdge;

/** JSON con las claves ordenadas: dos elementos iguales comparan igual aunque difiera el orden de sus claves. */
export function canon(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function mergeList<T extends El>(local: readonly T[], remote: readonly T[], base: readonly T[]): T[] {
  const L = new Map(local.map((e) => [e.id, e]));
  const R = new Map(remote.map((e) => [e.id, e]));
  const B = new Map(base.map((e) => [e.id, canon(e)]));
  const out: T[] = [];
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id);
    const r = R.get(id);
    const b = B.get(id);
    const remoteChanged = (r ? canon(r) : undefined) !== b;
    const picked = !remoteChanged ? l : (l ? canon(l) : undefined) === b ? r : l;
    if (picked) out.push(picked);
  }
  return out;
}

/**
 * Fusiona el estado local con el remoto contra `base`. Quita lo que queda colgando: aristas sin extremo y nodos
 * cuyo padre se borró (pasan a la raíz conservando su posición absoluta). El viewport es el local.
 */
export function mergeBoards(local: BoardContent, remote: BoardContent, base: BoardContent | null): BoardContent {
  const items = mergeList(local.nodes, remote.nodes, base?.nodes ?? []);
  const ids = new Set(items.map((n) => n.id));
  const everyNode = new Map([...remote.nodes, ...local.nodes].map((n) => [n.id, n] as const));
  const finalNodes = new Map(items.map((n) => [n.id, n] as const));
  const nodes = items.map((n) => {
    if (!n.parentId || ids.has(n.parentId)) return n;
    const { parentId: _p, ...rest } = n;
    return { ...rest, position: toRelative(toAbsolute(n, everyNode), undefined, finalNodes) } as BoardNode;
  });
  const edges = mergeList(local.edges, remote.edges, base?.edges ?? []).filter(
    (e) => ids.has(e.source) && ids.has(e.target),
  );
  return { schemaVersion: 1, nodes: sortParentsFirst(nodes), edges, viewport: local.viewport };
}
