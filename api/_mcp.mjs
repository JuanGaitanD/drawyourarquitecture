// GENERADO por scripts/bundle-mcp.mjs desde src/server. No se edita a mano.

// src/server/handler.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// src/server/admin.ts
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
var db = null;
function getDb() {
  if (db) return db;
  const app = getApps()[0] ?? (process.env.FIRESTORE_EMULATOR_HOST ? initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? "demo-dya" }) : initializeApp({ credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT)) }));
  db = getFirestore(app);
  return db;
}
function parseServiceAccount(raw) {
  if (!raw) throw new Error("Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT no es un JSON v\xE1lido.");
  }
}

// src/application/tokens.ts
var TOKEN_PREFIX = "dya_";
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/server/authz.ts
var ToolError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.name = "ToolError";
    this.status = status;
  }
};
function roleOf(p, uid) {
  const m = p.members;
  if (typeof m !== "object" || m === null || !Object.hasOwn(m, uid)) return void 0;
  const r = m[uid];
  return r === "editor" || r === "viewer" ? r : void 0;
}
function canRead(p, uid) {
  return p.ownerId === uid || roleOf(p, uid) !== void 0 || p.isPublic === true;
}
function canWrite(p, uid) {
  return p.ownerId === uid || roleOf(p, uid) === "editor";
}
async function canCreate(db2, uid, ownerUid = process.env.OWNER_UID) {
  if (ownerUid && uid === ownerUid) return true;
  return (await db2.collection("allowedUsers").doc(uid).get()).exists;
}
async function authenticate(db2, header) {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m) throw new ToolError(401, "Falta el encabezado Authorization: Bearer <token>.");
  const token = m[1];
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) throw new ToolError(401, "Token no v\xE1lido.");
  const ref = db2.collection("mcpTokens").doc(await sha256Hex(token));
  const snap = await ref.get();
  const data = snap.data();
  if (!data || data.revoked === true || typeof data.uid !== "string" || data.uid === "") {
    throw new ToolError(401, "Token no v\xE1lido o revocado.");
  }
  await ref.update({ lastUsedAt: Date.now() }).catch(() => void 0);
  return data.uid;
}

// src/server/mcpServer.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// src/server/tools.ts
import { FieldPath } from "firebase-admin/firestore";

// src/domain/codec.ts
var MAX_CONTENT_BYTES = 9e5;
var ContentTooLargeError = class extends Error {
  bytes;
  constructor(bytes) {
    super(`El contenido ocupa ${bytes} bytes y el tope es ${MAX_CONTENT_BYTES}.`);
    this.name = "ContentTooLargeError";
    this.bytes = bytes;
  }
};
var utf8 = new TextEncoder();
function byteLength(s) {
  return utf8.encode(s).length;
}
function encode(obj) {
  const s = JSON.stringify(obj);
  if (s === void 0) throw new TypeError("El valor no es serializable a JSON.");
  const bytes = byteLength(s);
  if (bytes > MAX_CONTENT_BYTES) throw new ContentTooLargeError(bytes);
  return s;
}
function decode(s) {
  return JSON.parse(s);
}

// src/domain/project.ts
var DEFAULT_TITLE = "Sin t\xEDtulo";
var MAX_TITLE_LENGTH = 120;
function normalizeTitle(raw) {
  const t = (raw ?? "").trim().slice(0, MAX_TITLE_LENGTH);
  return t === "" ? DEFAULT_TITLE : t;
}

// src/editors/board/model/board.ts
import { nanoid } from "nanoid";
var NODE_KINDS = ["shape", "text", "sticky", "frame", "icon", "image"];
var SHAPES = [
  "rectangle",
  "round_rectangle",
  "ellipse",
  "rhombus",
  "triangle",
  "parallelogram",
  "hexagon",
  "cylinder",
  "cloud",
  "document",
  "terminator",
  "arrow_right",
  "callout",
  "actor"
];
var EDGE_PATHS = ["bezier", "straight", "step"];
var ICONS = [
  "server",
  "database",
  "cloud",
  "user",
  "globe",
  "smartphone",
  "lock",
  "queue",
  "cpu",
  "hard-drive",
  "network",
  "shield",
  "mail",
  "credit-card",
  "box"
];
var STICKY_COLORS = {
  gray: "#e6e6e6",
  light_yellow: "#fff9b1",
  yellow: "#f5d128",
  orange: "#ff9d48",
  light_green: "#d5f692",
  green: "#8fd14f",
  dark_green: "#0ca789",
  cyan: "#12cdd4",
  light_pink: "#ffcee0",
  pink: "#ff9dce",
  violet: "#ca90e5",
  red: "#f24726",
  light_blue: "#a6ccf5",
  blue: "#2d9bf0",
  dark_blue: "#6f82d4",
  black: "#1a1a1a"
};
var DEFAULT_SIZE = {
  shape: { width: 160, height: 96 },
  text: { width: 160, height: 40 },
  sticky: { width: 180, height: 180 },
  frame: { width: 480, height: 320 },
  icon: { width: 64, height: 64 },
  image: { width: 240, height: 160 }
};
var BASE_STYLE = {
  fill: "#ffffff",
  stroke: "#1f2937",
  strokeWidth: 2,
  dashed: false,
  opacity: 1,
  fontSize: 14,
  textColor: "#111827",
  align: "center",
  bold: false
};
var KIND_STYLE = {
  shape: {},
  text: { fill: "transparent", stroke: "transparent", strokeWidth: 0, align: "left" },
  sticky: { fill: STICKY_COLORS.light_yellow, stroke: "transparent", strokeWidth: 0 },
  frame: { fill: "transparent", stroke: "#94a3b8", strokeWidth: 1, align: "left" },
  icon: { fill: "transparent" },
  image: { fill: "transparent", stroke: "transparent", strokeWidth: 0 }
};
var defaultStyle = (kind) => ({ ...BASE_STYLE, ...KIND_STYLE[kind] });
function makeNode(kind, pos, partial = {}) {
  const { width, height } = DEFAULT_SIZE[kind];
  const data = {
    label: "",
    ...partial,
    kind,
    style: { ...defaultStyle(kind), ...partial.style }
  };
  if (kind === "shape") data.shape ??= "rectangle";
  if (kind === "icon") data.icon ??= "server";
  return { id: nanoid(), type: kind, position: { x: pos.x, y: pos.y }, width, height, data };
}
function makeEdge(source, target, partial = {}) {
  const { sourceHandle = "r", targetHandle = "l", ...rest } = partial;
  return {
    id: nanoid(),
    type: "labeled",
    source,
    target,
    sourceHandle,
    targetHandle,
    data: {
      path: "bezier",
      markerStart: false,
      markerEnd: true,
      dashed: false,
      color: "#475569",
      width: 2,
      ...rest
    }
  };
}
var emptyBoard = () => ({
  schemaVersion: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 }
});

