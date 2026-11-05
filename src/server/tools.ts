import * as firestoreSdk from 'firebase/firestore';
import {
  FieldPath,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { ContentRepo } from '../application/ports';
import { ContentTooLargeError, DOC_CONTENT_BYTES, byteLength, encode, decode } from '../domain/codec';
import { normalizeTitle, type ProjectType } from '../domain/project';
import { emptyBoard, type BoardContent, type BoardNode } from '../editors/board/model/board';
import { nodeSize, toAbsolute } from '../editors/board/model/geometry';
import { autoLayout } from '../editors/board/model/layout';
import { parseFlowchart, toFlowchart } from '../editors/board/model/mermaid';
import { validateBoardContent } from '../editors/board/model/validate';
import { createContentRepo } from '../infrastructure/firebase/contentRepo';
import { ToolError, isPermissionDenied } from './authz';
import { MAX_NOTE_TEXT, buildNote, decodeNote, noteEmbeds, noteImages, noteSummary, noteText } from './note';

// Una función por herramienta. Reciben el Firestore del SDK web ya autenticado como la persona: los permisos los
// deciden las reglas y `permission-denied` se traduce a 403 (`denied`). Devuelven `{ text, data? }`.

export interface ToolContext {
  db: Firestore;
  uid: string;
  now?: () => number;
}
export interface ToolResult {
  text: string;
  data?: unknown;
}

export const MAX_TITLE = 120;
export const MAX_MERMAID = 100_000;
const LIST_LIMIT = 200;
const APPEND_GAP = 80;

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const now = (ctx: ToolContext) => (ctx.now ?? Date.now)();

// El contenido se lee y escribe con el mismo repositorio que la app (troceado a partir de 900 000 bytes, revisión
// monótona, transacción): sobre el Firestore autenticado de la persona, así que las reglas aplican igual.
const repos = new WeakMap<Firestore, ContentRepo>();
function contentOf(ctx: ToolContext): ContentRepo {
  let repo = repos.get(ctx.db);
  if (!repo) {
    repo = createContentRepo(async () => ({ fs: firestoreSdk, db: ctx.db }));
    repos.set(ctx.db, repo);
  }
  return repo;
}

interface ProjectDoc {
  ownerId: string;
  isPublic?: boolean;
  members?: Record<string, string>;
  type: ProjectType;
  title: string;
  updatedAt: number;
}

const DENIED = 'Sin permiso: el proyecto no existe, no tienes acceso o no puedes editarlo.';

/** Envuelve una herramienta: lo que las reglas de Firestore rechazan sale como 403. */
function denied<A>(fn: (ctx: ToolContext, args: A) => Promise<ToolResult>) {
  return async (ctx: ToolContext, args: A): Promise<ToolResult> => {
    try {
      return await fn(ctx, args);
    } catch (e) {
      if (isPermissionDenied(e)) throw new ToolError(403, DENIED);
      throw e;
    }
  };
}

async function loadProject(
  ctx: ToolContext,
  id: string,
  type?: ProjectType,
): Promise<{ ref: DocumentReference; project: ProjectDoc }> {
  if (!ID_RE.test(id)) throw new ToolError(400, 'Id de proyecto no válido.');
  const ref = doc(ctx.db, 'projects', id);
  // Un proyecto inexistente también da `permission-denied` (las reglas leen `resource.data`): sale como 403.
  const project = (await getDoc(ref)).data() as ProjectDoc | undefined;
  if (!project) throw new ToolError(404, 'El proyecto no existe.');
  if (type && project.type !== type) {
    throw new ToolError(
      400,
      `El proyecto es ${project.type === 'note' ? 'una nota' : 'un diagrama'}, no ${type === 'note' ? 'una nota' : 'un diagrama'}.`,
    );
  }
  return { ref, project };
}

/** Contenido ya recompuesto (también el troceado). `null` solo si no existe: el acceso lo comprobó `loadProject`. */
async function loadContent(ctx: ToolContext, id: string): Promise<{ data: string; revision: number }> {
  const c = await contentOf(ctx).load(id);
  if (!c) throw new ToolError(404, 'El proyecto no tiene contenido.');
  return { data: c.data, revision: c.revision };
}

function encodeOrFail(obj: unknown): string {
  try {
    return encode(obj);
  } catch (e) {
    if (e instanceof ContentTooLargeError) throw new ToolError(413, e.message);
    throw e;
  }
}

function checkTitle(title: string): string {
  if (title.trim().length > MAX_TITLE)
    throw new ToolError(400, `El título admite ${MAX_TITLE} caracteres como máximo.`);
  return normalizeTitle(title);
}

async function createProject(
  ctx: ToolContext,
  type: ProjectType,
  title: string,
  data: string,
): Promise<string> {
  const t = now(ctx);
  const ref = doc(collection(ctx.db, 'projects'));
  const batch = writeBatch(ctx.db);
  // Las reglas exigen `data` ≤ 900 000 al crear `content/main`: un contenido mayor nace vacío y se amplía a
  // continuación con `save` (troceado), como hace la app al guardar.
  const big = byteLength(data) > DOC_CONTENT_BYTES;
  const initial = big ? encode(type === 'note' ? buildNote('', t) : emptyBoard()) : data;
  batch.set(ref, { ownerId: ctx.uid, type, title, isPublic: false, createdAt: t, updatedAt: t });
  batch.set(doc(ref, 'content', 'main'), { data: initial, schemaVersion: 1, revision: 0, updatedAt: t });
  try {
    await batch.commit();
    if (big) {
      const saved = await contentOf(ctx).save(ref.id, data, 0);
      if ('conflict' in saved) throw new ToolError(400, 'No se pudo guardar el contenido del proyecto.');
    }
  } catch (e) {
    if (isPermissionDenied(e)) {
      throw new ToolError(
        403,
        'Tu cuenta no puede crear proyectos (el dueño debe añadir tu correo verificado en Ajustes).',
      );
    }
    throw e;
  }
  return ref.id;
}

/** Mermaid → tablero ordenado con dagre y validado. Errores de sintaxis = 400 con la línea. */
async function boardFromMermaid(src: string): Promise<BoardContent> {
  if (src.length > MAX_MERMAID)
    throw new ToolError(413, `El Mermaid admite ${MAX_MERMAID} caracteres como máximo.`);
  const parsed = parseFlowchart(src);
  if (!parsed.ok) {
    throw new ToolError(
      400,
      `Mermaid no válido${parsed.line ? ` (línea ${parsed.line})` : ''}: ${parsed.error}`,
    );
  }
  const checked = validateBoardContent(await autoLayout(parsed.value, parsed.direction));
  if (!checked.ok) throw new ToolError(400, `Diagrama no válido: ${checked.error}`);
  return checked.value;
}

// ---------------------------------------------------------------------------------------------

export const listProjects = denied(async (ctx: ToolContext, args: { type?: ProjectType }) => {
  const col = collection(ctx.db, 'projects');
  const [own, shared] = await Promise.all([
    getDocs(query(col, where('ownerId', '==', ctx.uid), limit(LIST_LIMIT))),
    getDocs(
      query(col, where(new FieldPath('members', ctx.uid), 'in', ['editor', 'viewer']), limit(LIST_LIMIT)),
    ),
  ]);
  const seen = new Set<string>();
  const projects = [...own.docs, ...shared.docs]
    .filter((d) => !seen.has(d.id) && seen.add(d.id))
    .map((d) => {
      const p = d.data() as ProjectDoc;
      const role = p.ownerId === ctx.uid ? 'owner' : (p.members?.[ctx.uid] ?? 'viewer');
      return {
        id: d.id,
        type: p.type,
        title: p.title,
        isPublic: p.isPublic === true,
        role,
        updatedAt: p.updatedAt,
      };
    })
    .filter((p) => !args.type || p.type === args.type)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const text = projects.length
    ? projects.map((p) => `- ${p.id} · ${p.type} · ${p.title} (${p.role})`).join('\n')
    : 'No hay proyectos.';
  return { text, data: { projects } };
});

/** Proyecto board → contenido validado. Las reglas rechazan lo que no puedes leer (`permission-denied`). */
async function loadBoard(
  ctx: ToolContext,
  id: string,
): Promise<{ project: ProjectDoc; revision: number; board: BoardContent }> {
  const { project } = await loadProject(ctx, id, 'board');
  const { data, revision } = await loadContent(ctx, id);
  let parsed: unknown;
  try {
    parsed = decode(data);
  } catch {
    throw new ToolError(400, 'El diagrama está dañado (no es JSON).');
  }
  const checked = validateBoardContent(parsed);
  if (!checked.ok) throw new ToolError(400, `El diagrama no es válido: ${checked.error}`);
  return { project, revision, board: checked.value };
}

/** Diagramas incrustados que se resuelven por nota (cada uno cuesta dos lecturas). */
const MAX_EMBEDS = 10;

export const readNote = denied(async (ctx: ToolContext, args: { id: string }) => {
  const { project } = await loadProject(ctx, args.id, 'note');
  const { data, revision } = await loadContent(ctx, args.id);
  let note;
  try {
    note = decodeNote(data);
  } catch (e) {
    throw new ToolError(400, e instanceof Error ? e.message : 'La nota está dañada.');
  }
  const text = noteText(note.elements);
  const images = noteImages(note);
  // Cada diagrama incrustado va con su Mermaid si quien llama puede leerlo; si no, solo el `boardId`.
  const embeds = await Promise.all(
    noteEmbeds(note.elements)
      .slice(0, MAX_EMBEDS)
      .map(async (boardId): Promise<{ boardId: string; title?: string; mermaid?: string }> => {
        try {
          const b = await loadBoard(ctx, boardId);
          return { boardId, title: b.project.title, mermaid: toFlowchart(b.board, 'LR') };
        } catch (e) {
          if (e instanceof ToolError || isPermissionDenied(e)) return { boardId };
          throw e;
        }
      }),
  );
  const summary = { id: args.id, title: project.title, revision, ...noteSummary(note.elements) };
  const lines = (items: string[]) => items.join('\n');
  const extras = [
    images.length
      ? `## Imágenes\n${lines(images.map((i) => `- ${i.fileId} (${i.mimeType ?? 'tipo desconocido'})`))}`
      : '',
    embeds.length
      ? `## Diagramas incrustados\n${lines(
          embeds.map((e) =>
            e.mermaid
              ? `- ${e.boardId} «${e.title}»\n\n\`\`\`mermaid\n${e.mermaid}\`\`\``
              : `- ${e.boardId} (sin acceso o ilegible)`,
          ),
        )}`
      : '',
  ].filter(Boolean);
  return {
    text: `# ${project.title}\n\n${text || '(sin texto)'}\n\n${extras.map((x) => `${x}\n\n`).join('')}---\n${JSON.stringify(summary)}`,
    data: { ...summary, text, images, embeds },
  };
});

