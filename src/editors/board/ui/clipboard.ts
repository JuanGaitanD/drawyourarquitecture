import type { BoardEdge, BoardNode } from '../model/board';
import { sortParentsFirst, toAbsolute } from '../model/geometry';
import { toFlowchart } from '../model/mermaid';
import { validateBoardContent } from '../model/validate';
import { cleanEdges, cleanNodes } from '../store/boardStore';

// Portapapeles del sistema para copiar/pegar entre pestañas. Copiar escribe dos formatos: el propio
// (`application/x-dya+json`, como «web custom format» de Chrome: solo lo leen páginas que lo piden) y texto Mermaid
// (lo que ve cualquier otra aplicación). Pegar lee el propio y, si no está, intenta Mermaid. Sin Clipboard API o
// sin permiso, el llamante usa su copia en memoria. Sin React: se prueba en Node con un portapapeles falso.

export const DYA_CLIP_TYPE = 'application/x-dya+json';
const WEB_TYPE = `web ${DYA_CLIP_TYPE}`;
const MAX_CLIP_BYTES = 4 * 1024 * 1024;

/** Lo copiado: autocontenido (los raíz con posición absoluta y sin `parentId`; solo aristas entre lo copiado). */
export interface ClipPayload {
  format: 'dya-clipboard';
  version: 1;
  nodes: BoardNode[];
  edges: BoardEdge[];
}

/** La selección con sus descendientes y las aristas internas, sin estado de runtime. */
export function clipFromSelection(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  ids: readonly string[],
): ClipPayload {
  const included = new Set(ids);
  for (const n of sortParentsFirst(nodes)) if (n.parentId && included.has(n.parentId)) included.add(n.id);
  const picked = sortParentsFirst(cleanNodes(nodes.filter((n) => included.has(n.id))));
  const clipNodes = picked.map((n) => {
    if (n.parentId && included.has(n.parentId)) return n;
    const { parentId: _p, ...root } = n;
    return { ...root, position: toAbsolute(n, nodes) } as BoardNode;
  });
  const clipEdges = cleanEdges(edges.filter((e) => included.has(e.source) && included.has(e.target)));
  return { format: 'dya-clipboard', version: 1, nodes: clipNodes, edges: clipEdges };
}

/** Texto Mermaid de lo copiado (frames como `subgraph`; stickies, textos e iconos se pierden). */
export const clipMermaid = (c: ClipPayload): string =>
  toFlowchart({ schemaVersion: 1, nodes: c.nodes, edges: c.edges, viewport: { x: 0, y: 0, zoom: 1 } });

/** Lee y valida lo que viene de fuera (nunca se confía en el portapapeles). `null` si no es nuestro o no vale. */
export function parseClip(text: string): Pick<ClipPayload, 'nodes' | 'edges'> | null {
  if (text.length > MAX_CLIP_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const c = raw as Partial<ClipPayload> | null;
  if (!c || c.format !== 'dya-clipboard' || c.version !== 1 || !Array.isArray(c.nodes) || !Array.isArray(c.edges))
    return null;
  const v = validateBoardContent({
    schemaVersion: 1,
    nodes: c.nodes,
    edges: c.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  return v.ok && v.value.nodes.length > 0 ? { nodes: v.value.nodes, edges: v.value.edges } : null;
}

type Api = Pick<Clipboard, 'read' | 'write' | 'readText' | 'writeText'>;
const system = (): Api | undefined => (typeof navigator === 'undefined' ? undefined : navigator.clipboard);

/**
 * Escribe en el portapapeles del sistema. `'full'`: formato propio + Mermaid; `'text'`: el navegador no admite el
 * formato propio y solo quedó el Mermaid; `'none'`: no se pudo escribir.
 */
export async function writeSystemClipboard(
  clip: ClipPayload,
  api: Api | undefined = system(),
  Item: typeof ClipboardItem | undefined = typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem,
): Promise<'full' | 'text' | 'none'> {
  if (!api) return 'none';
  const mermaid = clipMermaid(clip);
  try {
    if (!Item) throw new Error('sin ClipboardItem');
    await api.write([
      new Item({
        [WEB_TYPE]: new Blob([JSON.stringify(clip)], { type: WEB_TYPE }),
        'text/plain': new Blob([mermaid], { type: 'text/plain' }),
      }),
    ]);
    return 'full';
  } catch {
    try {
      await api.writeText(mermaid);
      return 'text';
    } catch {
      return 'none';
    }
  }
}

export type SystemRead =
  | { kind: 'dya'; clip: Pick<ClipPayload, 'nodes' | 'edges'> }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
  /** Sin API o sin permiso: no se sabe qué hay. */
  | { kind: 'unavailable' };

/** Lee el portapapeles del sistema: primero el formato propio y, si no, el texto. */
export async function readSystemClipboard(api: Api | undefined = system()): Promise<SystemRead> {
  if (!api) return { kind: 'unavailable' };
  try {
    for (const item of await api.read()) {
      if (item.types.includes(WEB_TYPE)) {
        const clip = parseClip(await (await item.getType(WEB_TYPE)).text());
        if (clip) return { kind: 'dya', clip };
      }
    }
    const text = await api.readText();
    return text ? { kind: 'text', text } : { kind: 'empty' };
  } catch {
    return { kind: 'unavailable' };
  }
}
