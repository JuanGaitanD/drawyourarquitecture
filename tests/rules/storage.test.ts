import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, listAll, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { OWNER, STRANGER, createEnv, seedProject } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seedProject(env, 'privado');
  await seedProject(env, 'publico', { isPublic: true });
});

const owner = () => env.authenticatedContext(OWNER).storage();
const stranger = () => env.authenticatedContext(STRANGER).storage();
const anon = () => env.unauthenticatedContext().storage();
const path = (id: string, file = 'f1') => `projects/${id}/files/${file}`;
const bytes = (n: number) => new Uint8Array(n).fill(1);
const MiB = 1024 * 1024;

/** Deja un archivo ya subido saltándose las reglas. */
async function seedFile(id: string, file = 'f1') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), path(id, file)), bytes(10), { contentType: 'image/png' });
  });
}

describe('storage · subida', () => {
  it('el dueño sube PNG, JPEG, GIF y WebP', async () => {
    for (const [i, type] of ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].entries()) {
      await assertSucceeds(uploadBytes(ref(owner(), path('privado', `f${i}`)), bytes(100), { contentType: type }));
    }
  });

  it('rechaza SVG y otros tipos', async () => {
    await assertFails(uploadBytes(ref(owner(), path('privado')), bytes(100), { contentType: 'image/svg+xml' }));
    await assertFails(uploadBytes(ref(owner(), path('privado')), bytes(100), { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(owner(), path('privado')), bytes(100), { contentType: 'application/octet-stream' }));
  });

  it('admite 4 MiB justos y rechaza 5 MiB', async () => {
    await assertSucceeds(uploadBytes(ref(owner(), path('privado', 'justo')), bytes(4 * MiB), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(owner(), path('privado', 'grande')), bytes(5 * MiB), { contentType: 'image/png' }));
  });

  it('otra cuenta y el anónimo no suben', async () => {
    await assertFails(uploadBytes(ref(stranger(), path('privado')), bytes(10), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(anon(), path('publico')), bytes(10), { contentType: 'image/png' }));
  });
});

describe('storage · lectura', () => {
  it('el dueño lee y lista', async () => {
    await seedFile('privado');
    await assertSucceeds(getBytes(ref(owner(), path('privado'))));
    await assertSucceeds(listAll(ref(owner(), 'projects/privado/files')));
  });

  it('un anónimo lee archivos de un proyecto público, no los de uno privado ni lista', async () => {
    await seedFile('publico');
    await seedFile('privado');
    await assertSucceeds(getBytes(ref(anon(), path('publico'))));
    await assertFails(getBytes(ref(anon(), path('privado'))));
    await assertFails(listAll(ref(anon(), 'projects/publico/files')));
  });

  it('otra cuenta no lee lo privado', async () => {
    await seedFile('privado');
    await assertFails(getBytes(ref(stranger(), path('privado'))));
  });

  it('un proyecto que no existe se deniega', async () => {
    await assertFails(getBytes(ref(anon(), path('no-existe'))));
  });
});

describe('storage · borrado', () => {
  it('el dueño borra (sin condición de request.resource)', async () => {
    await seedFile('privado');
    await assertSucceeds(deleteObject(ref(owner(), path('privado'))));
  });

  it('otra cuenta y el anónimo no borran', async () => {
    await seedFile('publico');
    await assertFails(deleteObject(ref(stranger(), path('publico'))));
    await assertFails(deleteObject(ref(anon(), path('publico'))));
  });
});
