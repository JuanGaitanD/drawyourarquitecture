import {
  emptyBoard,
  makeEdge,
  makeNode,
  type BoardContent,
  type BoardEdge,
  type BoardEdgeData,
  type BoardNode,
  type ShapeKind,
} from './board';
import { validateBoardContent } from './validate';

// Flowchart de Mermaid ⇄ BoardContent. TypeScript puro (sin React ni motores).
//
// Gramática admitida (plan · D):
//   directiva  flowchart|graph [TD|TB|LR|RL|BT]
//   nodos      A  A[t]  A(t)  A([t])  A{t}  A((t))  A[(t)]  (extras: A{{t}} hexágono, A[/t/] paralelogramo)
//   aristas    -->  ---  -.->  -.-  ==>  ===  con -->|t|  o  -- t -->  (también en cadena A --> B --> C)
//   subgraph   subgraph id[Título] … end  (anidables; los ids de subgraph valen como extremo de arista)
//   comentarios %% … ; los estilos (style, classDef, class, linkStyle, click, direction) se ignoran.

export type MermaidDirection = 'LR' | 'TB';

export type MermaidParseResult =
  | {
      ok: true;
      value: BoardContent;
      /** TD/TB/BT → 'TB'; LR/RL → 'LR'. Pensado para pasarlo a `autoLayout`. */
      direction: MermaidDirection;
    }
  | { ok: false; error: string; line?: number };

