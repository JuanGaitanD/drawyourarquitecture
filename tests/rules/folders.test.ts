import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { OWNER, STRANGER, contentData, createEnv, projectData, seedProject } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());

const EDITOR = 'editor-uid';
const MAIL = 'invitada@example.com';

const folderData = (over: Record<string, unknown> = {}) => ({
  ownerId: OWNER,
  name: 'Universidad',
  parentId: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'folders', 'f1'), folderData());
    await setDoc(doc(ctx.firestore(), 'allowedEmails', MAIL), { email: MAIL, addedAt: 1 });
  });
  await seedProject(env, 'p', { members: { [EDITOR]: 'editor' } });
});

const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asStranger = () => env.authenticatedContext(STRANGER).firestore();
const asAllowed = () => env.authenticatedContext('invitada', { email: MAIL, email_verified: true }).firestore();
const folder = (fs: ReturnType<typeof asOwner>, id = 'f1') => doc(fs, 'folders', id);

describe('folders · el dueño', () => {
  it('crea, lee, lista (con ownerId), renombra, mueve y borra la suya', async () => {
    const fs = asOwner();
    await assertSucceeds(setDoc(folder(fs, 'f2'), folderData({ name: 'Semestre 5', parentId: 'f1' })));
    await assertSucceeds(getDoc(folder(fs)));
    await assertSucceeds(getDocs(query(collection(fs, 'folders'), where('ownerId', '==', OWNER))));
    await assertFails(getDocs(collection(fs, 'folders')));
    await assertSucceeds(updateDoc(folder(fs, 'f2'), { name: 'Otro', updatedAt: 2 }));
    await assertSucceeds(updateDoc(folder(fs, 'f2'), { parentId: null, updatedAt: 3 }));
    await assertSucceeds(deleteDoc(folder(fs, 'f2')));
  });

  it('valida nombre, padre y claves al crear', async () => {
    const fs = asOwner();
    await assertFails(setDoc(folder(fs, 'a'), folderData({ name: '' })));
    await assertFails(setDoc(folder(fs, 'b'), folderData({ name: 'x'.repeat(41) })));
    await assertFails(setDoc(folder(fs, 'c'), folderData({ name: 7 })));
    await assertFails(setDoc(folder(fs, 'd'), folderData({ parentId: 5 })));
    await assertFails(setDoc(folder(fs, 'e'), folderData({ parentId: 'x'.repeat(65) })));
    await assertFails(setDoc(folder(fs, 'g'), folderData({ extra: 1 })));
    await assertFails(setDoc(folder(fs, 'h'), folderData({ ownerId: STRANGER })));
    await assertSucceeds(setDoc(folder(fs, 'ok'), folderData({ name: 'x'.repeat(40) })));
  });

  it('al actualizar: ownerId inmutable, nombre válido y solo name, parentId y updatedAt', async () => {
    const fs = asOwner();
    await assertFails(updateDoc(folder(fs), { ownerId: STRANGER }));
    await assertFails(updateDoc(folder(fs), { name: '', updatedAt: 2 }));
    await assertFails(updateDoc(folder(fs), { parentId: 3, updatedAt: 2 }));
    await assertFails(updateDoc(folder(fs), { createdAt: 9 }));
    await assertFails(updateDoc(folder(fs), { extra: 1 }));
  });

  it('un nombre de antes del límite de 40 se conserva al mover, pero no se cambia por otro largo', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'folders', 'larga'), folderData({ name: 'y'.repeat(80) }));
    });
    const fs = asOwner();
    await assertFails(updateDoc(folder(fs, 'larga'), { name: 'z'.repeat(41), updatedAt: 2 }));
    await assertSucceeds(updateDoc(folder(fs, 'larga'), { parentId: 'f1', updatedAt: 2 }));
    await assertSucceeds(updateDoc(folder(fs, 'larga'), { name: 'z'.repeat(40), updatedAt: 3 }));
  });

  it('crear exige canCreate: sin entrada en allowedEmails no, con ella sí', async () => {
    await assertFails(setDoc(folder(asStranger(), 'x'), folderData({ ownerId: STRANGER })));
    await assertSucceeds(setDoc(folder(asAllowed(), 'x'), folderData({ ownerId: 'invitada' })));
  });
});

describe('folders · otras cuentas', () => {
  it('no leen, listan, crean a nombre de otro, actualizan ni borran carpetas ajenas', async () => {
    const fs = asStranger();
    await assertFails(getDoc(folder(fs)));
    await assertFails(getDocs(query(collection(fs, 'folders'), where('ownerId', '==', OWNER))));
    await assertFails(updateDoc(folder(fs), { name: 'Mía', updatedAt: 2 }));
    await assertFails(deleteDoc(folder(fs)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'folders', 'f1')));
  });
});

describe('projects · folderId', () => {
  const proj = (fs: ReturnType<typeof asOwner>, id = 'p') => doc(fs, 'projects', id);

  it('el dueño crea con carpeta o sin ella, la cambia y la quita', async () => {
    const fs = asOwner();
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', 'n'), projectData({ folderId: 'f1' }));
    b.set(doc(fs, 'projects', 'n', 'content', 'main'), contentData());
    await assertSucceeds(b.commit());
    await assertSucceeds(updateDoc(proj(fs), { folderId: 'f1', updatedAt: 2 }));
    await assertSucceeds(updateDoc(proj(fs), { folderId: null, updatedAt: 3 }));
  });

  it('rechaza un folderId que no es null ni un id razonable', async () => {
    const fs = asOwner();
    await assertFails(updateDoc(proj(fs), { folderId: 7, updatedAt: 2 }));
    await assertFails(updateDoc(proj(fs), { folderId: 'x'.repeat(65), updatedAt: 2 }));
    await assertFails(updateDoc(proj(fs), { folderId: '', updatedAt: 2 }));
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', 'm'), projectData({ folderId: 9 }));
    b.set(doc(fs, 'projects', 'm', 'content', 'main'), contentData());
    await assertFails(b.commit());
  });

  it('un editor invitado no cambia folderId, ni un extraño', async () => {
    const editor = env.authenticatedContext(EDITOR).firestore();
    await assertFails(updateDoc(proj(editor), { folderId: 'f1', updatedAt: 2 }));
    await assertFails(updateDoc(proj(asStranger()), { folderId: 'f1', updatedAt: 2 }));
  });
});
