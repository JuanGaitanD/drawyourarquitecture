import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createContentRepo } from '../../src/infrastructure/firebase/contentRepo';
import { OWNER, STRANGER, createEnv, seedProject } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());

const EDITOR = 'editor-uid';
const VIEWER = 'viewer-uid';

beforeEach(async () => {
  await env.clearFirestore();
  await seedProject(env, 'p', { members: { [EDITOR]: 'editor', [VIEWER]: 'viewer' } });
  await seedProject(env, 'publico', { isPublic: true });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
type Db = ReturnType<typeof as>;
const main = (fs: Db, id = 'p') => doc(fs, 'projects', id, 'content', 'main');
const chunk = (fs: Db, i: number | string, id = 'p') =>
  doc(fs, 'projects', id, 'content', 'main', 'chunks', String(i));
const meta = (revision: number, chunks = 2) => ({ schemaVersion: 1, revision, updatedAt: 2, chunks });
const repoFor = (uid: string) => createContentRepo(async () => ({ fs: sdk, db: as(uid) as never }));
const x = (n: number) => 'x'.repeat(n);

/** Escritura troceada a pelo: meta + trozos en un batch (lo que hace la transacción del repo). */
function writeChunked(fs: Db, revision: number, parts: string[], id = 'p') {
  const b = writeBatch(fs);
  b.set(main(fs, id), meta(revision, parts.length));
  parts.forEach((data, i) => b.set(chunk(fs, i, id), { data }));
  return b.commit();
}

/** Ids de los trozos que hay en el emulador (saltándose las reglas). */
async function listChunks(id = 'p'): Promise<string[]> {
  let out: string[] = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDocs(collection(main(ctx.firestore(), id), 'chunks'))).docs.map((d) => d.id);
  });
  return out.sort();
}

/** Como `writeChunked`, pero con el cuerpo exacto de cada trozo (para probar cuerpos inválidos). */
function writeChunkedRaw(fs: Db, revision: number, bodies: Record<string, unknown>[]) {
  const b = writeBatch(fs);
  b.set(main(fs), meta(revision, bodies.length));
  bodies.forEach((body, i) => b.set(chunk(fs, i), body));
  return b.commit();
}

/** Guarda un contenido más corto: meta con `chunks` (o `data` si vale 1) y borra los trozos `gone`. */
function shrink(fs: Db, revision: number, chunks: number, gone: number[]) {
  const b = writeBatch(fs);
  b.set(
    main(fs),
    chunks > 1 ? meta(revision, chunks) : { data: '{}', schemaVersion: 1, revision, updatedAt: 2 },
  );
  gone.forEach((i) => b.delete(chunk(fs, i)));
  return b.commit();
}

async function waitFor(cond: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('Tiempo agotado esperando el snapshot.');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('reglas · contenido troceado', () => {
  it('dueño y editor escriben meta y trozos; el visor y un extraño no', async () => {
    await assertSucceeds(writeChunked(as(OWNER), 1, ['a', 'b']));
    await assertSucceeds(writeChunked(as(EDITOR), 2, ['a', 'b', 'c']));
    await assertFails(writeChunked(as(VIEWER), 3, ['a', 'b']));
    await assertFails(writeChunked(as(STRANGER), 3, ['a', 'b']));
  });

  it('la lectura de los trozos es la del contenido', async () => {
    await assertSucceeds(writeChunked(as(OWNER), 1, ['a', 'b']));
    await assertSucceeds(getDoc(chunk(as(VIEWER), 0)));
    await assertFails(getDoc(chunk(as(STRANGER), 0)));
    await assertFails(getDoc(chunk(env.unauthenticatedContext().firestore(), 0)));
    // Un proyecto público se lee sin sesión.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(chunk(ctx.firestore(), 0, 'publico'), { data: 'x' });
    });
    await assertSucceeds(getDoc(chunk(env.unauthenticatedContext().firestore(), 0, 'publico')));
  });

  it('un trozo admite 900 000 y rechaza 900 001, un valor que no es string y claves de más', async () => {
    const fs = as(OWNER);
    await assertSucceeds(writeChunked(fs, 1, [x(900_000), 'b']));
    await assertFails(writeChunked(fs, 2, ['a', x(900_001)]));
    await assertFails(writeChunkedRaw(fs, 2, [{ data: 'a' }, { data: 5 }]));
    await assertFails(writeChunkedRaw(fs, 2, [{ data: 'a' }, { data: 'x', extra: 1 }]));
  });

  it('el índice del trozo va de 0 a 11', async () => {
    const fs = as(OWNER);
    await assertSucceeds(writeChunked(fs, 1, Array.from({ length: 12 }, () => 'x')));
    for (const i of [12, 'a']) {
      const b = writeBatch(fs); // ni el índice 12 ni uno no numérico caben, ni con `chunks` 12
      b.set(main(fs), meta(2, 12));
      b.set(chunk(fs, i), { data: 'x' });
      await assertFails(b.commit());
    }
  });

  it('la meta troceada: chunks entero de 2 a 12, sin data, revisión +1 y campos cerrados', async () => {
    const fs = as(OWNER);
    await assertSucceeds(setDoc(main(fs), meta(1, 12)));
    await assertFails(setDoc(main(fs), meta(2, 1)));
    await assertFails(setDoc(main(fs), meta(2, 13)));
    await assertFails(setDoc(main(fs), meta(2, 2.5)));
    await assertFails(setDoc(main(fs), { ...meta(2), data: 'x' })); // data y chunks a la vez
    await assertFails(setDoc(main(fs), { ...meta(2), extra: 1 }));
    await assertFails(setDoc(main(fs), meta(5))); // salta revisiones
    await assertSucceeds(setDoc(main(fs), { data: '{}', schemaVersion: 1, revision: 2, updatedAt: 3 })); // vuelve a un doc
  });

  it('el contenido en un documento sigue limitado a 900 000 bytes', async () => {
    const fs = as(OWNER);
    const big = (n: number) => ({ data: x(n), schemaVersion: 1, revision: 1, updatedAt: 2 });
    await assertFails(setDoc(main(fs), big(900_001)));
    await assertSucceeds(setDoc(main(fs), big(900_000)));
  });

  it('dueño y editor borran trozos sobrantes al guardar más corto; el visor no; solo el dueño los lista', async () => {
    await assertSucceeds(writeChunked(as(OWNER), 1, ['a', 'b', 'c']));
    await assertFails(shrink(as(VIEWER), 2, 2, [2]));
    await assertSucceeds(shrink(as(EDITOR), 2, 2, [2]));
    await assertSucceeds(getDocs(collection(main(as(OWNER)), 'chunks')));
    await assertFails(getDocs(collection(main(as(EDITOR)), 'chunks')));
  });
});

