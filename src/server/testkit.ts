import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { generateToken, sha256Hex } from '../application/tokens';
import { emptyBoard } from '../editors/board/model/board';
import { buildNote, encodeNote } from './note';

// Utilidades de los tests de integración: datos únicos por ejecución (el emulador es compartido con otros
// carriles, así que no se limpia: cada prueba crea lo suyo con ids propios).

/** Los tests de integración solo corren con el emulador de Firestore (FIRESTORE_EMULATOR_HOST). */
export const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

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
