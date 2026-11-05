import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, collection, deleteDoc, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { OWNER, STRANGER, createEnv, seedProject } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seedProject(env, 'privado');
  await seedProject(env, 'publico', { isPublic: true });
});

const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asStranger = () => env.authenticatedContext(STRANGER).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

const bytes = (n: number) => Bytes.fromUint8Array(new Uint8Array(n).fill(1));
const meta = (over: Record<string, unknown> = {}) => ({
  mimeType: 'image/webp',
  size: 100,
  chunks: 1,
  createdAt: 1,
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
