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
  embedBoard,
  listProjects,
  readBoard,
  readNote,
  updateBoard,
  updateNote,
  type ToolContext,
  type ToolResult,
} from './tools';
import { MAX_NOTE_TEXT } from './note';
import { createFolder, deleteFolder, moveProject, updateFolder } from './folders';
import { MAX_FOLDER_NAME_LENGTH } from '../domain/folder';

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
const folderId = z.string().min(1).max(128);
const folderName = z
  .string()
  .max(MAX_FOLDER_NAME_LENGTH * 2)
  .describe(`Nombre de la carpeta (1 a ${MAX_FOLDER_NAME_LENGTH} caracteres).`);
const inFolder = folderId
  .optional()
  .describe('Id de una carpeta tuya (de list_projects); sin él, en Inicio.');

/** Un servidor por petición (transporte sin estado): las herramientas quedan ligadas al uid autenticado. */
export function createMcpServer(mcp: McpContext): McpServer {
  const ctx: ToolContext = { db: mcp.db, uid: mcp.identity.uid };
  const server = new McpServer({ name: 'dya', version: '0.1.0' });

  server.registerTool(
    'list_projects',
    {
      description:
        'Lista los proyectos propios y los compartidos contigo (notas y diagramas), con la carpeta de los tuyos, y tus carpetas en árbol con su id.',
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
      inputSchema: {
        title,
        text: z.string().max(MAX_NOTE_TEXT).describe('Texto de la nota.'),
        folderId: inFolder,
      },
    },
    (a) => run(mcp, 'create_note', {}, () => createNote(ctx, a)),
  );
  server.registerTool(
    'create_board',
    {
      description: 'Crea un diagrama desde un flowchart de Mermaid y lo ordena automáticamente.',
      inputSchema: { title, mermaid, folderId: inFolder },
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
  server.registerTool(
    'update_note',
    {
      description:
        'Edita una nota existente: `title` la renombra (solo el dueño) y `text` reemplaza su texto (mismo formato que create_note) conservando imágenes, diagramas incrustados y la posición y el estilo de los bloques. Los bloques se emparejan en orden de lectura con los de read_note: lo igual no se toca, lo distinto se edita en su sitio, lo de más va debajo y lo que falta se borra. Al menos uno de los dos.',
      inputSchema: {
        id,
        title: title.optional(),
        text: z
          .string()
          .max(MAX_NOTE_TEXT)
          .optional()
          .describe('Texto completo nuevo de la nota (parte de lo que devuelve read_note).'),
      },
    },
    (a) => run(mcp, 'update_note', a, () => updateNote(ctx, a)),
  );
  server.registerTool(
    'embed_board',
    {
      description:
        'Incrusta un diagrama existente en una nota, como «Insertar diagrama» de la app. Sin `after`, al final; con `after`, debajo del único bloque de texto que empieza por ese texto (tal como lo muestra read_note) y lo de debajo baja para dejarle sitio. Hace falta poder editar la nota (dueño o editor) y leer el diagrama.',
      inputSchema: {
        id: id.describe('Id de la nota (de list_projects).'),
        boardId: id.describe('Id del diagrama que se incrusta (de list_projects).'),
        after: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .describe(
            'Inicio del texto del bloque tras el que va el diagrama; debe identificar un solo bloque.',
          ),
      },
    },
    (a) => run(mcp, 'embed_board', a, () => embedBoard(ctx, a)),
  );
  // Las de carpetas no pasan `id` a `run`: la auditoría guarda ids de proyecto, no de carpeta.
  server.registerTool(
    'create_folder',
    {
      description: 'Crea una carpeta tuya, en Inicio o dentro de otra (`parentId`).',
      inputSchema: {
        name: folderName,
        parentId: folderId
          .optional()
          .describe('Id de la carpeta padre (de list_projects); sin él, en Inicio.'),
      },
    },
    (a) => run(mcp, 'create_folder', {}, () => createFolder(ctx, a)),
  );
  server.registerTool(
    'update_folder',
    {
      description:
        'Renombra una carpeta tuya (`name`) y/o la mueve (`parentId`; `null` = Inicio). No puede ir dentro de sí misma ni de una subcarpeta suya. Al menos uno de los dos.',
      inputSchema: {
        id: folderId.describe('Id de la carpeta (de list_projects).'),
        name: folderName.optional(),
        parentId: folderId.nullable().optional().describe('Nueva carpeta padre; `null` = Inicio.'),
      },
    },
    (a) => run(mcp, 'update_folder', {}, () => updateFolder(ctx, a)),
  );
  server.registerTool(
    'delete_folder',
    {
      description: 'Borra una carpeta tuya si está vacía (sin proyectos ni subcarpetas); si no, 409.',
      inputSchema: { id: folderId.describe('Id de la carpeta (de list_projects).') },
    },
    (a) => run(mcp, 'delete_folder', {}, () => deleteFolder(ctx, a)),
  );
  server.registerTool(
    'move_project',
    {
      description: 'Mueve un proyecto tuyo a una carpeta tuya o a Inicio (`folderId: null`).',
      inputSchema: {
        id,
        folderId: folderId.nullable().describe('Carpeta destino (de list_projects); `null` = Inicio.'),
      },
    },
    (a) => run(mcp, 'move_project', a, () => moveProject(ctx, a)),
  );
  return server;
}