export const readBoard = denied(async (ctx: ToolContext, args: { id: string }) => {
  const { project, revision, board } = await loadBoard(ctx, args.id);
  const mermaid = toFlowchart(board, 'LR');
  const nodes = board.nodes.map((n) => ({
    id: n.id,
    kind: n.data.kind,
    ...(n.data.shape ? { shape: n.data.shape } : {}),
    label: n.data.label,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    ...(n.parentId ? { parentId: n.parentId } : {}),
  }));
  const edges = board.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.data?.label ? { label: e.data.label } : {}),
  }));
  const json = { id: args.id, title: project.title, revision, nodes, edges };
  return {
    text: `# ${project.title}\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n\n---\n${JSON.stringify({ nodes, edges })}`,
    data: { ...json, mermaid },
  };
});

export const createNote = denied(async (ctx: ToolContext, args: { title: string; text: string }) => {
  const title = checkTitle(args.title);
  if (args.text.length > MAX_NOTE_TEXT)
    throw new ToolError(413, `El texto admite ${MAX_NOTE_TEXT} caracteres como máximo.`);
  let data: string;
  try {
    data = encodeOrFail(buildNote(args.text, now(ctx)));
  } catch (e) {
    if (e instanceof RangeError) throw new ToolError(413, e.message);
    throw e;
  }
  const id = await createProject(ctx, 'note', title, data);
  return { text: `Nota creada: ${id} («${title}»). Ábrela en /note/${id}.`, data: { id, title } };
});

