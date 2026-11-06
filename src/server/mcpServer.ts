import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolError, type Identity } from './authz';
import { recordAudit } from './limits';
import {
  MAX_MERMAID,
  MAX_TITLE,
  createBoard,
  createNote,
  listProjects,
  readBoard,
  readNote,
  updateBoard,
  type ToolContext,
  type ToolResult,
} from './tools';
import { MAX_NOTE_TEXT } from './note';

export interface McpContext {
  db: ToolContext['db'];
  identity: Identity;
}

/**
 * Ejecuta una herramienta, la audita (`mcpAudit`) y traduce sus errores: `ToolError` → «<código>: mensaje»; el
 * resto, 500 sin detalles. La auditoría se espera antes de responder: la función puede congelarse al contestar.
 */
async function run(
  ctx: McpContext,
  tool: string,
  args: { id?: string },
  fn: () => Promise<ToolResult>,
): Promise<CallToolResult> {
  const audit = (ok: boolean, projectId?: string) =>
    recordAudit(ctx.db, ctx.identity, { tool, projectId: projectId ?? args.id, ok });
  try {
    const r = await fn();
    await audit(true, (r.data as { id?: string } | undefined)?.id);
    return { content: [{ type: 'text', text: r.text }] };
  } catch (e) {
    await audit(false);
    if (e instanceof ToolError)
      return { isError: true, content: [{ type: 'text', text: `${e.status}: ${e.message}` }] };
    console.error('mcp: error inesperado en una herramienta', e);
    return { isError: true, content: [{ type: 'text', text: '500: error interno del servidor.' }] };
  }
}

const id = z.string().min(1).max(128).describe('Id del proyecto (de list_projects).');
const title = z.string().min(1).max(MAX_TITLE).describe('Título del proyecto.');
const mermaid = z
  .string()
  .min(1)
  .max(MAX_MERMAID)
  .describe('Flowchart de Mermaid (flowchart/graph con LR, TD…; admite subgraph).');

/** Un servidor por petición (transporte sin estado): las herramientas quedan ligadas al uid autenticado. */
export function createMcpServer(mcp: McpContext): McpServer {
  const ctx: ToolContext = { db: mcp.db, uid: mcp.identity.uid };
  const server = new McpServer({ name: 'drawyourarchitecture', version: '0.1.0' });

  server.registerTool(
    'list_projects',
    {
      description: 'Lista los proyectos propios y los compartidos contigo (notas y diagramas).',
      inputSchema: { type: z.enum(['note', 'board']).optional().describe('Filtra por tipo.') },
    },
    (a) => run(mcp, 'list_projects', {}, () => listProjects(ctx, a)),
  );
  server.registerTool(
    'read_note',
    {
      description:
        'Lee una nota: el texto de sus elementos en orden de lectura, un resumen, sus imágenes (fileId, mimeType) y los diagramas incrustados (boardId, con su Mermaid si puedes leerlos).',
      inputSchema: { id },
    },
    (a) => run(mcp, 'read_note', a, () => readNote(ctx, a)),
  );
  server.registerTool(
    'read_board',
    {
      description: 'Lee un diagrama: su Mermaid (flowchart) y el JSON de nodos y aristas.',
      inputSchema: { id },
    },
    (a) => run(mcp, 'read_board', a, () => readBoard(ctx, a)),
  );
  server.registerTool(
    'create_note',
    {
      description:
        'Crea una nota con bloques de texto (separados por una línea en blanco; «# », «## » y «### » al inicio hacen títulos).',
      inputSchema: { title, text: z.string().max(MAX_NOTE_TEXT).describe('Texto de la nota.') },
    },
    (a) => run(mcp, 'create_note', {}, () => createNote(ctx, a)),
  );
  server.registerTool(
    'create_board',
    {
      description: 'Crea un diagrama desde un flowchart de Mermaid y lo ordena automáticamente.',
      inputSchema: { title, mermaid },
    },
    (a) => run(mcp, 'create_board', {}, () => createBoard(ctx, a)),
  );
  server.registerTool(
    'update_board',
    {
      description:
        'Amplía un diagrama desde Mermaid: añade lo nuevo debajo de lo existente y conserva lo que ya hay (posiciones, estilos, frames e imágenes).',
      inputSchema: { id, mermaid },
    },
    (a) => run(mcp, 'update_board', a, () => updateBoard(ctx, a)),
  );
  return server;
}