interface ShapeSyntax {
  open: string;
  close: string;
  shape: ShapeKind;
}
// Los delimitadores más largos primero: `((`, `([`, `[(` antes que `(` y `[`.
const SHAPES: readonly ShapeSyntax[] = [
  { open: '((', close: '))', shape: 'ellipse' },
  { open: '([', close: '])', shape: 'terminator' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[', close: ']', shape: 'rectangle' },
  { open: '(', close: ')', shape: 'round_rectangle' },
  { open: '{', close: '}', shape: 'rhombus' },
];

const ID = /[\p{L}\p{N}_]+/uy;
const IGNORED = /^(style|classDef|class|linkStyle|click|direction)\b/;
const DIRECTIONS: Record<string, MermaidDirection> = { TD: 'TB', TB: 'TB', BT: 'TB', LR: 'LR', RL: 'LR' };

// Aristas simples: `A --> B`, `A ---|t| B`. Grupo 1 = flecha; grupo 2 = etiqueta.
const EDGE_SIMPLE = /(-->|---|-\.->|-\.-|==>|===)(?:\s*\|([^|]*)\|)?/y;
// Aristas con texto en medio: `-- t -->`, `-. t .->`, `== t ==>`. Grupo 1 = abre; 2 = texto; 3 = cierra.
const EDGE_TEXT = /(--|-\.|==)\s+(.+?)\s+(-->|---|\.->|\.-|==>|===)/y;

const arrowStyle = (arrow: string): Pick<BoardEdgeData, 'dashed' | 'markerEnd' | 'width'> => ({
  dashed: arrow.includes('.'),
  markerEnd: arrow.endsWith('>'),
  width: arrow.startsWith('=') || arrow.endsWith('==') ? 4 : 2,
});

const unquote = (t: string): string => {
  const s = t.trim();
  const q = s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
  return q.replace(/<br\s*\/?>/gi, '\n').replace(/#quot;/g, '"');
};

class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

/** Parte una línea en sentencias por `;`, respetando comillas. */
function splitStatements(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ';' && !inQuote) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseFlowchart(src: string): MermaidParseResult {
  try {
    return build(src);
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: `Línea ${e.line}: ${e.message}`, line: e.line };
    throw e;
  }
}

function build(src: string): MermaidParseResult {
  const lines = (src.charCodeAt(0) === 0xfeff ? src.slice(1) : src).split(/\r\n|\r|\n/);
  const nodes = new Map<string, BoardNode>(); // id de Mermaid → nodo (formas y frames)
  const frameIds = new Set<string>(); // ids de Mermaid que son subgraph
  const edges: BoardEdge[] = [];
  const stack: { mid: string; node: BoardNode; line: number }[] = [];
  let direction: MermaidDirection | null = null;
  let seq = 0;

  // Posiciones provisionales en rejilla: la persona las ordena con `autoLayout`.
  const place = (): { x: number; y: number } => {
    const i = seq++;
    return { x: (i % 4) * 220, y: Math.floor(i / 4) * 140 };
  };

  const declare = (mid: string, line: number, text?: string, shape?: ShapeKind): BoardNode => {
    if (frameIds.has(mid)) {
      if (text !== undefined) throw new ParseError(`«${mid}» ya es un subgraph.`, line);
      return nodes.get(mid) as BoardNode;
    }
    let n = nodes.get(mid);
    if (!n) {
      n = makeNode('shape', place(), { label: mid, shape: 'rectangle' });
      nodes.set(mid, n);
    }
    // Como en Mermaid: pertenece al subgraph donde se la nombra (si aún no tiene otro).
    const top = stack[stack.length - 1];
    if (top && !n.parentId) n.parentId = top.node.id;
    if (text !== undefined) n.data = { ...n.data, label: text, shape: shape ?? 'rectangle' };
    return n;
  };

  /** Lee `id` o `id<forma>` desde `pos`; devuelve el nodo y la posición siguiente. */
  const readNode = (s: string, pos: number, line: number): [BoardNode, number] => {
    ID.lastIndex = pos;
    const m = ID.exec(s);
    if (!m) throw new ParseError(`se esperaba un nodo en «${s.slice(pos, pos + 12)}».`, line);
    const mid = m[0];
    let p = pos + mid.length;
    const sh = SHAPES.find((x) => s.startsWith(x.open, p));
    if (!sh) return [declare(mid, line), p];
    p += sh.open.length;
    let text: string;
    if (s[p] === '"') {
      const endQ = s.indexOf('"', p + 1);
      if (endQ < 0) throw new ParseError('comillas sin cerrar.', line);
      text = s.slice(p, endQ + 1);
      p = endQ + 1;
      if (!s.startsWith(sh.close, p))
        throw new ParseError(`falta «${sh.close}» tras el texto de ${mid}.`, line);
    } else {
      const end = s.indexOf(sh.close, p);
      if (end < 0) throw new ParseError(`falta «${sh.close}» en el nodo ${mid}.`, line);
      text = s.slice(p, end);
      p = end;
    }
    return [declare(mid, line, unquote(text), sh.shape), p + sh.close.length];
  };

  const readEdge = (s: string, pos: number): [Partial<BoardEdgeData>, number] | null => {
    EDGE_SIMPLE.lastIndex = pos;
    const a = EDGE_SIMPLE.exec(s);
    if (a) {
      const label = a[2] === undefined ? undefined : unquote(a[2]);
      return [{ ...arrowStyle(a[1] as string), ...(label ? { label } : {}) }, pos + a[0].length];
    }
    EDGE_TEXT.lastIndex = pos;
    const b = EDGE_TEXT.exec(s);
    if (b) {
      const label = unquote(b[2] as string);
      return [
        { ...arrowStyle((b[1] as string) + (b[3] as string)), ...(label ? { label } : {}) },
        pos + b[0].length,
      ];
    }
    return null;
  };

  const statement = (s: string, line: number): void => {
    if (/^subgraph\b/.test(s)) {
      const rest = s.slice('subgraph'.length).trim();
      if (!rest) throw new ParseError('subgraph sin nombre.', line);
      ID.lastIndex = 0;
      const m = ID.exec(rest);
      let mid: string;
      let title: string;
      const tail = m ? rest.slice(m[0].length).trimStart() : '';
      const bracket = SHAPES.find((x) => tail.startsWith(x.open) && tail.endsWith(x.close));
      if (m && bracket) {
        mid = m[0];
        title = unquote(tail.slice(bracket.open.length, tail.length - bracket.close.length));
      } else if (m && m[0] === rest) {
        mid = rest;
        title = rest;
      } else {
        // `subgraph Mi título con espacios`: el título es todo; el id se genera.
        title = unquote(rest);
        mid = `subgraph_${frameIds.size + 1}`;
      }
      if (nodes.has(mid)) throw new ParseError(`el id «${mid}» ya existe.`, line);
      const frame = makeNode('frame', place(), { label: title });
      const parent = stack[stack.length - 1];
      if (parent) frame.parentId = parent.node.id;
      nodes.set(mid, frame);
      frameIds.add(mid);
      stack.push({ mid, node: frame, line });
      return;
    }
    if (s === 'end') {
      if (!stack.pop()) throw new ParseError('«end» sin subgraph que cerrar.', line);
      return;
    }
    if (IGNORED.test(s)) return;
    if (s.includes('&')) throw new ParseError('«&» (varios nodos en una arista) no está soportado.', line);

    let [prev, pos] = readNode(s, 0, line);
    for (;;) {
      while (s[pos] === ' ') pos++;
      if (pos >= s.length) return;
      const e = readEdge(s, pos);
      if (!e) throw new ParseError(`no se entiende «${s.slice(pos, pos + 16)}».`, line);
      pos = e[1];
      while (s[pos] === ' ') pos++;
      const [next, after] = readNode(s, pos, line);
      edges.push(makeEdge(prev.id, next.id, e[0]));
      prev = next;
      pos = after;
    }
  };

  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    const text = raw.trim();
    if (!text || text.startsWith('%%')) continue;
    for (const s of splitStatements(text)) {
      if (direction !== null) {
        statement(s, line);
        continue;
      }
      const m = /^(?:flowchart|graph)(?:\s+(\S+))?$/.exec(s);
      if (!m) throw new ParseError('se esperaba «flowchart» o «graph» (p. ej. «flowchart LR»).', line);
      const d = m[1] === undefined ? 'TB' : DIRECTIONS[m[1].toUpperCase()];
      if (!d) throw new ParseError(`dirección no válida: «${m[1]}» (usa TD, TB, LR, RL o BT).`, line);
      direction = d;
    }
  }

  if (direction === null) throw new ParseError('el texto está vacío.', 1);
  const open = stack[stack.length - 1];
  if (open) throw new ParseError('subgraph sin «end».', open.line);

  const v = validateBoardContent({ ...emptyBoard(), nodes: [...nodes.values()], edges });
  return v.ok ? { ok: true, value: v.value, direction } : { ok: false, error: v.error };
}

