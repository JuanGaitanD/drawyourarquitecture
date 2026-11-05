import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from './admin';
import { EMULATOR, seedProject, seedToken, uniq } from './testkit';

// De extremo a extremo: el bundle de producción (api/_mcp.mjs) en un proceso Node aparte, hablado con un
// cliente MCP del SDK por Streamable HTTP. Necesita el emulador de Firestore.
describe.skipIf(!EMULATOR)('servidor MCP · extremo a extremo', () => {
  const OWNER = uniq('dueno');
  const STRANGER = uniq('ajeno');
  let db: Firestore;
  let child: ChildProcess;
  let url: URL;

  const connect = async (token: string) => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return { isError: r.isError === true, text: r.content[0].text };
  };

  beforeAll(async () => {
    process.env.OWNER_UID = OWNER;
    db = getDb();
    child = spawn(process.execPath, ['scripts/mcp-serve.mjs', '0'], {
      env: { ...process.env, OWNER_UID: OWNER },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    url = await new Promise<URL>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('El servidor MCP no arrancó.')), 15_000);
      child.once('exit', (c) => reject(new Error(`El servidor MCP terminó (${c}).`)));
      child.stdout?.on('data', (b: Buffer) => {
        const m = /(http:\/\/127\.0\.0\.1:\d+\/api\/mcp)/.exec(b.toString());
        if (m) {
          clearTimeout(t);
          resolve(new URL(m[1]));
        }
      });
    });
  }, 20_000);

  afterAll(() => {
    child?.kill();
  });

  it('sin token o con token revocado: 401 (con WWW-Authenticate)', async () => {
    const raw = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(raw.status).toBe(401);
    expect(raw.headers.get('www-authenticate')).toContain('Bearer');

    const { token } = await seedToken(db, OWNER, true);
    await expect(connect(token)).rejects.toThrow(/401/);
    await expect(connect('dya_inventado')).rejects.toThrow(/401/);
    expect((await fetch(url, { method: 'GET' })).status).toBe(405);
  });

  it('con token: lista las herramientas, crea un board desde Mermaid, lo lee y lo amplía', async () => {
    const { token } = await seedToken(db, OWNER);
    const client = await connect(token);
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual([
        'create_board',
        'create_note',
        'list_projects',
        'read_board',
        'read_note',
        'update_board',
      ]);

      const created = await call(client, 'create_board', {
        title: 'E2E',
        mermaid: 'flowchart LR\n  A[Web] --> B[API] --> C[(DB)]',
      });
      expect(created.isError).toBe(false);
      const id = /Diagrama creado: (\S+)/.exec(created.text)?.[1] as string;

      const listed = await call(client, 'list_projects', { type: 'board' });
      expect(listed.text).toContain(id);

      const read = await call(client, 'read_board', { id });
      expect(read.text).toContain('flowchart LR');
      expect(read.text).toContain('API');

      const updated = await call(client, 'update_board', {
        id,
        mermaid: 'flowchart LR\n  C2[Cache]',
        mode: 'append',
      });
      expect(updated.text).toContain('revisión 1');
      expect((await call(client, 'read_board', { id })).text).toContain('Cache');

      const note = await call(client, 'create_note', { title: 'Nota E2E', text: '# Hola\n\nUn párrafo' });
      const noteId = /Nota creada: (\S+)/.exec(note.text)?.[1] as string;
      expect((await call(client, 'read_note', { id: noteId })).text).toContain('Un párrafo');
    } finally {
      await client.close();
    }
  });

  it('proyecto ajeno: 403 en lectura y escritura; no aparece en list_projects', async () => {
    const foreign = await seedProject(db, { ownerId: STRANGER });
    const client = await connect((await seedToken(db, OWNER)).token);
    try {
      expect(await call(client, 'read_board', { id: foreign })).toMatchObject({ isError: true });
      expect((await call(client, 'read_board', { id: foreign })).text).toMatch(/^403/);
      const w = await call(client, 'update_board', {
        id: foreign,
        mermaid: 'flowchart LR\nA-->B',
        mode: 'replace',
      });
      expect(w.isError).toBe(true);
      expect(w.text).toMatch(/^403/);
      expect((await call(client, 'list_projects', {})).text).not.toContain(foreign);
    } finally {
      await client.close();
    }
  });
});
