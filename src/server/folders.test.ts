import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminDb } from './admin';
import { ToolError } from './authz';
import { createFolder, deleteFolder, moveProject, updateFolder } from './folders';
import { EMULATOR, loadRules, seedAllowedUser, seedProject, uniq, userCtx } from './testkit';
import { createBoard, createNote, listProjects, type ToolContext } from './tools';
import { closeUserDbs } from './userDb';

// Carpetas por MCP contra los emuladores (las reglas aplican). Cada prueba usa una persona nueva (`seedAllowedUser`)
// para no arrastrar las carpetas de otras ejecuciones.
describe.skipIf(!EMULATOR)('carpetas por MCP · emulador', () => {
  let db: Firestore;
  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return 0;
    } catch (e) {
      if (e instanceof ToolError) return e.status;
      throw e;
    }
  };
  const folderIdOf = (r: { data?: unknown }) => (r.data as { folderId: string }).folderId;
  const folder = async (id: string) => (await db.collection('folders').doc(id).get()).data();
  const project = async (id: string) => (await db.collection('projects').doc(id).get()).data();
  /** Persona nueva con su contexto y una carpeta ajena (de otra persona) para probar destinos. */
  const setup = async () => {
    const ctx = await userCtx(await seedAllowedUser(db));
    const other = uniq('otra');
    const foreign = db.collection('folders').doc();
    await foreign.set({ ownerId: other, name: 'Ajena', parentId: null, createdAt: 1, updatedAt: 1 });
    return { ctx, other, foreign: foreign.id };
  };
  const mkFolder = async (ctx: ToolContext, name: string, parentId?: string) =>
    folderIdOf(await createFolder(ctx, { name, parentId }));

  beforeAll(async () => {
    await loadRules();
    db = getAdminDb();
    // La primera alta en Auth y el primer acceso con el SDK web tardan más (Admin busca credenciales): fuera del
    // tiempo de cada prueba.
    await setup();
  }, 30_000);
  afterAll(closeUserDbs);

  it('create_folder en Inicio y dentro de otra; nombre vacío o de 41 → 400; padre inexistente o ajeno → 404', async () => {
    const { ctx, foreign } = await setup();
    const top = await mkFolder(ctx, '  WigiLabs  ');
    const sub = await mkFolder(ctx, 'Aplicativo PMO', top);
    expect(await folder(top)).toMatchObject({ ownerId: ctx.uid, name: 'WigiLabs', parentId: null });
    expect(await folder(sub)).toMatchObject({ name: 'Aplicativo PMO', parentId: top });
    expect(await status(createFolder(ctx, { name: '   ' }))).toBe(400);
    expect(await status(createFolder(ctx, { name: 'x'.repeat(41) }))).toBe(400);
    expect(await status(createFolder(ctx, { name: 'x', parentId: 'no-existe' }))).toBe(404);
    expect(await status(createFolder(ctx, { name: 'x', parentId: foreign }))).toBe(404);
    expect((await db.collection('folders').where('ownerId', '==', ctx.uid).get()).size).toBe(2);
  });

  it('list_projects: ruta de cada proyecto propio y el árbol de carpetas con sus ids (también las vacías)', async () => {
    const { ctx } = await setup();
    const top = await mkFolder(ctx, 'WigiLabs');
    const sub = await mkFolder(ctx, 'Aplicativo PMO', top);
    const empty = await mkFolder(ctx, 'Vacía');
    const id = await seedProject(db, { ownerId: ctx.uid, title: 'Arquitectura' });
    await moveProject(ctx, { id, folderId: sub });
    const { text } = await listProjects(ctx, {});
    expect(text).toContain(`${id} · board · Arquitectura (owner) · en WigiLabs / Aplicativo PMO`);
    expect(text).toContain(
      `## Carpetas\n- ${empty} · Vacía\n- ${top} · WigiLabs\n  - ${sub} · Aplicativo PMO`,
    );
  });

  it('create_note y create_board con folderId nacen dentro; con carpeta inexistente o ajena → 404 sin crear nada', async () => {
    const { ctx, foreign } = await setup();
    const f = await mkFolder(ctx, 'Destino');
    const note = await createNote(ctx, { title: 'N', text: 'hola', folderId: f });
    const board = await createBoard(ctx, { title: 'B', mermaid: 'flowchart LR\n  A --> B', folderId: f });
    expect(note.text).toContain('en «Destino»');
    expect(await project((note.data as { id: string }).id)).toMatchObject({ folderId: f });
    expect(await project((board.data as { id: string }).id)).toMatchObject({ folderId: f });
    const plain = await createNote(ctx, { title: 'Sin carpeta', text: 'x' });
    expect(await project((plain.data as { id: string }).id)).not.toHaveProperty('folderId');

    for (const folderId of ['no-existe', foreign]) {
      expect(await status(createNote(ctx, { title: 'N', text: 'x', folderId }))).toBe(404);
      expect(await status(createBoard(ctx, { title: 'B', mermaid: 'flowchart LR\n  A', folderId }))).toBe(
        404,
      );
    }
    expect((await db.collection('projects').where('ownerId', '==', ctx.uid).get()).size).toBe(3);
  });

  it('move_project a una carpeta y a Inicio; destino ajeno → 404; proyecto compartido (editor) → 403 intacto', async () => {
    const { ctx, foreign } = await setup();
    const f = await mkFolder(ctx, 'Destino');
    const id = await seedProject(db, { ownerId: ctx.uid });
    await moveProject(ctx, { id, folderId: f });
    expect(await project(id)).toMatchObject({ folderId: f });
    expect(await status(moveProject(ctx, { id, folderId: foreign }))).toBe(404);
    expect(await project(id)).toMatchObject({ folderId: f });
    await moveProject(ctx, { id, folderId: null });
    expect((await project(id))?.folderId).toBeNull();

    // En Inicio y con destino `null`, la escritura solo cambiaría `updatedAt`, que la regla de editor admite.
    const shared = await seedProject(db, { ownerId: uniq('duena'), members: { [ctx.uid]: 'editor' } });
    const before = await project(shared);
    expect(await status(moveProject(ctx, { id: shared, folderId: null }))).toBe(403);
    expect(await project(shared)).toEqual(before);
  });

  it('update_folder: renombra y mueve; ciclo → 400; ajena → 404; un nombre anterior de 45 se conserva al mover', async () => {
    const { ctx, other, foreign } = await setup();
    const a = await mkFolder(ctx, 'A');
    const b = await mkFolder(ctx, 'B', a);
    const c = await mkFolder(ctx, 'C');
    await updateFolder(ctx, { id: c, name: 'C2', parentId: a });
    expect(await folder(c)).toMatchObject({ name: 'C2', parentId: a });
    expect(await status(updateFolder(ctx, { id: c }))).toBe(400);
    expect(await status(updateFolder(ctx, { id: a, parentId: a }))).toBe(400);
    expect(await status(updateFolder(ctx, { id: a, parentId: b }))).toBe(400);
    expect(await status(updateFolder(ctx, { id: c, parentId: foreign }))).toBe(404);
    expect(await status(updateFolder(ctx, { id: foreign, name: 'Mía' }))).toBe(404);
    expect(await folder(foreign)).toMatchObject({ ownerId: other, name: 'Ajena' });
    expect(await folder(a)).toMatchObject({ parentId: null });

    const long = db.collection('folders').doc();
    const name = 'L'.repeat(45);
    await long.set({ ownerId: ctx.uid, name, parentId: null, createdAt: 1, updatedAt: 1 });
    await updateFolder(ctx, { id: long.id, parentId: a });
    expect(await folder(long.id)).toMatchObject({ name, parentId: a });
    expect(await status(updateFolder(ctx, { id: long.id, name: 'M'.repeat(41) }))).toBe(400);
  });

  it('delete_folder: con proyecto o subcarpeta → 409; vacía → la borra; ajena o inexistente → 404', async () => {
    const { ctx, other, foreign } = await setup();
    const withProject = await mkFolder(ctx, 'Con proyecto');
    await moveProject(ctx, { id: await seedProject(db, { ownerId: ctx.uid }), folderId: withProject });
    const withSub = await mkFolder(ctx, 'Con subcarpeta');
    const sub = await mkFolder(ctx, 'Sub', withSub);
    expect(await status(deleteFolder(ctx, { id: withProject }))).toBe(409);
    expect(await status(deleteFolder(ctx, { id: withSub }))).toBe(409);
    await deleteFolder(ctx, { id: sub });
    await deleteFolder(ctx, { id: withSub });
    expect(await folder(withSub)).toBeUndefined();
    expect(await status(deleteFolder(ctx, { id: foreign }))).toBe(404);
    expect(await status(deleteFolder(ctx, { id: 'no-existe' }))).toBe(404);
    expect(await folder(foreign)).toMatchObject({ ownerId: other });
  });
});