export const createBoard = denied(async (ctx: ToolContext, args: { title: string; mermaid: string }) => {
  const title = checkTitle(args.title);
  const board = await boardFromMermaid(args.mermaid);
  const id = await createProject(ctx, 'board', title, encodeOrFail(board));
  return {
    text: `Diagrama creado: ${id} («${title}», ${board.nodes.length} nodos, ${board.edges.length} aristas). Ábrelo en /board/${id}.`,
    data: { id, title, nodes: board.nodes.length, edges: board.edges.length },
  };
});

/** Coloca los nodos de primer nivel de `add` bajo `base`, alineados a su izquierda. Los hijos van relativos: no se tocan. */
function placeBelow(base: BoardContent, add: BoardContent): BoardNode[] {
  if (base.nodes.length === 0) return add.nodes;
  let left = Infinity;
  let bottom = -Infinity;
  for (const n of base.nodes) {
    const p = toAbsolute(n, base.nodes);
    left = Math.min(left, p.x);
    bottom = Math.max(bottom, p.y + nodeSize(n).height);
  }
  const top = add.nodes.filter((n) => !n.parentId);
  const addLeft = Math.min(...top.map((n) => n.position.x));
  const addTop = Math.min(...top.map((n) => n.position.y));
  const dx = left - addLeft;
  const dy = bottom + APPEND_GAP - addTop;
  return add.nodes.map((n) =>
    n.parentId ? n : { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } },
  );
}

