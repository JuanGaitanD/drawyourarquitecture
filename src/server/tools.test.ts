import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decode } from '../domain/codec';
import { validateBoardContent } from '../editors/board/model/validate';
import { getAdminAuth, getAdminDb } from './admin';
import { ToolError, authenticate } from './authz';
import { buildNote, decodeNote, encodeNote, noteText } from './note';
import { EMULATOR, OWNER, loadRules, seedProject, seedToken, uniq, userCtx } from './testkit';
import { closeUserDbs } from './userDb';
import {
  createBoard,
  createNote,
  listProjects,
  readBoard,
  readNote,
  updateBoard,
  type ToolContext,
} from './tools';

// Integración contra los emuladores: las herramientas operan con el SDK web autenticado (las reglas aplican);
// Admin solo siembra datos. Sin FIRESTORE_EMULATOR_HOST se omite.
describe.skipIf(!EMULATOR)('herramientas MCP · emulador', () => {
  let db: Firestore;
  const STRANGER = uniq('ajeno');
  const EDITOR = uniq('editor');
  const VIEWER = uniq('viewer');
  const as = (uid: string): Promise<ToolContext> => userCtx(uid);

  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return 0;
    } catch (e) {
      if (e instanceof ToolError) return e.status;
      throw e;
    }
  };

  beforeAll(async () => {
    await loadRules();
    db = getAdminDb();
  });
  afterAll(closeUserDbs);

  describe('autenticación', () => {
    it('token válido → uid y lastUsedAt; revocado, desconocido o ausente → 401', async () => {
      const ok = await seedToken(db, OWNER);
      expect(await authenticate(db, `Bearer ${ok.token}`)).toEqual({ uid: OWNER, tokenHash: ok.hash });
      expect((await db.collection('mcpTokens').doc(ok.hash).get()).data()?.lastUsedAt).toBeTypeOf('number');

      const revoked = await seedToken(db, OWNER, true);
      expect(await status(authenticate(db, `Bearer ${revoked.token}`))).toBe(401);
      expect(await status(authenticate(db, 'Bearer dya_noexiste'))).toBe(401);
      expect(await status(authenticate(db, 'Bearer otraCosa'))).toBe(401);
      expect(await status(authenticate(db, undefined))).toBe(401);
      expect(await status(authenticate(db, `Basic ${ok.token}`))).toBe(401);
    });

    it('lastUsedAt se escribe como mucho una vez por hora', async () => {
      const { token, hash } = await seedToken(db, OWNER);
      const ref = db.collection('mcpTokens').doc(hash);
      await authenticate(db, `Bearer ${token}`);
      const first = (await ref.get()).data()?.lastUsedAt as number;
      await authenticate(db, `Bearer ${token}`);
      expect((await ref.get()).data()?.lastUsedAt).toBe(first);

      const old = Date.now() - 2 * 3_600_000;
      await ref.update({ lastUsedAt: old });
      await authenticate(db, `Bearer ${token}`);
      expect((await ref.get()).data()?.lastUsedAt).toBeGreaterThan(old);
    });
  });

  describe('list_projects', () => {
    it('propios y compartidos, con su rol; nunca los ajenos; filtra por tipo', async () => {
      const uid = uniq('lista');
      const own = await seedProject(db, { ownerId: uid, type: 'note', title: 'mía' });
      const shared = await seedProject(db, {
        ownerId: STRANGER,
        members: { [uid]: 'editor' },
        title: 'compartida',
      });
      const foreign = await seedProject(db, { ownerId: STRANGER, title: 'ajena' });

      const { data } = await listProjects(await as(uid), {});
      const projects = (data as { projects: { id: string; role: string }[] }).projects;
      expect(projects.map((p) => p.id).sort()).toEqual([own, shared].sort());
      expect(projects.find((p) => p.id === shared)?.role).toBe('editor');
      expect(projects.find((p) => p.id === own)?.role).toBe('owner');
      expect(projects.some((p) => p.id === foreign)).toBe(false);

      const notes = (await listProjects(await as(uid), { type: 'note' })).data as {
        projects: { id: string }[];
      };
      expect(notes.projects.map((p) => p.id)).toEqual([own]);
    });
  });

  describe('read_note / read_board', () => {
    it('dueño, miembro y público leen; un ajeno o un id inexistente reciben 403; tipo equivocado 400', async () => {
      const id = await seedProject(db, { ownerId: OWNER, type: 'note', members: { [VIEWER]: 'viewer' } });
      const r = await readNote(await as(OWNER), { id });
      expect(r.text).toContain('Hola');
      expect(r.text).toContain('mundo');
      expect(await status(readNote(await as(VIEWER), { id }))).toBe(0);
      expect(await status(readNote(await as(STRANGER), { id }))).toBe(403);
      expect(await status(readNote(await as(OWNER), { id: 'no-existe' }))).toBe(403);
      expect(await status(readNote(await as(OWNER), { id: 'a/b' }))).toBe(400);
      expect(await status(readBoard(await as(OWNER), { id }))).toBe(400);

      const pub = await seedProject(db, { ownerId: OWNER, type: 'note', isPublic: true });
      expect(await status(readNote(await as(STRANGER), { id: pub }))).toBe(0);
    });

    it('read_note lista las imágenes y los diagramas incrustados (con su Mermaid si se pueden leer)', async () => {
      const board = (
        (await createBoard(await as(OWNER), { title: 'Flujo', mermaid: 'flowchart LR\nA[Web] --> B[API]' }))
          .data as { id: string }
      ).id;
      const privateBoard = await seedProject(db, { ownerId: STRANGER, title: 'Ajeno' });
      const embed = (id: string) => ({
        type: 'embeddable',
        isDeleted: false,
        link: `https://drawyourarchitecture.vercel.app/embed/board/${id}`,
      });
      const base = buildNote('Con adjuntos');
      const note = await seedProject(db, {
        ownerId: OWNER,
        type: 'note',
        data: encodeNote({
          ...base,
          elements: [
            ...base.elements,
            { type: 'image', isDeleted: false, fileId: 'img-1' },
            embed(board),
            embed(privateBoard),
          ],
          files: { 'img-1': { mimeType: 'image/png', created: 1 } },
        }),
      });

      const r = await readNote(await as(OWNER), { id: note });
      const d = r.data as {
        images: { fileId: string; mimeType: string }[];
        embeds: { boardId: string; mermaid?: string; title?: string }[];
      };
      expect(d.images).toEqual([{ fileId: 'img-1', mimeType: 'image/png' }]);
      expect(d.embeds.map((e) => e.boardId)).toEqual([board, privateBoard]);
      expect(d.embeds[0].mermaid).toContain('Web');
      expect(d.embeds[0].title).toBe('Flujo');
      expect(d.embeds[1]).toEqual({ boardId: privateBoard }); // sin acceso: solo el id
      expect(r.text).toContain('img-1 (image/png)');
      expect(r.text).toContain('```mermaid');
      expect(r.text).toContain(`${privateBoard} (sin acceso o ilegible)`);
    });

    it('read_board devuelve Mermaid y JSON de lo creado', async () => {
      const { data } = await createBoard(await as(OWNER), {
        title: 'Flujo',
        mermaid: 'flowchart LR\n A[Cliente] -->|HTTP| B[API]',
      });
      const id = (data as { id: string }).id;
      const read = await readBoard(await as(OWNER), { id });
      const d = read.data as { mermaid: string; nodes: { label: string }[]; edges: { label?: string }[] };
      expect(d.mermaid).toContain('Cliente');
      expect(d.mermaid).toContain('API');
      expect(d.nodes.map((n) => n.label).sort()).toEqual(['API', 'Cliente']);
      expect(d.edges[0].label).toBe('HTTP');
      expect(await status(readBoard(await as(STRANGER), { id }))).toBe(403);
    });
  });

  describe('create_note / create_board', () => {
    it('create_note guarda proyecto + content en revisión 0, a nombre del llamante', async () => {
      const res = await createNote(await as(OWNER), { title: 'Apuntes', text: '# Idea\n\nUno\n\nDos' });
      const id = (res.data as { id: string }).id;
      const project = (await db.collection('projects').doc(id).get()).data();
      expect(project).toMatchObject({ ownerId: OWNER, type: 'note', title: 'Apuntes', isPublic: false });
      const content = (
        await db.collection('projects').doc(id).collection('content').doc('main').get()
      ).data();
      expect(content).toMatchObject({ schemaVersion: 1, revision: 0 });
      expect(noteText(decodeNote(content?.data).elements)).toBe('Idea\n\nUno\n\nDos');
    });

    it('create_* exigen ser el dueño o estar permitido (403 si no); límites de tamaño', async () => {
      expect(await status(createNote(await as(STRANGER), { title: 'x', text: 'y' }))).toBe(403);
      expect(
        await status(createBoard(await as(STRANGER), { title: 'x', mermaid: 'flowchart LR\nA-->B' })),
      ).toBe(403);
      expect(await status(createNote(await as(OWNER), { title: 'x', text: 'y' }))).toBe(0);
      expect(await status(createNote(await as(OWNER), { title: 'x'.repeat(121), text: 'y' }))).toBe(400);
      expect(await status(createNote(await as(OWNER), { title: 'x', text: 'y'.repeat(200_001) }))).toBe(413);
      expect(await status(createBoard(await as(OWNER), { title: 'x', mermaid: 'A'.repeat(100_001) }))).toBe(
        413,
      );
    });

    it('create_* con una cuenta permitida por correo verificado: sí; sin verificar o fuera de la lista: 403', async () => {
      const mail = `${uniq('amiga')}@example.com`;
      await db.collection('allowedEmails').doc(mail).set({ email: mail, addedAt: 1 });
      const auth = getAdminAuth();
      const verified = uniq('verif');
      const unverified = uniq('sinverif');
      await auth.createUser({ uid: verified, email: mail, emailVerified: true });
      await auth.createUser({ uid: unverified, email: mail.replace('@', '.x@'), emailVerified: false });
      await db.collection('allowedEmails').doc(mail.replace('@', '.x@')).set({ email: mail, addedAt: 1 });

      const ok = await createNote(await as(verified), { title: 'de una amiga', text: 'hola' });
      const id = (ok.data as { id: string }).id;
      expect((await db.collection('projects').doc(id).get()).data()).toMatchObject({ ownerId: verified });
      expect(await status(createNote(await as(unverified), { title: 'x', text: 'y' }))).toBe(403);
    });

    it('create_board: Mermaid → tablero válido, ordenado y persistido; Mermaid roto → 400 con la línea', async () => {
      const res = await createBoard(await as(OWNER), {
        title: 'Arquitectura',
        mermaid: 'flowchart TD\n  subgraph Back\n    api[API] --> db[(DB)]\n  end\n  web[Web] --> api',
      });
      const id = (res.data as { id: string }).id;
      const content = (
        await db.collection('projects').doc(id).collection('content').doc('main').get()
      ).data();
      const checked = validateBoardContent(decode(content?.data));
      expect(checked.ok).toBe(true);
      if (checked.ok) {
        expect(checked.value.nodes.filter((n) => n.data.kind !== 'frame')).toHaveLength(3);
        expect(
          checked.value.nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)),
        ).toBe(true);
        expect(checked.value.nodes.find((n) => n.data.kind === 'frame')).toBeDefined();
      }

      const bad = createBoard(await as(OWNER), { title: 'roto', mermaid: 'esto no es mermaid' });
      await expect(bad).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('update_board', () => {
    const nodes = async (id: string) => {
      const r = (await readBoard(await as(OWNER), { id })).data as {
        nodes: { label: string; y: number }[];
        revision: number;
      };
      return r;
    };

    it('ignora un `mode: replace` heredado: nunca sustituye el contenido', async () => {
      const id = (
        (await createBoard(await as(OWNER), { title: 't', mermaid: 'flowchart LR\nA[Uno]-->B[Dos]' }))
          .data as {
          id: string;
        }
      ).id;
      const before = await nodes(id);
      const legacy = { id, mermaid: 'flowchart LR\nC[Tres]', mode: 'replace' } as Parameters<
        typeof updateBoard
      >[1];
      await updateBoard(await as(OWNER), legacy);
      const after = await nodes(id);
      expect(after.nodes.map((n) => n.label).sort()).toEqual(['Dos', 'Tres', 'Uno']);
      const kept = after.nodes.filter((n) => before.nodes.some((o) => o.label === n.label && o.y === n.y));
      expect(kept).toHaveLength(2);
    });

    it('append conserva lo existente y coloca lo nuevo debajo', async () => {
      const id = (
        (await createBoard(await as(OWNER), { title: 't', mermaid: 'flowchart LR\nA[Uno]-->B[Dos]' }))
          .data as {
          id: string;
        }
      ).id;
      await updateBoard(await as(OWNER), { id, mermaid: 'flowchart LR\nC[Tres]-->D[Cuatro]' });
      const r = await nodes(id);
      expect(r.nodes.map((n) => n.label).sort()).toEqual(['Cuatro', 'Dos', 'Tres', 'Uno']);
      const maxOld = Math.max(...r.nodes.filter((n) => ['Uno', 'Dos'].includes(n.label)).map((n) => n.y));
      const minNew = Math.min(...r.nodes.filter((n) => ['Tres', 'Cuatro'].includes(n.label)).map((n) => n.y));
      expect(minNew).toBeGreaterThan(maxOld);
      expect(r.revision).toBe(1);
    });

    it('dos escrituras simultáneas se serializan: revisión +2 y no se pierde ninguna', async () => {
      const id = (
        (await createBoard(await as(OWNER), { title: 't', mermaid: 'flowchart LR\nA[Base]' })).data as {
          id: string;
        }
      ).id;
      await Promise.all([
        updateBoard(await as(OWNER), { id, mermaid: 'flowchart LR\nX[Uno]' }),
        updateBoard(await as(OWNER), { id, mermaid: 'flowchart LR\nY[Dos]' }),
      ]);
      const r = await nodes(id);
      expect(r.revision).toBe(2);
      expect(r.nodes.map((n) => n.label).sort()).toEqual(['Base', 'Dos', 'Uno']);
    });

    it('permisos: editor escribe; viewer, ajeno y público ajeno reciben 403; Mermaid roto 400; tamaño 413', async () => {
      const id = await seedProject(db, {
        ownerId: OWNER,
        isPublic: true,
        members: { [EDITOR]: 'editor', [VIEWER]: 'viewer' },
      });
      const args = { id, mermaid: 'flowchart LR\nA-->B' };
      expect(await status(updateBoard(await as(EDITOR), args))).toBe(0);
      expect(await status(updateBoard(await as(VIEWER), args))).toBe(403);
      expect(await status(updateBoard(await as(STRANGER), args))).toBe(403);
      expect(await status(updateBoard(await as(OWNER), { ...args, mermaid: 'basura' }))).toBe(400);
      expect(await status(updateBoard(await as(OWNER), { ...args, mermaid: 'A'.repeat(100_001) }))).toBe(413);
      expect(await status(updateBoard(await as(OWNER), { ...args, id: 'no-existe' }))).toBe(403);
      const note = await seedProject(db, { ownerId: OWNER, type: 'note' });
      expect(await status(updateBoard(await as(OWNER), { ...args, id: note }))).toBe(400);
    });
  });

  describe('contenido troceado (> 900 000 bytes)', () => {
    // 1 500 líneas `a-->b` = 3 000 nodos y 1 500 aristas: ≈ 1,2 MB codificados, y el Mermaid cabe en el tope de 100 000.
    const bigMermaid = (tag: string, n: number) =>
      'flowchart LR\n' +
      Array.from({ length: n }, (_, i) => `${tag}${i}[Nodo ${tag}${i}]-->${tag}x${i}[Otro ${tag}${i}]`).join('\n');

    it('create_board, read_board y update_board admiten un board troceado y la revisión sube de uno en uno', async () => {
      const owner = await as(OWNER);
      const created = await createBoard(owner, { title: 'grande', mermaid: bigMermaid('a', 1500) });
      const { id, nodes: n0 } = created.data as { id: string; nodes: number };
      expect(n0).toBe(3000);

      // En Firestore: sin `data` y con trozos (lo escribe contentRepo, no una escritura propia del servidor).
      const main = db.collection('projects').doc(id).collection('content').doc('main');
      const meta = (await main.get()).data() as { data?: string; chunks?: number; revision: number };
      expect(meta.data).toBeUndefined();
      expect(meta.chunks).toBeGreaterThanOrEqual(2);
      expect(meta.revision).toBe(1);
      expect((await main.collection('chunks').get()).size).toBe(meta.chunks);

      const read = (await readBoard(owner, { id })).data as { nodes: unknown[]; revision: number };
      expect(read.nodes).toHaveLength(3000);

      const updated = await updateBoard(owner, { id, mermaid: 'flowchart LR\nZ[Final]-->Y[Fin]' });
      expect((updated.data as { nodes: number }).nodes).toBe(3002);
      const after = (await readBoard(owner, { id })).data as { nodes: unknown[]; revision: number };
      expect(after.nodes).toHaveLength(3002);
      expect(after.revision).toBe(meta.revision + 1);
    });

    it('un viewer lee el board troceado pero no lo amplía (403)', async () => {
      const id = (
        (await createBoard(await as(OWNER), { title: 'grande', mermaid: bigMermaid('b', 1500) })).data as {
          id: string;
        }
      ).id;
      await db.collection('projects').doc(id).update({ members: { [VIEWER]: 'viewer' } });
      const viewer = await as(VIEWER);
      expect(((await readBoard(viewer, { id })).data as { nodes: unknown[] }).nodes).toHaveLength(3000);
      expect(await status(updateBoard(viewer, { id, mermaid: 'flowchart LR\nA-->B' }))).toBe(403);
    });
  });
});