// src/editors/board/model/geometry.ts
var asMap = (nodes) => nodes instanceof Map ? nodes : new Map(nodes.map((n) => [n.id, n]));
function toAbsolute(node, nodes) {
  const byId = asMap(nodes);
  let x = node.position.x;
  let y = node.position.y;
  const seen = /* @__PURE__ */ new Set([node.id]);
  let p = node.parentId ? byId.get(node.parentId) : void 0;
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    x += p.position.x;
    y += p.position.y;
    p = p.parentId ? byId.get(p.parentId) : void 0;
  }
  return { x, y };
}
function nodeSize(node) {
  const d = DEFAULT_SIZE[node.data.kind];
  return {
    width: node.measured?.width ?? node.width ?? d.width,
    height: node.measured?.height ?? node.height ?? d.height
  };
}
function sortParentsFirst(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = [];
  const done = /* @__PURE__ */ new Set();
  const visiting = /* @__PURE__ */ new Set();
  const visit = (n) => {
    if (done.has(n.id) || visiting.has(n.id)) return;
    visiting.add(n.id);
    const parent = n.parentId ? byId.get(n.parentId) : void 0;
    if (parent) visit(parent);
    visiting.delete(n.id);
    done.add(n.id);
    out.push(n);
  };
  nodes.forEach(visit);
  return out;
}

// src/editors/board/model/layout.ts
var FRAME_PADDING = 32;
var FRAME_HEADER = 40;
var FRAME_MIN = { width: 160, height: 120 };
var NODE_SEP = 48;
var RANK_SEP = 80;
async function autoLayout(content, direction) {
  const dagre = await import("@dagrejs/dagre");
  const byId = new Map(content.nodes.map((n) => [n.id, n]));
  const kids = /* @__PURE__ */ new Map();
  for (const n of content.nodes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : void 0;
    kids.set(key, [...kids.get(key) ?? [], n]);
  }
  const ancestors = (id2) => {
    const out = [];
    for (let p = byId.get(id2)?.parentId; p && out.length <= byId.size; p = byId.get(p)?.parentId) out.push(p);
    return out;
  };
  const placed = /* @__PURE__ */ new Map();
  const layoutLevel = (container) => {
    const items = kids.get(container) ?? [];
    if (items.length === 0) return { width: 0, height: 0 };
    const size = /* @__PURE__ */ new Map();
    for (const n of items) {
      if (n.data.kind === "frame" && (kids.get(n.id)?.length ?? 0) > 0) {
        const inner = layoutLevel(n.id);
        size.set(n.id, {
          width: Math.max(inner.width + FRAME_PADDING * 2, FRAME_MIN.width),
          height: Math.max(inner.height + FRAME_PADDING * 2 + FRAME_HEADER, FRAME_MIN.height)
        });
      } else size.set(n.id, nodeSize(n));
    }
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of items) g.setNode(n.id, size.get(n.id));
    const levelOf = (id2) => size.has(id2) ? id2 : ancestors(id2).find((a) => size.has(a));
    const seen = /* @__PURE__ */ new Set();
    for (const e of content.edges) {
      const s = levelOf(e.source);
      const t = levelOf(e.target);
      if (!s || !t || s === t) continue;
      if (ancestors(e.source).includes(e.target) || ancestors(e.target).includes(e.source)) continue;
      if (seen.has(`${s}>${t}`)) continue;
      seen.add(`${s}>${t}`);
      g.setEdge(s, t);
    }
    dagre.layout(g);
    let maxX = 0;
    let maxY = 0;
    for (const n of items) {
      const { x, y } = g.node(n.id);
      const { width, height } = size.get(n.id);
      placed.set(n.id, { x: x - width / 2, y: y - height / 2, width, height });
      maxX = Math.max(maxX, x + width / 2);
      maxY = Math.max(maxY, y + height / 2);
    }
    const dx = container === void 0 ? 0 : FRAME_PADDING;
    const dy = container === void 0 ? 0 : FRAME_PADDING + FRAME_HEADER;
    for (const n of items) {
      const b = placed.get(n.id);
      placed.set(n.id, { ...b, x: b.x + dx, y: b.y + dy });
    }
    return { width: maxX, height: maxY };
  };
  layoutLevel(void 0);
  const roots = kids.get(void 0) ?? [];
  const origin = {
    x: Math.min(...roots.map((n) => n.position.x)),
    y: Math.min(...roots.map((n) => n.position.y))
  };
  const nodes = content.nodes.map((n) => {
    const b = placed.get(n.id);
    const isRoot = !(n.parentId && byId.has(n.parentId));
    const position = isRoot ? { x: b.x + origin.x, y: b.y + origin.y } : { x: b.x, y: b.y };
    return n.data.kind === "frame" ? { ...n, position, width: b.width, height: b.height } : { ...n, position };
  });
  const abs = new Map(nodes.map((n) => [n.id, toAbsolute(n, nodes)]));
  const center = (n) => {
    const p = abs.get(n.id);
    const { width, height } = nodeSize(n);
    return { x: p.x + width / 2, y: p.y + height / 2 };
  };
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = content.edges.map((e) => {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) return e;
    const a = center(s);
    const b = center(t);
    const forward = direction === "LR" ? b.x >= a.x : b.y >= a.y;
    const [out, into] = direction === "LR" ? forward ? ["r", "l"] : ["l", "r"] : forward ? ["b", "t"] : ["t", "b"];
    return { ...e, sourceHandle: out, targetHandle: into };
  });
  return { ...content, nodes, edges };
}

