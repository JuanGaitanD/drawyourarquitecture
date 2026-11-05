import type { Firestore } from 'firebase-admin/firestore';
import { beforeAll, describe, expect, it } from 'vitest';
import { decode } from '../domain/codec';
import { validateBoardContent } from '../editors/board/model/validate';
import { getDb } from './admin';
import { ToolError, authenticate, canCreate } from './authz';
import { decodeNote, noteText } from './note';
import { EMULATOR, seedProject, seedToken, uniq } from './testkit';
import {
  createBoard,
  createNote,
  listProjects,
  readBoard,
  readNote,
  updateBoard,
  type ToolContext,
} from './tools';

// Integración contra el emulador de Firestore (Admin con FIRESTORE_EMULATOR_HOST). Sin emulador se omite.
describe.skipIf(!EMULATOR)('herramientas MCP · emulador', () => {
  let db: Firestore;
  const OWNER = uniq('dueno');
  const ALLOWED = uniq('permitido');
  const STRANGER = uniq('ajeno');
  const EDITOR = uniq('editor');
  const VIEWER = uniq('viewer');
  const as = (uid: string): ToolContext => ({ db, uid });

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
    process.env.OWNER_UID = OWNER;
    db = getDb();
    await db.collection('allowedUsers').doc(ALLOWED).set({ email: 'a@b.c', addedAt: 1 });
  });

  describe('autenticación', () => {
    it('token válido → uid y lastUsedAt; revocado, desconocido o ausente → 401', async () => {
      const ok = await seedToken(db, OWNER);
      expect(await authenticate(db, `Bearer ${ok.token}`)).toBe(OWNER);
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

    it('canCreate: dueño y allowedUsers sí; el resto no', async () => {
      expect(await canCreate(db, OWNER)).toBe(true);
      expect(await canCreate(db, ALLOWED)).toBe(true);
      expect(await canCreate(db, STRANGER)).toBe(false);
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

      const { data } = await listProjects(as(uid), {});
      const projects = (data as { projects: { id: string; role: string }[] }).projects;
      expect(projects.map((p) => p.id).sort()).toEqual([own, shared].sort());
      expect(projects.find((p) => p.id === shared)?.role).toBe('editor');
      expect(projects.find((p) => p.id === own)?.role).toBe('owner');
      expect(projects.some((p) => p.id === foreign)).toBe(false);

      const notes = (await listProjects(as(uid), { type: 'note' })).data as { projects: { id: string }[] };
      expect(notes.projects.map((p) => p.id)).toEqual([own]);
    });
  });

  describe('read_note / read_board', () => {
    it('dueño, miembro y público leen; un ajeno recibe 403; inexistente 404; tipo equivocado 400', async () => {
      const id = await seedProject(db, { ownerId: OWNER, type: 'note', members: { [VIEWER]: 'viewer' } });
      const r = await readNote(as(OWNER), { id });
      expect(r.text).toContain('Hola');
      expect(r.text).toContain('mundo');
      expect(await status(readNote(as(VIEWER), { id }))).toBe(0);
      expect(await status(readNote(as(STRANGER), { id }))).toBe(403);
      expect(await status(readNote(as(OWNER), { id: 'no-existe' }))).toBe(404);
      expect(await status(readNote(as(OWNER), { id: 'a/b' }))).toBe(400);
      expect(await status(readBoard(as(OWNER), { id }))).toBe(400);

      const pub = await seedProject(db, { ownerId: OWNER, type: 'note', isPublic: true });
      expect(await status(readNote(as(STRANGER), { id: pub }))).toBe(0);
    });

    it('read_board devuelve Mermaid y JSON de lo creado', async () => {
      const { data } = await createBoard(as(OWNER), {
        title: 'Flujo',
        mermaid: 'flowchart LR\n A[Cliente] -->|HTTP| B[API]',
      });
      const id = (data as { id: string }).id;
      const read = await readBoard(as(OWNER), { id });
      const d = read.data as { mermaid: string; nodes: { label: string }[]; edges: { label?: string }[] };
      expect(d.mermaid).toContain('Cliente');
      expect(d.mermaid).toContain('API');
      expect(d.nodes.map((n) => n.label).sort()).toEqual(['API', 'Cliente']);
      expect(d.edges[0].label).toBe('HTTP');
      expect(await status(readBoard(as(STRANGER), { id }))).toBe(403);
    });
  });

  describe('create_note / create_board', () => {
    it('create_note guarda proyecto + content en revisión 0, a nombre del llamante', async () => {
      const res = await createNote(as(OWNER), { title: 'Apuntes', text: '# Idea\n\nUno\n\nDos' });
      const id = (res.data as { id: string }).id;
      const project = (await db.collection('projects').doc(id).get()).data();
      expect(project).toMatchObject({ ownerId: OWNER, type: 'note', title: 'Apuntes', isPublic: false });
      const content = (
        await db.collection('projects').doc(id).collection('content').doc('main').get()
      ).data();
      expect(content).toMatchObject({ schemaVersion: 1, revision: 0 });
      expect(noteText(decodeNote(content?.data).elements)).toBe('Idea\n\nUno\n\nDos');
    });

    it('create_* exigen ser el dueño o estar en allowedUsers (403 si no); límites de tamaño', async () => {
      expect(await status(createNote(as(STRANGER), { title: 'x', text: 'y' }))).toBe(403);
      expect(await status(createBoard(as(STRANGER), { title: 'x', mermaid: 'flowchart LR\nA-->B' }))).toBe(
        403,
      );
      expect(await status(createNote(as(ALLOWED), { title: 'x', text: 'y' }))).toBe(0);
      expect(await status(createNote(as(OWNER), { title: 'x'.repeat(121), text: 'y' }))).toBe(400);
      expect(await status(createNote(as(OWNER), { title: 'x', text: 'y'.repeat(200_001) }))).toBe(413);
      expect(await status(createBoard(as(OWNER), { title: 'x', mermaid: 'A'.repeat(100_001) }))).toBe(413);
    });

    it('create_board: Mermaid → tablero válido, ordenado y persistido; Mermaid roto → 400 con la línea', async () => {
      const res = await createBoard(as(OWNER), {
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

      const bad = createBoard(as(OWNER), { title: 'roto', mermaid: 'esto no es mermaid' });
      await expect(bad).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('update_board', () => {
    const nodes = async (id: string) => {
      const r = (await readBoard(as(OWNER), { id })).data as {
        nodes: { label: string; y: number }[];
        revision: number;
      };
      return r;
    };

    it('ignora un `mode: replace` heredado: nunca sustituye el contenido', async () => {
      const id = (
        (await createBoard(as(OWNER), { title: 't', mermaid: 'flowchart LR\nA[Uno]-->B[Dos]' })).data as {
          id: string;
        }
      ).id;
      const before = await nodes(id);
      const legacy = { id, mermaid: 'flowchart LR\nC[Tres]', mode: 'replace' } as Parameters<typeof updateBoard>[1];
      await updateBoard(as(OWNER), legacy);
      const after = await nodes(id);
      expect(after.nodes.map((n) => n.label).sort()).toEqual(['Dos', 'Tres', 'Uno']);
      const kept = after.nodes.filter((n) => before.nodes.some((o) => o.label === n.label && o.y === n.y));
      expect(kept).toHaveLength(2);
    });

    it('append conserva lo existente y coloca lo nuevo debajo', async () => {
      const id = (
        (await createBoard(as(OWNER), { title: 't', mermaid: 'flowchart LR\nA[Uno]-->B[Dos]' })).data as {
          id: string;
        }
      ).id;
      await updateBoard(as(OWNER), { id, mermaid: 'flowchart LR\nC[Tres]-->D[Cuatro]' });
      const r = await nodes(id);
      expect(r.nodes.map((n) => n.label).sort()).toEqual(['Cuatro', 'Dos', 'Tres', 'Uno']);
      const maxOld = Math.max(...r.nodes.filter((n) => ['Uno', 'Dos'].includes(n.label)).map((n) => n.y));
      const minNew = Math.min(...r.nodes.filter((n) => ['Tres', 'Cuatro'].includes(n.label)).map((n) => n.y));
      expect(minNew).toBeGreaterThan(maxOld);
      expect(r.revision).toBe(1);
    });

    it('dos escrituras simultáneas se serializan: revisión +2 y no se pierde ninguna', async () => {
      const id = (
        (await createBoard(as(OWNER), { title: 't', mermaid: 'flowchart LR\nA[Base]' })).data as {
          id: string;
        }
      ).id;
      await Promise.all([
        updateBoard(as(OWNER), { id, mermaid: 'flowchart LR\nX[Uno]' }),
        updateBoard(as(OWNER), { id, mermaid: 'flowchart LR\nY[Dos]' }),
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
      expect(await status(updateBoard(as(EDITOR), args))).toBe(0);
      expect(await status(updateBoard(as(VIEWER), args))).toBe(403);
      expect(await status(updateBoard(as(STRANGER), args))).toBe(403);
      expect(await status(updateBoard(as(OWNER), { ...args, mermaid: 'basura' }))).toBe(400);
      expect(await status(updateBoard(as(OWNER), { ...args, mermaid: 'A'.repeat(100_001) }))).toBe(413);
      expect(await status(updateBoard(as(OWNER), { ...args, id: 'no-existe' }))).toBe(404);
      const note = await seedProject(db, { ownerId: OWNER, type: 'note' });
      expect(await status(updateBoard(as(OWNER), { ...args, id: note }))).toBe(400);
    });
  });
});
