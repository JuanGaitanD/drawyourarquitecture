import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase-admin/firestore';
import { generateToken, sha256Hex } from '../application/tokens';
import { emptyBoard } from '../editors/board/model/board';
import { getAdminAuth } from './admin';
import { buildNote, encodeNote } from './note';
import type { ToolContext } from './tools';
import { getUserDb } from './userDb';

// Utilidades de los tests de integración: datos únicos por ejecución (el emulador es compartido con otros
// carriles, así que no se limpia: cada prueba crea lo suyo con ids propios).

/** Los tests de integración solo corren con el emulador de Firestore (FIRESTORE_EMULATOR_HOST). */
export const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

/** uid del dueño de las reglas renderizadas con `--emulator` (`owner-test`): crea proyectos sin estar en la lista. */
export const OWNER = 'owner-test';

/**
 * El emulador es compartido con otros carriles y cada uno carga SUS reglas: antes de probar se vuelven a cargar las
 * de este repo (misma llamada que usa `@firebase/rules-unit-testing`). La plantilla se renderiza en memoria, sin
 * escribir `firestore.rules`: varios ficheros de test la cargan a la vez.
 */
export async function loadRules(): Promise<void> {
  const rules = readFileSync('firestore.rules.tpl', 'utf8').replaceAll('__OWNER_UID__', OWNER);
  const env = await initializeTestEnvironment({ projectId: 'demo-dya', firestore: { rules } });
  await env.cleanup();
}

/** Contexto de herramientas autenticado como `uid` (SDK web + custom token del emulador de Auth). */
export async function userCtx(uid: string): Promise<ToolContext> {
  return { db: await getUserDb(uid), uid };
}

/**
 * Persona nueva, con correo verificado y en `allowedEmails`: puede crear proyectos y no arrastra los del dueño de
 * prueba, que se acumulan en el emulador compartido (`list_projects` solo trae 200 y la prueba no encontraba el suyo).
 */
export async function seedAllowedUser(db: Firestore): Promise<string> {
  const uid = uniq('invitada');
  const email = `${uid}@example.com`;
  await db.collection('allowedEmails').doc(email).set({ email, addedAt: 1 });
  await getAdminAuth().createUser({ uid, email, emailVerified: true });
  return uid;
}

export const uniq = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

export async function seedToken(
  db: Firestore,
  uid: string,
  revoked = false,
): Promise<{ token: string; hash: string }> {
  const token = generateToken();
  const hash = await sha256Hex(token);
  await db.collection('mcpTokens').doc(hash).set({ uid, label: 'test', createdAt: Date.now(), revoked });
  return { token, hash };
}

export async function seedProject(
  db: Firestore,
  o: {
    ownerId: string;
    type?: 'note' | 'board';
    title?: string;
    isPublic?: boolean;
    members?: Record<string, 'editor' | 'viewer'>;
    data?: string;
  },
): Promise<string> {
  const type = o.type ?? 'board';
  const ref = db.collection('projects').doc();
  const t = Date.now();
  await ref.set({
    ownerId: o.ownerId,
    type,
    title: o.title ?? 'Proyecto de prueba',
    isPublic: o.isPublic ?? false,
    createdAt: t,
    updatedAt: t,
    ...(o.members ? { members: o.members } : {}),
  });
  const data =
    o.data ?? (type === 'board' ? JSON.stringify(emptyBoard()) : encodeNote(buildNote('Hola\n\nmundo')));
  await ref.collection('content').doc('main').set({ data, schemaVersion: 1, revision: 0, updatedAt: t });
  return ref.id;
}
