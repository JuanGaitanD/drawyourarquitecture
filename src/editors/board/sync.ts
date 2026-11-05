import type { ContentMerger, ContentRecord } from '@/application/ports';
import { decode, encode } from '@/domain/codec';
import type { BoardContent, BoardEdge, BoardNode, Viewport } from './model/board';
import { canon, mergeBoards, mergeStamped, purge, stamp } from './model/merge';
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

/** Fusión en la transacción de guardado: `local` y `remote` ya vienen marcados (llevan `sync`). */
export const mergeBoardData: ContentMerger = (local, remote) => {
  const l = parse(local);
  const r = parse(remote);
  if (!l || !r) throw new Error('No se pudo fusionar: el contenido no es válido.');
  const m = mergeStamped(l, r);
  return encode({ ...m, sync: purge(m.sync!, Date.now()) });
};

/** Conserva el objeto local cuando el elemento fusionado es igual (así no se pierde selección ni medida). */
function reuse<T extends BoardNode | BoardEdge>(local: readonly T[], merged: readonly T[], clean: (x: T[]) => T[]): T[] {
  const byId = new Map(local.map((e) => [e.id, e]));
  const cleaned = new Map(clean([...local]).map((e) => [e.id, e]));
  return merged.map((m) => {
    const cur = byId.get(m.id);
    if (!cur) return m;
    if (canon(cleaned.get(m.id)) === canon(m)) return cur;
    // Cambió en remoto: se toma lo nuevo y se conserva lo que es solo de esta pestaña (selección, medida).
    const { selected, measured } = cur as { selected?: boolean; measured?: unknown };
    return { ...m, ...(selected ? { selected } : {}), ...(measured ? { measured } : {}) } as T;
  });
}

/**
 * Sincronización de un board abierto con el servidor. `base` es el último contenido conocido del servidor (el
 * cargado, lo recibido o lo que se guardó): lo local se compara con él para saber qué cambió esta pestaña.
 * ponytail: la fusión recorre todo el board en cada cambio remoto (O(n)); con miles de nodos, diferenciar por `v`.
 */
export function createBoardSync(store: BoardStore, initial: BoardContent, initialRevision: number) {
  let base: BoardContent = initial;
  let seen = initialRevision;

  return {
    /** El contenido local marcado contra la base: es lo que se codifica y se guarda. */
    stamp: (content: BoardContent): BoardContent => stamp(content, base, Date.now()),

    /** Llega el contenido del servidor: se fusiona con lo local y se aplica al store sin tocar el historial. */
    onRemote(record: ContentRecord, viewport: Viewport): void {
      if (record.revision <= seen) return;
      seen = record.revision;
      const remote = parse(record.data);
      if (!remote) return;
      const local = store.getState().toContent(viewport);
      const merged = mergeBoards(local, remote, base, Date.now());
      base = remote;
      const s = store.getState();
      const nodes = reuse(s.nodes, merged.nodes, cleanNodes);
      const edges = reuse(s.edges, merged.edges, cleanEdges);
      const same =
        nodes.length === s.nodes.length &&
        edges.length === s.edges.length &&
        nodes.every((n, i) => n === s.nodes[i]) &&
        edges.every((e, i) => e === s.edges[i]);
      if (!same) s.applyRemote(nodes, edges);
    },

    /**
     * Tras guardar sin fusión, lo escrito pasa a ser la base. Si el servidor fusionó algo ajeno (`merged`), la base
     * no se toca: el local aún no lo tiene y lo recibirá en la instantánea de esa revisión (`onRemote`); poner la
     * fusión como base haría parecer que el local borró lo ajeno.
     */
    onSaved(r: { data: string; revision: number; merged?: string }): void {
      if (r.merged !== undefined) return;
      const saved = parse(r.data);
      if (saved && r.revision > seen) {
        base = saved;
        seen = r.revision;
      }
    },
  };
}

export type BoardSync = ReturnType<typeof createBoardSync>;