describe('contentRepo · contenido grande contra las reglas', () => {
  it('guarda 2,5 MB en trozos y los carga idénticos; la revisión sube de uno en uno', async () => {
    const owner = repoFor(OWNER);
    const data = JSON.stringify({ t: x(2_500_000) });
    expect(await owner.save('p', data, 0)).toEqual({ revision: 1 });
    expect(await listChunks()).toEqual(['0', '1', '2']);
    const rec = await repoFor(VIEWER).load('p');
    expect(rec?.data).toBe(data);
    expect(rec?.revision).toBe(1);
    expect(await owner.save('p', data + ' ', 1)).toEqual({ revision: 2 });
  });

  it('guarda el tope práctico de 8 MiB en una sola transacción', async () => {
    const data = JSON.stringify({ t: x(8 * 1024 * 1024 - 20) });
    expect(await repoFor(EDITOR).save('p', data, 0)).toEqual({ revision: 1 });
    expect((await repoFor(OWNER).load('p'))?.data).toBe(data);
  });

  it('caracteres de varios bytes se recomponen idénticos', async () => {
    const data = JSON.stringify({ t: 'añ😀€'.repeat(250_000) }); // ~2,5 MB
    await repoFor(OWNER).save('p', data, 0);
    expect((await repoFor(OWNER).load('p'))?.data).toBe(data);
  });

  it('al volver a un contenido pequeño escribe `data` y borra los trozos de antes', async () => {
    const owner = repoFor(OWNER);
    await owner.save('p', JSON.stringify({ t: x(2_000_000) }), 0);
    expect(await listChunks()).toHaveLength(3);
    await owner.save('p', '{"t":"corto"}', 1);
    expect(await listChunks()).toHaveLength(0);
    expect((await owner.load('p'))?.data).toBe('{"t":"corto"}');
  });

  it('al pasar de 3 a 2 trozos borra solo el sobrante', async () => {
    const owner = repoFor(OWNER);
    await owner.save('p', JSON.stringify({ t: x(2_000_000) }), 0);
    await owner.save('p', JSON.stringify({ t: x(1_000_000) }), 1);
    expect(await listChunks()).toEqual(['0', '1']);
  });

  it('un documento pequeño pasa a troceado y vuelve a cargarse', async () => {
    const owner = repoFor(OWNER);
    expect(await owner.save('p', '{"a":1}', 0)).toEqual({ revision: 1 });
    const big = JSON.stringify({ t: x(1_000_000) });
    expect(await owner.save('p', big, 1)).toEqual({ revision: 2 });
    expect((await owner.load('p'))?.data).toBe(big);
  });

  it('revisión desfasada: sin merge es conflicto; con merge fusiona contra el remoto troceado', async () => {
    const owner = repoFor(OWNER);
    const remote = JSON.stringify({ r: x(1_500_000) });
    await repoFor(EDITOR).save('p', remote, 0); // otro cliente → revisión 1
    expect(await owner.save('p', '{"mio":1}', 0)).toEqual({ conflict: true });
    const res = await owner.save('p', '{"mio":1}', 0, (local, r) => `${local}|${r.length}`);
    expect(res).toEqual({ revision: 2, merged: `{"mio":1}|${remote.length}` });
    expect((await owner.load('p'))?.data).toBe(`{"mio":1}|${remote.length}`);
  });

  it('el visor no guarda; un extraño no lee (null); cargar uno inexistente da null', async () => {
    await repoFor(OWNER).save('p', JSON.stringify({ t: x(1_000_000) }), 0);
    await expect(repoFor(VIEWER).save('p', '{}', 1)).rejects.toThrow();
    expect(await repoFor(STRANGER).load('p')).toBeNull();
    expect(await repoFor(OWNER).load('no-existe')).toBeNull();
  });

  it('subscribe entrega el contenido recompuesto y los cambios posteriores', async () => {
    const owner = repoFor(OWNER);
    const first = JSON.stringify({ t: x(1_200_000) });
    await owner.save('p', first, 0);
    const seen: string[] = [];
    const off = repoFor(VIEWER).subscribe('p', (r) => seen.push(`${r.revision}:${r.data.length}`));
    await waitFor(() => seen.length >= 1);
    const second = JSON.stringify({ t: x(2_300_000) });
    await owner.save('p', second, 1);
    await waitFor(() => seen.at(-1) === `2:${second.length}`);
    off();
    expect(seen[0]).toBe(`1:${first.length}`);
  });
});

