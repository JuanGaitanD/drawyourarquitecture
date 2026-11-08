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

/**
 * Igualdad profunda sin orden de claves y sin serializar: lo que comparte referencia es igual de inmediato (los
 * elementos que no cambian comparten `data`, `style` y `position`), así que cuesta lo que cambió, no el tamaño del
 * board. Una clave con valor `undefined` cuenta como ausente (igual que en JSON).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const A = a as Record<string, unknown>;
  const B = b as Record<string, unknown>;
  const ka = Object.keys(A).filter((k) => A[k] !== undefined);
  if (ka.length !== Object.keys(B).filter((k) => B[k] !== undefined).length) return false;
  return ka.every((k) => deepEqual(A[k], B[k]));
}

/** Ids que difieren entre dos listas (altas, bajas y ediciones), por id y con `deepEqual`. */
export function diffById<T extends { id: string }>(a: readonly T[], b: readonly T[]): Set<string> {
  const A = new Map(a.map((e) => [e.id, e]));
  const out = new Set<string>();
  for (const e of b) {
    const x = A.get(e.id);
    if (!x || !deepEqual(x, e)) out.add(e.id);
    A.delete(e.id);
  }
  for (const id of A.keys()) out.add(id);
  return out;
}

/** Misma entrada (por id) en las dos o ausente en las dos. */
const sameEntry = (x: unknown, y: unknown) => (x === undefined || y === undefined ? x === y : deepEqual(x, y));

function mergeList<T extends El>(local: readonly T[], remote: readonly T[], base: readonly T[]): T[] {
  const L = new Map(local.map((e) => [e.id, e]));
  const R = new Map(remote.map((e) => [e.id, e]));
  const B = new Map(base.map((e) => [e.id, e]));
  const out: T[] = [];
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id);
    const r = R.get(id);
    const b = B.get(id);
    const picked = sameEntry(r, b) ? l : sameEntry(l, b) ? r : l;
    if (picked) out.push(picked);
  }
  return out;
}

/**
 * Dos jerarquías válidas pueden fusionarse en un ciclo (A dentro de B en un lado y B dentro de A en el otro).
 * Se rompe de forma determinista: el miembro de id menor pasa a la raíz y el resto cuelga de él en el mismo orden;
 * cada miembro conserva la posición absoluta que quiso su autor (su posición relativa sobre la absoluta que su
 * padre tenía en `base`). Los descendientes de los miembros se mueven con ellos.
 */
function breakCycles(nodes: BoardNode[], base: BoardContent | null): BoardNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const done = new Set<string>();
  const cycles: string[][] = [];
  for (const n of nodes) {
    const path: string[] = [];
    let cur: BoardNode | undefined = n;
    while (cur && !done.has(cur.id)) {
      const at = path.indexOf(cur.id);
      if (at >= 0) {
        cycles.push(path.slice(at));
        break;
      }
      path.push(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    path.forEach((id) => done.add(id));
  }
  if (!cycles.length) return nodes;
  const baseById = new Map((base?.nodes ?? []).map((n) => [n.id, n] as const));
  const out = new Map(byId);
  for (const cycle of cycles) {
    const intended = new Map(
      cycle.map((id) => {
        const n = byId.get(id)!;
        const bp = n.parentId ? baseById.get(n.parentId) : undefined;
        const pa = bp ? toAbsolute(bp, baseById) : toAbsolute(byId.get(n.parentId!)!, byId);
        return [id, { x: n.position.x + pa.x, y: n.position.y + pa.y }] as const;
      }),
    );
    const head = [...cycle].sort()[0]!;
    const { parentId: _p, ...rest } = byId.get(head)!;
    out.set(head, { ...rest, position: intended.get(head)! } as BoardNode);
    let parent = head;
    for (let i = 1; i < cycle.length; i++) {
      const id = cycle.find((c) => c !== head && byId.get(c)!.parentId === parent && !done.has(`fixed:${c}`))!;
      done.add(`fixed:${id}`);
      const pa = toAbsolute(out.get(parent)!, out);
      const a = intended.get(id)!;
      out.set(id, { ...byId.get(id)!, position: { x: a.x - pa.x, y: a.y - pa.y } });
      parent = id;
    }
  }
  return nodes.map((n) => out.get(n.id)!);
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
  return { schemaVersion: 1, nodes: sortParentsFirst(breakCycles(nodes, base)), edges, viewport: local.viewport };
}
