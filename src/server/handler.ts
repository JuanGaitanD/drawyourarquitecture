import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getAdminDb } from './admin';
import { ToolError, authenticate } from './authz';
import { consumeRate } from './limits';
import { createMcpServer } from './mcpServer';
import { getUserDb } from './userDb';

const MAX_BODY = 1_000_000;

function send(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: `${status}: ${message}` }, id: null }),
  );
}

/** Vercel ya entrega `req.body` parseado; fuera de Vercel (tests, node:http) se lee el flujo. */
async function readBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) return req.body;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new ToolError(413, 'La petición es demasiado grande.');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    throw new ToolError(400, 'El cuerpo no es JSON.');
  }
}

/**
 * Endpoint MCP (Streamable HTTP sin estado, respuestas JSON). Un POST = un servidor y un transporte nuevos.
 * 401 si falta el token, es inválido o está revocado; 429 (con `Retry-After`) al pasar de 60 peticiones por minuto y token; los 403 (`permission-denied` de las reglas) los devuelven las herramientas.
 */
export async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') return send(res, 405, 'Solo se admite POST.', { Allow: 'POST' });
  try {
    const identity = await authenticate(getAdminDb(), req.headers.authorization);
    const db = await getUserDb(identity.uid);
    await consumeRate(db, identity);
    const body = await readBody(req);

    const server = createMcpServer({ db, identity });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
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
        e.status === 401
          ? { 'WWW-Authenticate': 'Bearer realm="dya"' }
          : e.status === 429
            ? { 'Retry-After': String(e.retryAfter ?? 60) }
            : {},
      );
    }
    console.error('mcp: error inesperado', e);
    send(res, 500, 'Error interno del servidor.');
  }
}