describe('reglas · los trozos no cambian sin avanzar la revisión (D34)', () => {
  let o: Db;
  let e: Db; // una sola instancia por cliente: un batch no mezcla referencias de otra
  beforeEach(() => {
    o = as(OWNER);
    e = as(EDITOR);
  });
  const seedChunked = () => assertSucceeds(writeChunked(as(OWNER), 1, ['a', 'b', 'c']));

  it('escribir, sobrescribir o borrar un trozo suelto, sin tocar content/main, se deniega', async () => {
    await seedChunked();
    for (const uid of [OWNER, EDITOR]) {
      await assertFails(setDoc(chunk(as(uid), 0), { data: 'otro' }));
      await assertFails(setDoc(chunk(as(uid), 1), { data: 'otro' }));
      await assertFails(deleteDoc(chunk(as(uid), 2)));
    }
    expect((await getDoc(chunk(as(OWNER), 0))).data()).toEqual({ data: 'a' });
  });

  it('un trozo con la revisión del padre sin avanzar (la misma o un salto de dos) se deniega', async () => {
    await seedChunked();
    const same = writeBatch(o);
    same.set(main(o), meta(1, 3));
    same.set(chunk(o, 0), { data: 'x' });
    await assertFails(same.commit());
    await assertFails(writeChunked(o, 3, ['a', 'b', 'c']));
  });

  it('el guardado real (nuevo, más largo, más corto y de vuelta a data) sigue permitido, también con 12 trozos', async () => {
    await assertSucceeds(writeChunked(as(EDITOR), 1, ['a', 'b']));
    await assertSucceeds(writeChunked(o, 2, Array.from({ length: 12 }, (_, i) => `t${i}`)));
    await assertSucceeds(shrink(as(EDITOR), 3, 2, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    await assertSucceeds(shrink(o, 4, 1, [0, 1]));
    expect(await listChunks()).toEqual([]);
  });

  it('el índice debe caber en el `chunks` final: ni de más al escribir ni de menos al borrar', async () => {
    await seedChunked();
    const extra = writeBatch(o); // `chunks` final 2 y se escribe el índice 2
    extra.set(main(o), meta(2, 2));
    extra.set(chunk(o, 2), { data: 'x' });
    await assertFails(extra.commit());
    await assertFails(shrink(o, 2, 3, [0])); // borra un trozo que sigue en uso
    const stale = writeBatch(o); // vuelve a `data` y deja un trozo escrito
    stale.set(main(o), { data: '{}', schemaVersion: 1, revision: 2, updatedAt: 2 });
    stale.set(chunk(o, 0), { data: 'x' });
    await assertFails(stale.commit());
  });

  it('el visor y un extraño no mutan trozos ni con la revisión avanzada', async () => {
    await seedChunked();
    await assertFails(writeChunked(as(VIEWER), 2, ['a', 'b', 'c']));
    await assertFails(shrink(as(STRANGER), 2, 2, [2]));
  });

  it('borrar el proyecto (trozos, content/main y proyecto en un batch, como projectRepo.remove) lo permite al dueño', async () => {
    await seedChunked();
    const fs = as(OWNER);
    const b = writeBatch(fs);
    (await getDocs(collection(main(fs), 'chunks'))).docs.forEach((d) => b.delete(d.ref));
    b.delete(main(fs));
    b.delete(doc(fs, 'projects', 'p'));
    await assertSucceeds(b.commit());
    expect(await listChunks()).toEqual([]);
  });

  it('borrar solo los trozos (el proyecto sigue) o por un editor, aunque sea en un batch de borrado, se deniega', async () => {
    await seedChunked();
    const a = writeBatch(o);
    [0, 1, 2].forEach((i) => a.delete(chunk(o, i)));
    await assertFails(a.commit());
    const b = writeBatch(e);
    [0, 1, 2].forEach((i) => b.delete(chunk(e, i)));
    b.delete(main(e));
    b.delete(doc(e, 'projects', 'p'));
    await assertFails(b.commit());
  });
});
