import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { OWNER, STRANGER, contentData, createEnv, projectData, seedProject } from './env';

let env: RulesTestEnvironment;
beforeAll(async () => (env = await createEnv()));
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

const asOwner = () => env.authenticatedContext(OWNER).firestore();
const asStranger = () => env.authenticatedContext(STRANGER).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

describe('firestore · el dueño', () => {
  it('crea proyecto y contenido en un batch, lo lee y lo escribe', async () => {
    const fs = asOwner();
    const batch = writeBatch(fs);
    batch.set(doc(fs, 'projects', 'p1'), projectData());
    batch.set(doc(fs, 'projects', 'p1', 'content', 'main'), contentData());
    await assertSucceeds(batch.commit());

    await assertSucceeds(getDoc(doc(fs, 'projects', 'p1')));
    await assertSucceeds(getDoc(doc(fs, 'projects', 'p1', 'content', 'main')));
    await assertSucceeds(
      updateDoc(doc(fs, 'projects', 'p1', 'content', 'main'), { data: '{"v":2}', revision: 1, updatedAt: 2 }),
    );
    await assertSucceeds(updateDoc(doc(fs, 'projects', 'p1'), { title: 'Otro', isPublic: true, updatedAt: 3 }));
  });

  it('lista solo lo suyo (con el filtro ownerId)', async () => {
    await seedProject(env, 'p1');
    const fs = asOwner();
    await assertSucceeds(getDocs(query(collection(fs, 'projects'), where('ownerId', '==', OWNER))));
    await assertFails(getDocs(collection(fs, 'projects')));
  });

  it('no puede crear contenido sin el proyecto en el mismo batch', async () => {
    const fs = asOwner();
    const batch = writeBatch(fs);
    batch.set(doc(fs, 'projects', 'huerfano', 'content', 'main'), contentData());
    await assertFails(batch.commit());
  });

  it('rechaza claves de más, tipos inválidos y revisión inicial distinta de 0', async () => {
    const fs = asOwner();
    await assertFails(
      (() => {
        const b = writeBatch(fs);
        b.set(doc(fs, 'projects', 'a'), projectData({ extra: 1 }));
        b.set(doc(fs, 'projects', 'a', 'content', 'main'), contentData());
        return b.commit();
      })(),
    );
    await assertFails(
      (() => {
        const b = writeBatch(fs);
        b.set(doc(fs, 'projects', 'b'), projectData({ type: 'doc' }));
        b.set(doc(fs, 'projects', 'b', 'content', 'main'), contentData());
        return b.commit();
      })(),
    );
    await assertFails(
      (() => {
        const b = writeBatch(fs);
        b.set(doc(fs, 'projects', 'c'), projectData());
        b.set(doc(fs, 'projects', 'c', 'content', 'main'), contentData({ revision: 5 }));
        return b.commit();
      })(),
    );
  });

  it('borra contenido y proyecto en un batch', async () => {
    await seedProject(env, 'p1');
    const fs = asOwner();
    const b = writeBatch(fs);
    b.delete(doc(fs, 'projects', 'p1', 'content', 'main'));
    b.delete(doc(fs, 'projects', 'p1'));
    await assertSucceeds(b.commit());
  });
});

describe('firestore · inmutables y revisión', () => {
  beforeEach(async () => seedProject(env, 'p1'));

  it('ownerId y type no se pueden cambiar', async () => {
    const fs = asOwner();
    await assertFails(updateDoc(doc(fs, 'projects', 'p1'), { ownerId: STRANGER, updatedAt: 2 }));
    await assertFails(updateDoc(doc(fs, 'projects', 'p1'), { type: 'note', updatedAt: 2 }));
    await assertFails(updateDoc(doc(fs, 'projects', 'p1'), { createdAt: 9, updatedAt: 2 }));
  });

  it('una revisión que no es la siguiente se rechaza', async () => {
    const ref = doc(asOwner(), 'projects', 'p1', 'content', 'main');
    await assertFails(updateDoc(ref, { data: 'x', revision: 0, updatedAt: 2 })); // igual
    await assertFails(updateDoc(ref, { data: 'x', revision: 2, updatedAt: 2 })); // salta una
    await assertFails(updateDoc(ref, { data: 'x', revision: -1, updatedAt: 2 })); // retrocede
    await assertSucceeds(updateDoc(ref, { data: 'x', revision: 1, updatedAt: 2 }));
  });

  it('el contenido no admite claves nuevas ni otro schemaVersion', async () => {
    const ref = doc(asOwner(), 'projects', 'p1', 'content', 'main');
    await assertFails(updateDoc(ref, { revision: 1, updatedAt: 2, extra: true }));
    await assertFails(updateDoc(ref, { revision: 1, updatedAt: 2, schemaVersion: 2 }));
  });
});

describe('firestore · otra cuenta', () => {
  beforeEach(async () => {
    await seedProject(env, 'privado');
    await seedProject(env, 'publico', { isPublic: true });
  });

  it('no lee lo privado ni su contenido', async () => {
    const fs = asStranger();
    await assertFails(getDoc(doc(fs, 'projects', 'privado')));
    await assertFails(getDoc(doc(fs, 'projects', 'privado', 'content', 'main')));
  });

  it('no crea ni aunque ponga su propio uid como dueño', async () => {
    const fs = asStranger();
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', 'mio'), projectData({ ownerId: STRANGER }));
    b.set(doc(fs, 'projects', 'mio', 'content', 'main'), contentData());
    await assertFails(b.commit());
  });

  it('lee lo público pero no escribe ni borra', async () => {
    const fs = asStranger();
    await assertSucceeds(getDoc(doc(fs, 'projects', 'publico')));
    await assertFails(updateDoc(doc(fs, 'projects', 'publico'), { title: 'x', updatedAt: 2 }));
    await assertFails(updateDoc(doc(fs, 'projects', 'publico', 'content', 'main'), { revision: 1, updatedAt: 2 }));
    const b = writeBatch(fs);
    b.delete(doc(fs, 'projects', 'publico', 'content', 'main'));
    b.delete(doc(fs, 'projects', 'publico'));
    await assertFails(b.commit());
  });
});

describe('firestore · anónimo', () => {
  beforeEach(async () => {
    await seedProject(env, 'privado');
    await seedProject(env, 'publico', { isPublic: true });
  });

  it('lee lo público con get, también su contenido', async () => {
    const fs = asAnon();
    await assertSucceeds(getDoc(doc(fs, 'projects', 'publico')));
    await assertSucceeds(getDoc(doc(fs, 'projects', 'publico', 'content', 'main')));
  });

  it('no lee lo privado y un id inexistente se deniega igual', async () => {
    const fs = asAnon();
    await assertFails(getDoc(doc(fs, 'projects', 'privado')));
    await assertFails(getDoc(doc(fs, 'projects', 'privado', 'content', 'main')));
    await assertFails(getDoc(doc(fs, 'projects', 'no-existe')));
  });

  it('no puede listar, ni siquiera filtrando por lo público', async () => {
    const fs = asAnon();
    await assertFails(getDocs(collection(fs, 'projects')));
    await assertFails(getDocs(query(collection(fs, 'projects'), where('isPublic', '==', true))));
  });

  it('no escribe', async () => {
    const fs = asAnon();
    const b = writeBatch(fs);
    b.set(doc(fs, 'projects', 'x'), projectData());
    b.set(doc(fs, 'projects', 'x', 'content', 'main'), contentData());
    await assertFails(b.commit());
  });
});