// src/editors/board/model/validate.ts
var MAX_NODES = 5e3;
var MAX_EDGES = 1e4;
var isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
var isNum = (x) => typeof x === "number" && Number.isFinite(x);
var STYLE_STRINGS = ["fill", "stroke", "textColor"];
var STYLE_NUMBERS = ["strokeWidth", "opacity", "fontSize"];
var fail = (error) => ({ ok: false, error });
function badNumberPath(x, path, depth = 0) {
  if (typeof x === "number") return Number.isFinite(x) ? null : path;
  if (depth > 12 || typeof x !== "object" || x === null) return null;
  for (const [k, v] of Object.entries(x)) {
    const p = badNumberPath(v, `${path}.${k}`, depth + 1);
    if (p) return p;
  }
  return null;
}
function validateBoardContent(x) {
  if (!isObj(x)) return fail("El contenido no es un objeto.");
  if (x.schemaVersion !== 1) return fail(`schemaVersion no admitido: ${String(x.schemaVersion)}.`);
  if (!Array.isArray(x.nodes) || !Array.isArray(x.edges)) return fail("Faltan los arrays nodes y edges.");
  if (x.nodes.length > MAX_NODES) return fail(`Demasiados nodos (${x.nodes.length}; m\xE1ximo ${MAX_NODES}).`);
  if (x.edges.length > MAX_EDGES) return fail(`Demasiadas aristas (${x.edges.length}; m\xE1ximo ${MAX_EDGES}).`);
  const vp = x.viewport;
  if (!isObj(vp) || !isNum(vp.x) || !isNum(vp.y) || !isNum(vp.zoom) || vp.zoom <= 0) {
    return fail("El viewport no es v\xE1lido.");
  }
  const ids = /* @__PURE__ */ new Set();
  for (const [i, n] of x.nodes.entries()) {
    if (!isObj(n) || typeof n.id !== "string" || n.id === "") return fail(`Nodo ${i}: falta el id.`);
    if (ids.has(n.id)) return fail(`Id de nodo duplicado: ${n.id}.`);
    ids.add(n.id);
    const data = n.data;
    if (!isObj(data) || typeof data.kind !== "string" || !NODE_KINDS.includes(data.kind)) {
      return fail(`Nodo ${n.id}: data.kind no v\xE1lido.`);
    }
    if (n.type !== data.kind)
      return fail(`Nodo ${n.id}: type (${String(n.type)}) distinto de data.kind (${data.kind}).`);
    if (typeof data.label !== "string" || !isObj(data.style))
      return fail(`Nodo ${n.id}: faltan label o style.`);
    if (data.kind === "shape" && !SHAPES.includes(data.shape))
      return fail(`Nodo ${n.id}: data.shape no v\xE1lido (${String(data.shape)}).`);
    if (data.kind === "icon" && !ICONS.includes(data.icon))
      return fail(`Nodo ${n.id}: data.icon no v\xE1lido (${String(data.icon)}).`);
    if (data.kind === "image" && typeof data.fileId !== "string") return fail(`Nodo ${n.id}: falta data.fileId.`);
    const pos = n.position;
    if (!isObj(pos) || !isNum(pos.x) || !isNum(pos.y)) return fail(`Nodo ${n.id}: posici\xF3n no finita.`);
    const bad = badNumberPath(n, `nodes[${i}]`);
    if (bad) return fail(`N\xFAmero no finito en ${bad}.`);
    const st = data.style;
    for (const k of STYLE_STRINGS)
      if (typeof st[k] !== "string") return fail(`Nodo ${n.id}: style.${k} debe ser texto.`);
    for (const k of STYLE_NUMBERS)
      if (!isNum(st[k])) return fail(`Nodo ${n.id}: style.${k} debe ser un n\xFAmero finito.`);
  }
  for (const n of x.nodes) {
    if (n.parentId === void 0) continue;
    if (typeof n.parentId !== "string" || !ids.has(n.parentId))
      return fail(`Nodo ${n.id}: parentId inexistente (${String(n.parentId)}).`);
  }
  const byId = new Map(x.nodes.map((n) => [n.id, n]));
  for (const n of x.nodes) {
    const seen = /* @__PURE__ */ new Set([n.id]);
    for (let p = n.parentId ? byId.get(n.parentId) : void 0; p; p = p.parentId ? byId.get(p.parentId) : void 0) {
      if (seen.has(p.id)) return fail(`parentId c\xEDclico en el nodo ${n.id}.`);
      seen.add(p.id);
    }
  }
  const edgeIds = /* @__PURE__ */ new Set();
  for (const [i, e] of x.edges.entries()) {
    if (!isObj(e) || typeof e.id !== "string" || e.id === "") return fail(`Arista ${i}: falta el id.`);
    if (edgeIds.has(e.id)) return fail(`Id de arista duplicado: ${e.id}.`);
    edgeIds.add(e.id);
    if (e.type !== "labeled") return fail(`Arista ${e.id}: type debe ser \xABlabeled\xBB.`);
    if (typeof e.source !== "string" || typeof e.target !== "string")
      return fail(`Arista ${e.id}: faltan source o target.`);
    if (!ids.has(e.source) || !ids.has(e.target))
      return fail(`Arista ${e.id}: apunta a un nodo que no existe.`);
    const d = e.data;
    if (!isObj(d) || !EDGE_PATHS.includes(d.path))
      return fail(`Arista ${e.id}: data.path no v\xE1lido.`);
    const bad = badNumberPath(e, `edges[${i}]`);
    if (bad) return fail(`N\xFAmero no finito en ${bad}.`);
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      nodes: sortParentsFirst(x.nodes),
      edges: x.edges,
      viewport: { x: vp.x, y: vp.y, zoom: vp.zoom }
    }
  };
}

