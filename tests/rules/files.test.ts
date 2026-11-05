import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { Bytes, collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFileStore } from '../../src/infrastructure/firebase/files';
import { OWNER, STRANGER, createEnv, seedProject } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seedProject(env, 'privado');
  await seedProject(env, 'publico', { isPublic: true });
  await seedProject(env, 'compartido', {
    members: { [ED_A]: 'editor', [ED_B]: 'editor', [VIEWER]: 'viewer' },
  });
});

const ED_A = 'editor-a';
const ED_B = 'editor-b';
const VIEWER = 'viewer-uid';
const as = (uid: string) => env.authenticatedContext(uid).firestore();

const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asStranger = () => env.authenticatedContext(STRANGER).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

const bytes = (n: number) => Bytes.fromUint8Array(new Uint8Array(n).fill(1));
const meta = (over: Record<string, unknown> = {}) => ({
  mimeType: 'image/webp',
  size: 100,
  chunks: 1,
  createdAt: 1,
  createdBy: OWNER,
  ...over,
});
const fileRef = (fs: ReturnType<typeof asOwner>, id: string, file = 'f1') =>
  doc(fs, 'projects', id, 'files', file);
const chunkRef = (fs: ReturnType<typeof asOwner>, id: string, i = '0', file = 'f1') =>
  doc(fs, 'projects', id, 'files', file, 'chunks', i);

/** Deja un archivo de un trozo saltándose las reglas. */
async function seedFile(id: string) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(fileRef(fs, id), meta());
    await setDoc(chunkRef(fs, id), { data: bytes(100) });
  });
}

describe('archivos · escritura', () => {
  it('el dueño escribe trozos y meta en un batch', async () => {
    const fs = asOwner();
    const b = writeBatch(fs);
    b.set(chunkRef(fs, 'privado', '0'), { data: bytes(900_000) });
    b.set(chunkRef(fs, 'privado', '1'), { data: bytes(10) });
    b.set(fileRef(fs, 'privado'), meta({ size: 900_010, chunks: 2 }));
    await assertSucceeds(b.commit());
  });

  it('admite PNG, JPEG, GIF y WebP y rechaza SVG y otros tipos', async () => {
    const fs = asOwner();
    for (const [i, type] of ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].entries()) {
      await assertSucceeds(setDoc(fileRef(fs, 'privado', `t${i}`), meta({ mimeType: type })));
    }
    await assertFails(setDoc(fileRef(fs, 'privado', 'svg'), meta({ mimeType: 'image/svg+xml' })));
    await assertFails(setDoc(fileRef(fs, 'privado', 'html'), meta({ mimeType: 'text/html' })));
  });

  it('un trozo admite 900 000 bytes y rechaza 900 001', async () => {
    const fs = asOwner();
    await assertSucceeds(setDoc(chunkRef(fs, 'privado', '0'), { data: bytes(900_000) }));
    await assertFails(setDoc(chunkRef(fs, 'privado', '1'), { data: bytes(900_001) }));
  });

  it('rechaza trozos con tipo o claves inválidos', async () => {
    const fs = asOwner();
    await assertFails(setDoc(chunkRef(fs, 'privado', '0'), { data: 'texto' }));
    await assertFails(setDoc(chunkRef(fs, 'privado', '0'), { data: bytes(10), extra: 1 }));
    await assertFails(setDoc(chunkRef(fs, 'privado', 'x'), { data: bytes(10) }));
  });

  it('la meta admite 4 MiB justos y rechaza más, claves de más y trozos de más', async () => {
    const fs = asOwner();
    await assertSucceeds(setDoc(fileRef(fs, 'privado', 'justo'), meta({ size: 4 * 1024 * 1024, chunks: 5 })));
    await assertFails(setDoc(fileRef(fs, 'privado', 'grande'), meta({ size: 4 * 1024 * 1024 + 1 })));
    await assertFails(setDoc(fileRef(fs, 'privado', 'extra'), meta({ extra: 1 })));
    await assertFails(setDoc(fileRef(fs, 'privado', 'trozos'), meta({ chunks: 6 })));
    await assertFails(setDoc(fileRef(fs, 'privado', 'tipo'), meta({ size: '100' })));
    await assertFails(setDoc(fileRef(fs, 'privado', 'sin-autor'), (({ createdBy: _, ...m }) => m)(meta())));
  });

  it('otra cuenta y el anónimo no escriben', async () => {
    await assertFails(setDoc(fileRef(asStranger(), 'privado'), meta()));
    await assertFails(setDoc(chunkRef(asStranger(), 'privado'), { data: bytes(10) }));
    await assertFails(setDoc(fileRef(asAnon(), 'publico'), meta()));
    await assertFails(setDoc(chunkRef(asAnon(), 'publico'), { data: bytes(10) }));
  });
});

