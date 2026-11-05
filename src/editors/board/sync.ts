import type { ContentMerger, ContentRecord } from '@/application/ports';
import { decode, encode } from '@/domain/codec';
import type { BoardContent, BoardEdge, BoardNode, Viewport } from './model/board';
import { canon, mergeBoards } from './model/merge';
import { validateBoardContent } from './model/validate';
import type { BoardStore } from './store/boardStore';
import { cleanEdges, cleanNodes } from './store/boardStore';

function parse(data: string): BoardContent | null {
  try {
    const r = validateBoardContent(decode<unknown>(data));
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

const byId = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));

const sameView = (a: Viewport, b: Viewport) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/**
 * Igualdad semántica de dos contenidos codificados: mismos nodos y aristas (sin mirar el orden) y mismo viewport:
 * hacer solo pan o zoom es un cambio que se guarda. El viewport ajeno no ensucia: `onRemote` entrega el contenido
 * remoto con el viewport propio.
 */
export function boardSame(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  return (
    !!x &&
    !!y &&
    sameView(x.viewport, y.viewport) &&
    canon(byId(x.nodes)) === canon(byId(y.nodes)) &&
    canon(byId(x.edges)) === canon(byId(y.edges))
  );
}

/** Conserva el objeto local cuando el elemento fusionado es igual (así no se pierde selección ni medida). */
function reuse<T extends BoardNode | BoardEdge>(local: readonly T[], merged: readonly T[], clean: (x: T[]) => T[]): T[] {
  const cur = new Map(local.map((e) => [e.id, e]));
  const cleaned = new Map(clean([...local]).map((e) => [e.id, e]));
  return merged.map((m) => {
    const c = cur.get(m.id);
    if (!c) return m;
    if (canon(cleaned.get(m.id)) === canon(m)) return c;
    // Cambió en remoto: se toma lo nuevo y se conserva lo que es solo de esta pestaña (selección, medida).
    const { selected, measured } = c as { selected?: boolean; measured?: unknown };
    return { ...m, ...(selected ? { selected } : {}), ...(measured ? { measured } : {}) } as T;
  });
}

/**
 * Sincronización de un board abierto con el servidor. `base` es el último contenido del servidor que se conoce (el
 * cargado, el recibido o el que esta pestaña escribió): la fusión a tres bandas compara local y remoto contra él.
 * `merge` fusiona el estado VIVO del store (no el texto encolado, que puede ser anterior a lo último recibido).
 * ponytail: la fusión recorre todo el board en cada cambio remoto (O(n)); con miles de nodos, diferenciar por id.
 */
export function createBoardSync(
  store: BoardStore,
  initial: BoardContent,
  initialRevision: number,
) {
  let base: BoardContent = initial;
  let view: Viewport = initial.viewport;
  /** Viewport del último contenido que esta pestaña cargó o escribió (el que el servidor tiene de ella). */
  let savedView: Viewport = initial.viewport;
  let seen = initialRevision;

  /** Un solo camino: lo usa el reintento de la transacción de guardado. */
  const merge: ContentMerger = (_local, remote) => {
    const r = parse(remote);
    if (!r) throw new Error('No se pudo fusionar: el contenido del servidor no es válido.');
    const merged = mergeBoards(store.getState().toContent(view), r, base);
    const ok = validateBoardContent(merged);
    if (!ok.ok) throw new Error(`La fusión no es válida: ${ok.error}`);
    return encode(ok.value);
  };

  return {
    merge,
    setViewport(v: Viewport): void {
      view = v;
    },

    /**
     * Llega el contenido del servidor: se fusiona con lo local y se aplica al store sin tocar el historial.
     * Devuelve `null` si ya estaba visto (eco de lo propio o instantánea antigua) y, si no, el contenido que la cola
     * debe tomar como lo último del servidor: el remoto con el viewport propio (el pan de otra persona no es un
     * cambio pendiente de esta pestaña).
     */
    onRemote(record: ContentRecord): string | null {
      if (record.revision <= seen) return null;
      const remote = parse(record.data);
      if (!remote) return null;
      const s0 = store.getState();
      const merged = mergeBoards(s0.toContent(view), remote, base);
      // Una fusión inválida no se aplica ni avanza la base: el editor nunca recibe una jerarquía rota.
      if (!validateBoardContent(merged).ok) return null;
      seen = record.revision;
      base = remote;
      const nodes = reuse(s0.nodes, merged.nodes, cleanNodes);
      const edges = reuse(s0.edges, merged.edges, cleanEdges);
      const same =
        nodes.length === s0.nodes.length &&
        edges.length === s0.edges.length &&
        nodes.every((n, i) => n === s0.nodes[i]) &&
        edges.every((e, i) => e === s0.edges[i]);
      if (!same) s0.applyRemote(nodes, edges);
      return sameView(remote.viewport, savedView) ? record.data : encode({ ...remote, viewport: savedView });
    },

    /**
     * Tras guardar sin fusión, lo escrito pasa a ser la base. Si el servidor fusionó algo ajeno (`merged`), la base
     * no se toca: el local aún no lo tiene y lo recibirá en la instantánea de esa revisión (`onRemote`).
     */
    onSaved(r: { data: string; revision: number; merged?: string }): void {
      const saved = parse(r.data);
      if (saved) savedView = saved.viewport;
      if (r.merged !== undefined) return;
      if (saved && r.revision > seen) {
        base = saved;
        seen = r.revision;
      }
    },
  };
}

export type BoardSync = ReturnType<typeof createBoardSync>;