// src/editors/board/model/mermaid.ts
var SHAPES2 = [
  { open: "((", close: "))", shape: "ellipse" },
  { open: "([", close: "])", shape: "terminator" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "[/", close: "/]", shape: "parallelogram" },
  { open: "{{", close: "}}", shape: "hexagon" },
  { open: "[", close: "]", shape: "rectangle" },
  { open: "(", close: ")", shape: "round_rectangle" },
  { open: "{", close: "}", shape: "rhombus" }
];
var ID = /[\p{L}\p{N}_]+/uy;
var IGNORED = /^(style|classDef|class|linkStyle|click|direction)\b/;
var DIRECTIONS = { TD: "TB", TB: "TB", BT: "TB", LR: "LR", RL: "LR" };
var EDGE_SIMPLE = /(-->|---|-\.->|-\.-|==>|===)(?:\s*\|([^|]*)\|)?/y;
var EDGE_TEXT = /(--|-\.|==)\s+(.+?)\s+(-->|---|\.->|\.-|==>|===)/y;
var arrowStyle = (arrow) => ({
  dashed: arrow.includes("."),
  markerEnd: arrow.endsWith(">"),
  width: arrow.startsWith("=") || arrow.endsWith("==") ? 4 : 2
});
var unquote = (t) => {
  const s = t.trim();
  const q = s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
  return q.replace(/<br\s*\/?>/gi, "\n").replace(/#quot;/g, '"');
};
var ParseError = class extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
  line;
};
function splitStatements(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ";" && !inQuote) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
function parseFlowchart(src) {
  try {
    return build(src);
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: `L\xEDnea ${e.line}: ${e.message}`, line: e.line };
    throw e;
  }
}
function build(src) {
  const lines = (src.charCodeAt(0) === 65279 ? src.slice(1) : src).split(/\r\n|\r|\n/);
  const nodes = /* @__PURE__ */ new Map();
  const frameIds = /* @__PURE__ */ new Set();
  const edges = [];
  const stack = [];
  let direction = null;
  let seq = 0;
  const place = () => {
    const i = seq++;
    return { x: i % 4 * 220, y: Math.floor(i / 4) * 140 };
  };
  const declare = (mid, line, text, shape) => {
    if (frameIds.has(mid)) {
      if (text !== void 0) throw new ParseError(`\xAB${mid}\xBB ya es un subgraph.`, line);
      return nodes.get(mid);
    }
    let n = nodes.get(mid);
    if (!n) {
      n = makeNode("shape", place(), { label: mid, shape: "rectangle" });
      nodes.set(mid, n);
    }
    const top = stack[stack.length - 1];
    if (top && !n.parentId) n.parentId = top.node.id;
    if (text !== void 0) n.data = { ...n.data, label: text, shape: shape ?? "rectangle" };
    return n;
  };
  const readNode = (s, pos, line) => {
    ID.lastIndex = pos;
    const m = ID.exec(s);
    if (!m) throw new ParseError(`se esperaba un nodo en \xAB${s.slice(pos, pos + 12)}\xBB.`, line);
    const mid = m[0];
    let p = pos + mid.length;
    const sh = SHAPES2.find((x) => s.startsWith(x.open, p));
    if (!sh) return [declare(mid, line), p];
    p += sh.open.length;
    let text;
    if (s[p] === '"') {
      const endQ = s.indexOf('"', p + 1);
      if (endQ < 0) throw new ParseError("comillas sin cerrar.", line);
      text = s.slice(p, endQ + 1);
      p = endQ + 1;
      if (!s.startsWith(sh.close, p))
        throw new ParseError(`falta \xAB${sh.close}\xBB tras el texto de ${mid}.`, line);
    } else {
      const end = s.indexOf(sh.close, p);
      if (end < 0) throw new ParseError(`falta \xAB${sh.close}\xBB en el nodo ${mid}.`, line);
      text = s.slice(p, end);
      p = end;
    }
    return [declare(mid, line, unquote(text), sh.shape), p + sh.close.length];
  };
  const readEdge = (s, pos) => {
    EDGE_SIMPLE.lastIndex = pos;
    const a = EDGE_SIMPLE.exec(s);
    if (a) {
      const label = a[2] === void 0 ? void 0 : unquote(a[2]);
      return [{ ...arrowStyle(a[1]), ...label ? { label } : {} }, pos + a[0].length];
    }
    EDGE_TEXT.lastIndex = pos;
    const b = EDGE_TEXT.exec(s);
    if (b) {
      const label = unquote(b[2]);
      return [
        { ...arrowStyle(b[1] + b[3]), ...label ? { label } : {} },
        pos + b[0].length
      ];
    }
    return null;
  };
  const statement = (s, line) => {
    if (/^subgraph\b/.test(s)) {
      const rest = s.slice("subgraph".length).trim();
      if (!rest) throw new ParseError("subgraph sin nombre.", line);
      ID.lastIndex = 0;
      const m = ID.exec(rest);
      let mid;
      let title2;
      const tail = m ? rest.slice(m[0].length).trimStart() : "";
      const bracket = SHAPES2.find((x) => tail.startsWith(x.open) && tail.endsWith(x.close));
      if (m && bracket) {
        mid = m[0];
        title2 = unquote(tail.slice(bracket.open.length, tail.length - bracket.close.length));
      } else if (m && m[0] === rest) {
        mid = rest;
        title2 = rest;
      } else {
        title2 = unquote(rest);
        mid = `subgraph_${frameIds.size + 1}`;
      }
      if (nodes.has(mid)) throw new ParseError(`el id \xAB${mid}\xBB ya existe.`, line);
      const frame = makeNode("frame", place(), { label: title2 });
      const parent = stack[stack.length - 1];
      if (parent) frame.parentId = parent.node.id;
      nodes.set(mid, frame);
      frameIds.add(mid);
      stack.push({ mid, node: frame, line });
      return;
    }
    if (s === "end") {
      if (!stack.pop()) throw new ParseError("\xABend\xBB sin subgraph que cerrar.", line);
      return;
    }
    if (IGNORED.test(s)) return;
    if (s.includes("&")) throw new ParseError("\xAB&\xBB (varios nodos en una arista) no est\xE1 soportado.", line);
    let [prev, pos] = readNode(s, 0, line);
    for (; ; ) {
      while (s[pos] === " ") pos++;
      if (pos >= s.length) return;
      const e = readEdge(s, pos);
      if (!e) throw new ParseError(`no se entiende \xAB${s.slice(pos, pos + 16)}\xBB.`, line);
      pos = e[1];
      while (s[pos] === " ") pos++;
      const [next, after] = readNode(s, pos, line);
      edges.push(makeEdge(prev.id, next.id, e[0]));
      prev = next;
      pos = after;
    }
  };
  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    const text = raw.trim();
    if (!text || text.startsWith("%%")) continue;
    for (const s of splitStatements(text)) {
      if (direction !== null) {
        statement(s, line);
        continue;
      }
      const m = /^(?:flowchart|graph)(?:\s+(\S+))?$/.exec(s);
      if (!m) throw new ParseError("se esperaba \xABflowchart\xBB o \xABgraph\xBB (p. ej. \xABflowchart LR\xBB).", line);
      const d = m[1] === void 0 ? "TB" : DIRECTIONS[m[1].toUpperCase()];
      if (!d) throw new ParseError(`direcci\xF3n no v\xE1lida: \xAB${m[1]}\xBB (usa TD, TB, LR, RL o BT).`, line);
      direction = d;
    }
  }
  if (direction === null) throw new ParseError("el texto est\xE1 vac\xEDo.", 1);
  const open = stack[stack.length - 1];
  if (open) throw new ParseError("subgraph sin \xABend\xBB.", open.line);
  const v = validateBoardContent({ ...emptyBoard(), nodes: [...nodes.values()], edges });
  return v.ok ? { ok: true, value: v.value, direction } : { ok: false, error: v.error };
}
var OPEN_CLOSE = new Map(SHAPES2.map((x) => [x.shape, x]));
var RESERVED = /* @__PURE__ */ new Set(["end", "subgraph", "graph", "flowchart", "direction", "style", "class", "click"]);
var SAFE_TEXT = /^[\p{L}\p{N} _.,:!?+-]+$/u;
var SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]{0,19}$/;
var quoteIfNeeded = (t) => SAFE_TEXT.test(t) ? t : `"${t.replace(/"/g, "#quot;").replace(/\r?\n/g, "<br/>")}"`;
function toFlowchart(content, direction = "LR") {
  const ids = /* @__PURE__ */ new Map();
  const used = /* @__PURE__ */ new Set();
  content.nodes.forEach((n, i) => {
    let id2 = SAFE_ID.test(n.id) && !RESERVED.has(n.id.toLowerCase()) ? n.id : `n${i + 1}`;
    while (used.has(id2)) id2 = `${id2}_${i + 1}`;
    used.add(id2);
    ids.set(n.id, id2);
  });
  const children = /* @__PURE__ */ new Map();
  for (const n of content.nodes) {
    const key = n.parentId && content.nodes.some((p) => p.id === n.parentId) ? n.parentId : void 0;
    children.set(key, [...children.get(key) ?? [], n]);
  }
  const out = [`flowchart ${direction}`];
  const emit = (parent, depth) => {
    const pad = "  ".repeat(depth);
    for (const n of children.get(parent) ?? []) {
      const id2 = ids.get(n.id);
      const label = n.data.label.trim();
      if (n.data.kind === "frame") {
        out.push(`${pad}subgraph ${id2}["${(label || id2).replace(/"/g, "#quot;")}"]`);
        emit(n.id, depth + 1);
        out.push(`${pad}end`);
      } else if (!label) {
        out.push(`${pad}${id2}`);
      } else {
        const sh = OPEN_CLOSE.get(n.data.shape ?? "rectangle") ?? OPEN_CLOSE.get("rectangle");
        out.push(`${pad}${id2}${sh?.open}${quoteIfNeeded(label)}${sh?.close}`);
      }
    }
  };
  emit(void 0, 1);
  for (const e of content.edges) {
    const d = e.data;
    const thick = (d?.width ?? 2) >= 4;
    const body = d?.dashed ? d.markerEnd ? "-.->" : "-.-" : thick ? d?.markerEnd ? "==>" : "===" : d?.markerEnd === false ? "---" : "-->";
    const label = d?.label?.trim();
    const l = label ? `|${quoteIfNeeded(label.replace(/\|/g, "/"))}|` : "";
    out.push(`  ${ids.get(e.source)} ${body}${l} ${ids.get(e.target)}`);
  }
  return out.join("\n") + "\n";
}