describe('archivos · lectura', () => {
  it('el dueño lee meta y trozos y lista', async () => {
    await seedFile('privado');
    const fs = asOwner();
    await assertSucceeds(getDoc(fileRef(fs, 'privado')));
    await assertSucceeds(getDoc(chunkRef(fs, 'privado')));
    await assertSucceeds(getDocs(collection(fs, 'projects', 'privado', 'files')));
    await assertSucceeds(getDocs(collection(fs, 'projects', 'privado', 'files', 'f1', 'chunks')));
  });

  it('un anónimo lee archivos de un proyecto público, no los de uno privado ni lista', async () => {
    await seedFile('publico');
    await seedFile('privado');
    const fs = asAnon();
    await assertSucceeds(getDoc(fileRef(fs, 'publico')));
    await assertSucceeds(getDoc(chunkRef(fs, 'publico')));
    await assertFails(getDoc(fileRef(fs, 'privado')));
    await assertFails(getDoc(chunkRef(fs, 'privado')));
    await assertFails(getDocs(collection(fs, 'projects', 'publico', 'files')));
    await assertFails(getDocs(collection(fs, 'projects', 'publico', 'files', 'f1', 'chunks')));
  });

  it('otra cuenta no lee lo privado', async () => {
    await seedFile('privado');
    await assertFails(getDoc(fileRef(asStranger(), 'privado')));
    await assertFails(getDoc(chunkRef(asStranger(), 'privado')));
  });

  it('un proyecto que no existe se deniega', async () => {
    await assertFails(getDoc(fileRef(asAnon(), 'no-existe')));
    await assertFails(getDoc(fileRef(asOwner(), 'no-existe')));
  });
});

describe('archivos · borrado', () => {
  it('el dueño borra meta y trozos', async () => {
    await seedFile('privado');
    const fs = asOwner();
    await assertSucceeds(deleteDoc(chunkRef(fs, 'privado')));
    await assertSucceeds(deleteDoc(fileRef(fs, 'privado')));
  });

  it('otra cuenta y el anónimo no borran', async () => {
    await seedFile('publico');
    await assertFails(deleteDoc(fileRef(asStranger(), 'publico')));
    await assertFails(deleteDoc(chunkRef(asAnon(), 'publico')));
  });
});

