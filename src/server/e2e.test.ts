import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminDb } from './admin';
import { EMULATOR, OWNER, loadRules, seedAllowedUser, seedProject, seedToken, uniq } from './testkit';

// De extremo a extremo: el bundle de producción (api/_mcp.mjs) en un proceso Node aparte, hablado con un
// cliente MCP del SDK por Streamable HTTP. Necesita el emulador de Firestore.
describe.skipIf(!EMULATOR)('servidor MCP · extremo a extremo', () => {
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
    await loadRules();
    db = getAdminDb();
    child = spawn(process.execPath, ['scripts/mcp-serve.mjs', '0'], {
      env: { ...process.env },
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

  // Primera llamada a Firestore desde el proceso hijo: Admin busca antes credenciales de GCE y, sin red de Google,
  // espera su timeout (unos 5 s). Margen para ese arranque en frío.
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
  }, 20_000);

  it('con token: lista las herramientas, crea un board desde Mermaid, lo lee y lo amplía', async () => {
    const { token } = await seedToken(db, await seedAllowedUser(db));
    const client = await connect(token);
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual([
        'create_board',
        'create_folder',
        'create_note',
        'delete_folder',
        'list_projects',
        'move_project',
        'read_board',
        'read_note',
        'update_board',
        'update_folder',
        'update_note',
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
      });
      expect(updated.text).toContain('revisión 1');
      expect((await call(client, 'read_board', { id })).text).toContain('Cache');

      const note = await call(client, 'create_note', { title: 'Nota E2E', text: '# Hola\n\nUn párrafo' });
      const noteId = /Nota creada: (\S+)/.exec(note.text)?.[1] as string;
      expect((await call(client, 'read_note', { id: noteId })).text).toContain('Un párrafo');

      const edited = await call(client, 'update_note', {
        id: noteId,
        title: 'Nota editada',
        text: 'Hola\n\nOtro párrafo',
      });
      expect(edited).toMatchObject({ isError: false });
      const reread = (await call(client, 'read_note', { id: noteId })).text;
      expect(reread).toContain('# Nota editada');
      expect(reread).toContain('Otro párrafo');
      expect(reread).not.toContain('Un párrafo');
      expect((await call(client, 'update_note', { id: noteId })).text).toMatch(/^400/);
    } finally {
      await client.close();
    }
  });

  it('carpetas: crea anidadas, crea y mueve proyectos dentro, y list_projects da los ids y la ruta', async () => {
    const { token } = await seedToken(db, await seedAllowedUser(db));
    const client = await connect(token);
    const idOf = (re: RegExp, text: string) => re.exec(text)?.[1] as string;
    try {
      const top = idOf(
        /Carpeta creada: (\S+)/,
        (await call(client, 'create_folder', { name: 'WigiLabs' })).text,
      );
      const sub = idOf(
        /Carpeta creada: (\S+)/,
        (await call(client, 'create_folder', { name: 'Aplicativo PMO', parentId: top })).text,
      );
      const empty = idOf(
        /Carpeta creada: (\S+)/,
        (await call(client, 'create_folder', { name: 'Vacía' })).text,
      );
      const note = await call(client, 'create_note', { title: 'Nota', text: 'x', folderId: sub });
      expect(note.text).toContain('en «WigiLabs / Aplicativo PMO»');
      const noteId = idOf(/Nota creada: (\S+)/, note.text);
      expect((await db.collection('projects').doc(noteId).get()).data()).toMatchObject({ folderId: sub });

      const board = await call(client, 'create_board', { title: 'Diagrama', mermaid: 'flowchart LR\n  A' });
      const boardId = idOf(/Diagrama creado: (\S+)/, board.text);
      expect((await call(client, 'move_project', { id: boardId, folderId: sub })).isError).toBe(false);
      expect(
        (await call(client, 'update_folder', { id: empty, parentId: null, name: 'Vacía 2' })).isError,
      ).toBe(false);

      const listed = (await call(client, 'list_projects', {})).text;
      expect(listed).toContain(`${noteId} · note · Nota (owner) · en WigiLabs / Aplicativo PMO`);
      expect(listed).toContain(`${boardId} · board · Diagrama (owner) · en WigiLabs / Aplicativo PMO`);
      expect(listed).toContain(`- ${empty} · Vacía 2\n- ${top} · WigiLabs\n  - ${sub} · Aplicativo PMO`);
      expect((await call(client, 'delete_folder', { id: sub })).text).toMatch(/^409/);
      expect((await call(client, 'delete_folder', { id: empty })).isError).toBe(false);
    } finally {
      await client.close();
    }
  });

  it('audita cada herramienta en mcpAudit, con el uid y el hash del token', async () => {
    const { token, hash } = await seedToken(db, OWNER);
    const client = await connect(token);
    let id: string | undefined;
    try {
      const created = await call(client, 'create_note', { title: 'Auditada', text: 'x' });
      id = /Nota creada: (\S+)/.exec(created.text)?.[1] as string;
      await call(client, 'read_note', { id });
      await call(client, 'read_board', { id: 'no-existe' });
      await call(client, 'update_note', { id, text: 'y' });
      await call(client, 'create_folder', { name: 'Auditada' });
    } finally {
      await client.close();
    }
    const rows = (await db.collection('mcpAudit').where('tokenHash', '==', hash).get()).docs.map((d) =>
      d.data(),
    );
    const byTool = (tool: string) => rows.filter((r) => r.tool === tool);
    expect(byTool('create_note')).toHaveLength(1);
    expect(byTool('create_note')[0]).toMatchObject({ uid: OWNER, ok: true });
    expect(byTool('read_note')[0]).toMatchObject({ ok: true });
    expect(byTool('read_board')[0]).toMatchObject({ ok: false, projectId: 'no-existe' });
    expect(byTool('update_note')[0]).toMatchObject({ ok: true, projectId: id });
    expect(byTool('create_folder')[0]).toMatchObject({ ok: true });
    expect(byTool('create_folder')[0]).not.toHaveProperty('projectId');
    expect(rows.every((r) => r.expireAt.toMillis() > Date.now())).toBe(true);
  });

  it('por encima de 60 peticiones por minuto: 429 con Retry-After, y otro token sigue pasando', async () => {
    // Que no se cruce una frontera de ventana a mitad de la prueba.
    const left = 60_000 - (Date.now() % 60_000);
    if (left < 15_000) await new Promise((r) => setTimeout(r, left + 200));
    const { token } = await seedToken(db, OWNER);
    const post = () =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    for (let i = 0; i < 60; i++) expect((await post()).status).toBe(200);
    const over = await post();
    expect(over.status).toBe(429);
    const retry = Number(over.headers.get('retry-after'));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    const other = await connect((await seedToken(db, OWNER)).token);
    await other.close();
  }, 60_000);

  it('proyecto ajeno: 403 en lectura y escritura; no aparece en list_projects', async () => {
    const foreign = await seedProject(db, { ownerId: STRANGER });
    const client = await connect((await seedToken(db, OWNER)).token);
    try {
      expect(await call(client, 'read_board', { id: foreign })).toMatchObject({ isError: true });
      expect((await call(client, 'read_board', { id: foreign })).text).toMatch(/^403/);
      const w = await call(client, 'update_board', {
        id: foreign,
        mermaid: 'flowchart LR\nA-->B',
      });
      expect(w.isError).toBe(true);
      expect(w.text).toMatch(/^403/);
      expect((await call(client, 'list_projects', {})).text).not.toContain(foreign);
    } finally {
      await client.close();
    }
  });
});
