import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolError } from './authz';
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

/** Ejecuta una herramienta y traduce sus errores: `ToolError` → «<código>: mensaje»; el resto, 500 sin detalles. */
async function run(fn: () => Promise<ToolResult>): Promise<CallToolResult> {
  try {
    const r = await fn();
    return { content: [{ type: 'text', text: r.text }] };
  } catch (e) {
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
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'drawyourarchitecture', version: '0.1.0' });

  server.registerTool(
    'list_projects',
    {
      description: 'Lista los proyectos propios y los compartidos contigo (notas y diagramas).',
      inputSchema: { type: z.enum(['note', 'board']).optional().describe('Filtra por tipo.') },
    },
    (a) => run(() => listProjects(ctx, a)),
  );
  server.registerTool(
    'read_note',
    {
      description: 'Lee una nota: el texto de sus elementos en orden de lectura y un resumen.',
      inputSchema: { id },
    },
    (a) => run(() => readNote(ctx, a)),
  );
  server.registerTool(
    'read_board',
    {
      description: 'Lee un diagrama: su Mermaid (flowchart) y el JSON de nodos y aristas.',
      inputSchema: { id },
    },
    (a) => run(() => readBoard(ctx, a)),
  );
  server.registerTool(
    'create_note',
    {
      description:
        'Crea una nota con bloques de texto (separados por una línea en blanco; «# », «## » y «### » al inicio hacen títulos).',
      inputSchema: { title, text: z.string().max(MAX_NOTE_TEXT).describe('Texto de la nota.') },
    },
    (a) => run(() => createNote(ctx, a)),
  );
  server.registerTool(
    'create_board',
    {
      description: 'Crea un diagrama desde un flowchart de Mermaid y lo ordena automáticamente.',
      inputSchema: { title, mermaid },
    },
    (a) => run(() => createBoard(ctx, a)),
  );
  server.registerTool(
    'update_board',
    {
      description:
        'Actualiza un diagrama desde Mermaid: «replace» sustituye todo el contenido; «append» añade lo nuevo debajo de lo existente.',
      inputSchema: { id, mermaid, mode: z.enum(['replace', 'append']).default('append') },
    },
    (a) => run(() => updateBoard(ctx, a)),
  );
  return server;
}