/** D46: un editor invitado deshace sus propias subidas; el resto, no. */
describe('archivos · autoría (D46)', () => {
  const P = 'compartido';
  const legacy = async (file = 'viejo') =>
    env.withSecurityRulesDisabled(async (ctx) => {
      const { createdBy: _, ...old } = meta();
      await setDoc(fileRef(ctx.firestore(), P, file), old);
      await setDoc(chunkRef(ctx.firestore(), P, '0', file), { data: bytes(10) });
    });
  const store = (uid: string) =>
    createFileStore(
      async () => ({ fs: sdk, db: as(uid) as never }),
      () => uid,
    );

  /** El editor `uid` sube un archivo de un trozo como lo hace el adaptador (trozo + meta en un batch). */
  async function upload(uid: string, file = 'f1') {
    const fs = as(uid);
    const b = writeBatch(fs);
    b.set(chunkRef(fs, P, '0', file), { data: bytes(10) });
    b.set(fileRef(fs, P, file), meta({ createdBy: uid }));
    await assertSucceeds(b.commit());
  }

  it('la meta guarda al que sube: createdBy = uid al crear y no cambia al reescribir', async () => {
    await assertFails(setDoc(fileRef(as(ED_A), P), meta({ createdBy: ED_B }))); // a nombre de otro
    await assertFails(setDoc(fileRef(as(ED_A), P), meta({ createdBy: OWNER })));
    await upload(ED_A);
    await assertSucceeds(setDoc(fileRef(as(ED_A), P), meta({ createdBy: ED_A, size: 50 }))); // reintento propio
    await assertFails(setDoc(fileRef(as(ED_B), P), meta({ createdBy: ED_B }))); // quedarse con el archivo ajeno
  });

  it('el editor borra su archivo (trozos y meta); otro editor, un visor y un extraño no', async () => {
    await upload(ED_A);
    for (const uid of [ED_B, VIEWER, STRANGER]) {
      await assertFails(deleteDoc(fileRef(as(uid), P)));
      await assertFails(deleteDoc(chunkRef(as(uid), P)));
    }
    const fs = as(ED_A);
    const b = writeBatch(fs);
    b.delete(chunkRef(fs, P));
    b.delete(fileRef(fs, P));
    await assertSucceeds(b.commit());
    expect((await getDoc(fileRef(asOwner(), P))).exists()).toBe(false);
    expect((await getDoc(chunkRef(asOwner(), P))).exists()).toBe(false);
  });

  it('el dueño sigue borrando lo de cualquiera y lo anterior a D46 (sin createdBy)', async () => {
    await upload(ED_A);
    await legacy();
    const owner = asOwner();
    await assertSucceeds(deleteDoc(chunkRef(owner, P)));
    await assertSucceeds(deleteDoc(fileRef(owner, P)));
    await assertSucceeds(deleteDoc(chunkRef(owner, P, '0', 'viejo')));
    await assertSucceeds(deleteDoc(fileRef(owner, P, 'viejo')));
  });

  it('una meta sin createdBy la borra solo el dueño y ningún editor se la queda', async () => {
    await legacy();
    await assertFails(deleteDoc(fileRef(as(ED_A), P, 'viejo')));
    await assertFails(deleteDoc(chunkRef(as(ED_A), P, '0', 'viejo')));
    await assertFails(setDoc(fileRef(as(ED_A), P, 'viejo'), meta({ createdBy: ED_A })));
  });

  it('sin meta (subida que murió a medias) cualquier editor borra los trozos huérfanos; un visor no', async () => {
    await assertSucceeds(setDoc(chunkRef(as(ED_A), P, '0', 'huerfano'), { data: bytes(10) }));
    await assertFails(deleteDoc(chunkRef(as(VIEWER), P, '0', 'huerfano')));
    await assertFails(deleteDoc(chunkRef(as(STRANGER), P, '0', 'huerfano')));
    await assertSucceeds(deleteDoc(chunkRef(as(ED_B), P, '0', 'huerfano')));
  });

  it('el adaptador real: sube, lo borra el mismo editor sin listar y otro editor no puede', async () => {
    const blob = new Blob([new Uint8Array(1_000_000).fill(7)], { type: 'image/png' }); // 2 trozos
    await store(ED_A).upload(P, 'img', blob);
    expect((await getDoc(fileRef(asOwner(), P, 'img'))).data()).toMatchObject({ createdBy: ED_A, chunks: 2 });

    await expect(store(ED_B).remove(P, 'img')).rejects.toThrow();
    expect((await store(ED_A).load(P, 'img')).size).toBe(1_000_000); // sigue entera

    await store(ED_A).remove(P, 'img');
    expect((await getDoc(fileRef(asOwner(), P, 'img'))).exists()).toBe(false);
    expect((await getDocs(collection(asOwner(), 'projects', P, 'files', 'img', 'chunks'))).size).toBe(0);
  });

  it('el adaptador real limpia una importación fallida: la subida completa y la que quedó sin meta', async () => {
    await store(ED_A).upload(P, 'ok', new Blob([new Uint8Array(10)], { type: 'image/webp' }));
    await setDoc(chunkRef(as(ED_A), P, '0', 'roto'), { data: bytes(10) }); // murió antes de la meta
    await store(ED_A).remove(P, 'ok');
    await store(ED_A).remove(P, 'roto');
    expect((await getDocs(collection(asOwner(), 'projects', P, 'files'))).size).toBe(0);
    expect((await getDocs(collection(asOwner(), 'projects', P, 'files', 'roto', 'chunks'))).size).toBe(0);
  });

  it('el dueño con el adaptador borra también una meta anterior a D46', async () => {
    await legacy();
    await store(OWNER).remove(P, 'viejo');
    expect((await getDoc(fileRef(asOwner(), P, 'viejo'))).exists()).toBe(false);
  });
});
