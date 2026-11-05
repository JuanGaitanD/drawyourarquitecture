import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let db: Firestore | null = null;

/**
 * Firestore con Firebase Admin. Contra el emulador si existe `FIRESTORE_EMULATOR_HOST` (sin credenciales);
 * en producción, con la cuenta de servicio de `FIREBASE_SERVICE_ACCOUNT` (el JSON completo en la variable).
 */
export function getDb(): Firestore {
  if (db) return db;
  const app =
    getApps()[0] ??
    (process.env.FIRESTORE_EMULATOR_HOST
      ? initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-dya' })
      : initializeApp({ credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT)) }));
  db = getFirestore(app);
  return db;
}

function parseServiceAccount(raw: string | undefined) {
  if (!raw) throw new Error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT.');
  try {
    return JSON.parse(raw) as Parameters<typeof cert>[0];
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido.');
  }
}