// src/server/note.ts
var MAX_NOTE_TEXT = 2e5;
var MAX_NOTE_BLOCKS = 2e3;
var FONT_SIZE = 20;
var LINE_HEIGHT = 1.25;
var GAP = 24;
var CHAR_W = 0.6;
var HEADING_SIZE = { 1: 36, 2: 28, 3: 24 };
var B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function orderKey(i) {
  if (i < 62) return "a" + B62[i];
  const j = i - 62;
  return "b" + B62[Math.floor(j / 62)] + B62[j % 62];
}
var rand = () => Math.floor(Math.random() * 2 ** 31);
var textId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 21);
function emptyNote() {
  return { schemaVersion: 1, elements: [], appState: {}, files: {} };
}
function textToElements(text, now2 = Date.now()) {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length > MAX_NOTE_BLOCKS)
    throw new RangeError(`Demasiados bloques de texto (m\xE1ximo ${MAX_NOTE_BLOCKS}).`);
  let y = 0;
  return blocks.map((raw, i) => {
    const h = /^(#{1,3})\s+(.*)$/s.exec(raw);
    const body = h ? h[2] : raw;
    const fontSize = h ? HEADING_SIZE[h[1].length] : FONT_SIZE;
    const lines = body.split("\n");
    const width = Math.ceil(Math.max(...lines.map((l) => l.length), 1) * fontSize * CHAR_W);
    const height = Math.ceil(lines.length * fontSize * LINE_HEIGHT);
    const el = {
      id: textId(),
      type: "text",
      x: 0,
      y,
      width,
      height,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: orderKey(i),
      roundness: null,
      seed: rand(),
      version: 1,
      versionNonce: rand(),
      isDeleted: false,
      boundElements: null,
      updated: now2,
      link: null,
      locked: false,
      text: body,
      fontSize,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      originalText: body,
      autoResize: true,
      lineHeight: LINE_HEIGHT
    };
    y += height + GAP;
    return el;
  });
}
function buildNote(text, now2) {
  return { ...emptyNote(), elements: textToElements(text, now2) };
}
function decodeNote(data) {
  const raw = decode(data);
  if (!raw || typeof raw !== "object" || raw.schemaVersion !== 1 || !Array.isArray(raw.elements)) {
    throw new Error("El contenido no es una nota v\xE1lida.");
  }
  const files = {};
  for (const [id2, meta] of Object.entries(raw.files ?? {})) {
    if (meta && typeof meta.mimeType === "string") {
      files[id2] = { mimeType: meta.mimeType, created: Number(meta.created) || 0 };
    }
  }
  const bg = raw.appState?.viewBackgroundColor;
  return {
    schemaVersion: 1,
    elements: raw.elements,
    appState: typeof bg === "string" ? { viewBackgroundColor: bg } : {},
    files
  };
}
function noteText(elements) {
  return elements.filter((e) => e.type === "text" && e.isDeleted !== true && typeof e.text === "string" && e.text !== "").map((e) => ({ t: e.text, x: Number(e.x) || 0, row: Math.round((Number(e.y) || 0) / 20) })).sort((a, b) => a.row - b.row || a.x - b.x).map((e) => e.t).join("\n\n");
}
function noteSummary(elements) {
  const byType = {};
  let total = 0;
  for (const e of elements) {
    if (e.isDeleted === true) continue;
    total++;
    const t = typeof e.type === "string" ? e.type : "desconocido";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  return { total, byType };
}

// src/server/tools.ts
var MAX_TITLE = 120;
var MAX_MERMAID = 1e5;
var LIST_LIMIT = 200;
var APPEND_GAP = 80;
var ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
var now = (ctx) => (ctx.now ?? Date.now)();
async function loadProject(ctx, id2, need, type) {
  if (!ID_RE.test(id2)) throw new ToolError(400, "Id de proyecto no v\xE1lido.");
  const ref = ctx.db.collection("projects").doc(id2);
  const snap = await ref.get();
  const project = snap.data();
  if (!project) throw new ToolError(404, "El proyecto no existe.");
  const allowed = need === "read" ? canRead(project, ctx.uid) : canWrite(project, ctx.uid);
  if (!allowed) {
    throw new ToolError(
      403,
      need === "read" ? "No tienes acceso a este proyecto." : "No tienes permiso de edici\xF3n en este proyecto."
    );
  }
  if (type && project.type !== type) {
    throw new ToolError(
      400,
      `El proyecto es ${project.type === "note" ? "una nota" : "un diagrama"}, no ${type === "note" ? "una nota" : "un diagrama"}.`
    );
  }
  return { ref, project };
}
async function loadContent(ref) {
  const snap = await ref.collection("content").doc("main").get();
  const c = snap.data();
  if (!c || typeof c.data !== "string") throw new ToolError(404, "El proyecto no tiene contenido.");
  return { data: c.data, revision: Number(c.revision) || 0 };
}
function encodeOrFail(obj) {
  try {
    return encode(obj);
  } catch (e) {
    if (e instanceof ContentTooLargeError) throw new ToolError(413, e.message);
    throw e;
  }
}
function checkTitle(title2) {
  if (title2.trim().length > MAX_TITLE)
    throw new ToolError(400, `El t\xEDtulo admite ${MAX_TITLE} caracteres como m\xE1ximo.`);
  return normalizeTitle(title2);
}
async function createProject(ctx, type, title2, data) {
  if (!await canCreate(ctx.db, ctx.uid)) {
    throw new ToolError(403, "Tu cuenta no puede crear proyectos (el due\xF1o debe a\xF1adirte en Ajustes).");
  }
  const t = now(ctx);
  const ref = ctx.db.collection("projects").doc();
  const batch = ctx.db.batch();
  batch.set(ref, { ownerId: ctx.uid, type, title: title2, isPublic: false, createdAt: t, updatedAt: t });
  batch.set(ref.collection("content").doc("main"), { data, schemaVersion: 1, revision: 0, updatedAt: t });
  await batch.commit();
  return ref.id;
}
async function boardFromMermaid(src) {
  if (src.length > MAX_MERMAID)
    throw new ToolError(413, `El Mermaid admite ${MAX_MERMAID} caracteres como m\xE1ximo.`);
  const parsed = parseFlowchart(src);
  if (!parsed.ok) {
    throw new ToolError(
      400,
      `Mermaid no v\xE1lido${parsed.line ? ` (l\xEDnea ${parsed.line})` : ""}: ${parsed.error}`
    );
  }
  const checked = validateBoardContent(await autoLayout(parsed.value, parsed.direction));
  if (!checked.ok) throw new ToolError(400, `Diagrama no v\xE1lido: ${checked.error}`);
  return checked.value;
}
async function listProjects(ctx, args) {
  const col = ctx.db.collection("projects");
  const [own, shared] = await Promise.all([
    col.where("ownerId", "==", ctx.uid).limit(LIST_LIMIT).get(),
    col.where(new FieldPath("members", ctx.uid), "in", ["editor", "viewer"]).limit(LIST_LIMIT).get()
  ]);
  const seen = /* @__PURE__ */ new Set();
  const projects = [...own.docs, ...shared.docs].filter((d) => !seen.has(d.id) && seen.add(d.id)).map((d) => {
    const p = d.data();
    const role = p.ownerId === ctx.uid ? "owner" : p.members[ctx.uid] ?? "viewer";
    return {
      id: d.id,
      type: p.type,
      title: p.title,
      isPublic: p.isPublic === true,
      role,
      updatedAt: p.updatedAt
    };
  }).filter((p) => !args.type || p.type === args.type).sort((a, b) => b.updatedAt - a.updatedAt);
  const text = projects.length ? projects.map((p) => `- ${p.id} \xB7 ${p.type} \xB7 ${p.title} (${p.role})`).join("\n") : "No hay proyectos.";
  return { text, data: { projects } };
}
async function readNote(ctx, args) {
  const { ref, project } = await loadProject(ctx, args.id, "read", "note");
  const { data, revision } = await loadContent(ref);
  let note;
  try {
    note = decodeNote(data);
  } catch (e) {
    throw new ToolError(400, e instanceof Error ? e.message : "La nota est\xE1 da\xF1ada.");
  }
  const text = noteText(note.elements);
  const summary = { id: args.id, title: project.title, revision, ...noteSummary(note.elements) };
  return {
    text: `# ${project.title}

${text || "(sin texto)"}

---
${JSON.stringify(summary)}`,
    data: { ...summary, text }
  };
}
async function readBoard(ctx, args) {
  const { ref, project } = await loadProject(ctx, args.id, "read", "board");
  const { data, revision } = await loadContent(ref);
  let parsed;
  try {
    parsed = decode(data);
  } catch {
    throw new ToolError(400, "El diagrama est\xE1 da\xF1ado (no es JSON).");
  }
  const checked = validateBoardContent(parsed);
  if (!checked.ok) throw new ToolError(400, `El diagrama no es v\xE1lido: ${checked.error}`);
  const board = checked.value;
  const mermaid2 = toFlowchart(board, "LR");
  const nodes = board.nodes.map((n) => ({
    id: n.id,
    kind: n.data.kind,
    ...n.data.shape ? { shape: n.data.shape } : {},
    label: n.data.label,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    ...n.parentId ? { parentId: n.parentId } : {}
  }));
  const edges = board.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...e.data?.label ? { label: e.data.label } : {}
  }));
  const json = { id: args.id, title: project.title, revision, nodes, edges };
  return {
    text: `# ${project.title}

\`\`\`mermaid
${mermaid2}\`\`\`

---
${JSON.stringify({ nodes, edges })}`,
    data: { ...json, mermaid: mermaid2 }
  };
}
async function createNote(ctx, args) {
  const title2 = checkTitle(args.title);
  if (args.text.length > MAX_NOTE_TEXT)
    throw new ToolError(413, `El texto admite ${MAX_NOTE_TEXT} caracteres como m\xE1ximo.`);
  let data;
  try {
    data = encodeOrFail(buildNote(args.text, now(ctx)));
  } catch (e) {
    if (e instanceof RangeError) throw new ToolError(413, e.message);
    throw e;
  }
  const id2 = await createProject(ctx, "note", title2, data);
  return { text: `Nota creada: ${id2} (\xAB${title2}\xBB). \xC1brela en /note/${id2}.`, data: { id: id2, title: title2 } };
}
async function createBoard(ctx, args) {
  const title2 = checkTitle(args.title);
  const board = await boardFromMermaid(args.mermaid);
  const id2 = await createProject(ctx, "board", title2, encodeOrFail(board));
  return {
    text: `Diagrama creado: ${id2} (\xAB${title2}\xBB, ${board.nodes.length} nodos, ${board.edges.length} aristas). \xC1brelo en /board/${id2}.`,
    data: { id: id2, title: title2, nodes: board.nodes.length, edges: board.edges.length }
  };
}
function placeBelow(base, add) {
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
  return add.nodes.map(
    (n) => n.parentId ? n : { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
  );
}
async function updateBoard(ctx, args) {
  if (!ID_RE.test(args.id)) throw new ToolError(400, "Id de proyecto no v\xE1lido.");
  const incoming = await boardFromMermaid(args.mermaid);
  const projectRef = ctx.db.collection("projects").doc(args.id);
  const contentRef = projectRef.collection("content").doc("main");
  return ctx.db.runTransaction(async (tx) => {
    const [pSnap, cSnap] = await Promise.all([tx.get(projectRef), tx.get(contentRef)]);
    const project = pSnap.data();
    if (!project) throw new ToolError(404, "El proyecto no existe.");
    if (!canWrite(project, ctx.uid)) {
      throw new ToolError(403, "No tienes permiso de edici\xF3n en este proyecto.");
    }
    if (project.type !== "board") throw new ToolError(400, "El proyecto es una nota, no un diagrama.");
    const current = cSnap.data();
    if (!current || typeof current.data !== "string")
      throw new ToolError(404, "El proyecto no tiene contenido.");
    let next = incoming;
    if (args.mode === "append") {
      let existing;
      try {
        existing = decode(current.data);
      } catch {
        throw new ToolError(400, "El diagrama actual est\xE1 da\xF1ado (no es JSON).");
      }
      const checked = validateBoardContent(existing);
      if (!checked.ok) throw new ToolError(400, `El diagrama actual no es v\xE1lido: ${checked.error}`);
      const merged = validateBoardContent({
        ...checked.value,
        nodes: [...checked.value.nodes, ...placeBelow(checked.value, incoming)],
        edges: [...checked.value.edges, ...incoming.edges]
      });
      if (!merged.ok) throw new ToolError(400, `El resultado no es v\xE1lido: ${merged.error}`);
      next = merged.value;
    }
    const revision = (Number(current.revision) || 0) + 1;
    const t = now(ctx);
    tx.update(contentRef, { data: encodeOrFail(next), revision, updatedAt: t });
    tx.update(projectRef, { updatedAt: t });
    return {
      text: `Diagrama actualizado (${args.mode}): revisi\xF3n ${revision}, ${next.nodes.length} nodos, ${next.edges.length} aristas.`,
      data: { id: args.id, revision, nodes: next.nodes.length, edges: next.edges.length }
    };
  });
}

// src/server/mcpServer.ts
async function run(fn) {
  try {
    const r = await fn();
    return { content: [{ type: "text", text: r.text }] };
  } catch (e) {
    if (e instanceof ToolError)
      return { isError: true, content: [{ type: "text", text: `${e.status}: ${e.message}` }] };
    console.error("mcp: error inesperado en una herramienta", e);
    return { isError: true, content: [{ type: "text", text: "500: error interno del servidor." }] };
  }
}
var id = z.string().min(1).max(128).describe("Id del proyecto (de list_projects).");
var title = z.string().min(1).max(MAX_TITLE).describe("T\xEDtulo del proyecto.");
var mermaid = z.string().min(1).max(MAX_MERMAID).describe("Flowchart de Mermaid (flowchart/graph con LR, TD\u2026; admite subgraph).");
function createMcpServer(ctx) {
  const server = new McpServer({ name: "drawyourarchitecture", version: "0.1.0" });
  server.registerTool(
    "list_projects",
    {
      description: "Lista los proyectos propios y los compartidos contigo (notas y diagramas).",
      inputSchema: { type: z.enum(["note", "board"]).optional().describe("Filtra por tipo.") }
    },
    (a) => run(() => listProjects(ctx, a))
  );
  server.registerTool(
    "read_note",
    {
      description: "Lee una nota: el texto de sus elementos en orden de lectura y un resumen.",
      inputSchema: { id }
    },
    (a) => run(() => readNote(ctx, a))
  );
  server.registerTool(
    "read_board",
    {
      description: "Lee un diagrama: su Mermaid (flowchart) y el JSON de nodos y aristas.",
      inputSchema: { id }
    },
    (a) => run(() => readBoard(ctx, a))
  );
  server.registerTool(
    "create_note",
    {
      description: "Crea una nota con bloques de texto (separados por una l\xEDnea en blanco; \xAB# \xBB, \xAB## \xBB y \xAB### \xBB al inicio hacen t\xEDtulos).",
      inputSchema: { title, text: z.string().max(MAX_NOTE_TEXT).describe("Texto de la nota.") }
    },
    (a) => run(() => createNote(ctx, a))
  );
  server.registerTool(
    "create_board",
    {
      description: "Crea un diagrama desde un flowchart de Mermaid y lo ordena autom\xE1ticamente.",
      inputSchema: { title, mermaid }
    },
    (a) => run(() => createBoard(ctx, a))
  );
  server.registerTool(
    "update_board",
    {
      description: "Actualiza un diagrama desde Mermaid: \xABreplace\xBB sustituye todo el contenido; \xABappend\xBB a\xF1ade lo nuevo debajo de lo existente.",
      inputSchema: { id, mermaid, mode: z.enum(["replace", "append"]).default("append") }
    },
    (a) => run(() => updateBoard(ctx, a))
  );
  return server;
}

// src/server/handler.ts
var MAX_BODY = 1e6;
function send(res, status, message, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32e3, message: `${status}: ${message}` }, id: null })
  );
}
async function readBody(req) {
  if (req.body !== void 0) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new ToolError(413, "La petici\xF3n es demasiado grande.");
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : void 0;
  } catch {
    throw new ToolError(400, "El cuerpo no es JSON.");
  }
}
async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, "Solo se admite POST.", { Allow: "POST" });
  try {
    const db2 = getDb();
    const uid = await authenticate(db2, req.headers.authorization);
    const body = await readBody(req);
    const server = createMcpServer({ db: db2, uid });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: void 0,
      enableJsonResponse: true
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    if (res.headersSent) return;
    if (e instanceof ToolError) {
      return send(
        res,
        e.status,
        e.message,
        e.status === 401 ? { "WWW-Authenticate": 'Bearer realm="drawyourarchitecture"' } : {}
      );
    }
    console.error("mcp: error inesperado", e);
    send(res, 500, "Error interno del servidor.");
  }
}
export {
  handler as default
};