const MAX_CONFLICT_RETRIES = 5;

export const updateBoard = denied(async (ctx: ToolContext, args: { id: string; mermaid: string }) => {
  if (!ID_RE.test(args.id)) throw new ToolError(400, 'Id de proyecto no válido.');
  const incoming = await boardFromMermaid(args.mermaid);

  // Leer → ampliar → `save` con la revisión leída. Si otra escritura se coló, `save` devuelve conflicto y se
  // vuelve a leer. Quien solo puede leer (viewer) llega al commit y las reglas lo rechazan: 403 (`denied`).
  for (let attempt = 1; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
    const { revision: read, board: base } = await loadBoard(ctx, args.id);
    const merged = validateBoardContent({
      ...base,
      nodes: [...base.nodes, ...placeBelow(base, incoming)],
      edges: [...base.edges, ...incoming.edges],
    });
    if (!merged.ok) throw new ToolError(400, `El resultado no es válido: ${merged.error}`);
    const next: BoardContent = merged.value;
    let saved;
    try {
      saved = await contentOf(ctx).save(args.id, encodeOrFail(next), read);
    } catch (e) {
      // El SDK web es optimista: si otra escritura se coló entre la lectura y el commit, la regla
      // `revision == anterior + 1` falla y sale `permission-denied`. Cambió la revisión = conflicto; si no, 403.
      if (!isPermissionDenied(e) || (await contentOf(ctx).load(args.id))?.revision === read) throw e;
      continue;
    }
    if ('conflict' in saved) continue;
    return {
      text: `Diagrama ampliado: revisión ${saved.revision}, ${next.nodes.length} nodos, ${next.edges.length} aristas.`,
      data: { id: args.id, revision: saved.revision, nodes: next.nodes.length, edges: next.edges.length },
    };
  }
  throw new ToolError(409, 'El diagrama cambia sin parar: reintenta en unos segundos.');
});