// ---------------------------------------------------------------------------------------------

const OPEN_CLOSE = new Map(SHAPES.map((x) => [x.shape, x]));
const RESERVED = new Set(['end', 'subgraph', 'graph', 'flowchart', 'direction', 'style', 'class', 'click']);
const SAFE_TEXT = /^[\p{L}\p{N} _.,:!?+-]+$/u;
// Ids cortos y legibles; los nanoid (21 caracteres) pasan a n1, n2…
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]{0,19}$/;

const quoteIfNeeded = (t: string): string =>
  SAFE_TEXT.test(t) ? t : `"${t.replace(/"/g, '#quot;').replace(/\r?\n/g, '<br/>')}"`;

/** Exporta el contenido a texto Mermaid. Los frames pasan a `subgraph`; las demás clases de nodo, a forma. */
export function toFlowchart(content: BoardContent, direction: MermaidDirection = 'LR'): string {
  // Ids legibles cuando son válidos y únicos; si no, n1, n2…
  const ids = new Map<string, string>();
  const used = new Set<string>();
  content.nodes.forEach((n, i) => {
    let id = SAFE_ID.test(n.id) && !RESERVED.has(n.id.toLowerCase()) ? n.id : `n${i + 1}`;
    while (used.has(id)) id = `${id}_${i + 1}`;
    used.add(id);
    ids.set(n.id, id);
  });

  const children = new Map<string | undefined, BoardNode[]>();
  for (const n of content.nodes) {
    const key = n.parentId && content.nodes.some((p) => p.id === n.parentId) ? n.parentId : undefined;
    children.set(key, [...(children.get(key) ?? []), n]);
  }

  const out = [`flowchart ${direction}`];
  const emit = (parent: string | undefined, depth: number): void => {
    const pad = '  '.repeat(depth);
    for (const n of children.get(parent) ?? []) {
      const id = ids.get(n.id) as string;
      const label = n.data.label.trim();
      if (n.data.kind === 'frame') {
        out.push(`${pad}subgraph ${id}["${(label || id).replace(/"/g, '#quot;')}"]`);
        emit(n.id, depth + 1);
        out.push(`${pad}end`);
      } else if (!label) {
        out.push(`${pad}${id}`);
      } else {
        const sh = OPEN_CLOSE.get(n.data.shape ?? 'rectangle') ?? OPEN_CLOSE.get('rectangle');
        out.push(`${pad}${id}${sh?.open}${quoteIfNeeded(label)}${sh?.close}`);
      }
    }
  };
  emit(undefined, 1);

  for (const e of content.edges) {
    const d = e.data;
    const thick = (d?.width ?? 2) >= 4;
    const body = d?.dashed
      ? d.markerEnd
        ? '-.->'
        : '-.-'
      : thick
        ? d?.markerEnd
          ? '==>'
          : '==='
        : d?.markerEnd === false
          ? '---'
          : '-->';
    const label = d?.label?.trim();
    const l = label ? `|${quoteIfNeeded(label.replace(/\|/g, '/'))}|` : '';
    out.push(`  ${ids.get(e.source)} ${body}${l} ${ids.get(e.target)}`);
  }
  return out.join('\n') + '\n';
}
