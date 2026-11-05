import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// Firebase Admin se salta las reglas de Firestore, así que aquí solo vive el plano de IDENTIDAD:
// resolver el token personal (`mcpTokens/{hash}` → uid), anotar `lastUsedAt` y emitir `createCustomToken(uid)`.
// Los datos de los proyectos los toca `userDb.ts` con el SDK web autenticado como la persona (las reglas aplican).

export const EMULATOR_PROJECT = 'demo-dya';
export const EMULATOR_AUTH = '127.0.0.1:9099';

/** Contra el emulador si existe `FIRESTORE_EMULATOR_HOST` (el de Auth se da por defecto en 9099). */
export const usingEmulator = (): boolean => Boolean(process.env.FIRESTORE_EMULATOR_HOST);

let app: App | null = null;

function getApp(): App {
  if (app) return app;
  if (usingEmulator()) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= EMULATOR_AUTH;
    app = getApps()[0] ?? initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? EMULATOR_PROJECT });
  } else {
    app =
      getApps()[0] ??
      initializeApp({ credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  return app;
}

/** Firestore de Admin: solo para buscar el token (`mcpTokens`) y sembrar datos en los tests. No para proyectos. */
export const getAdminDb = (): Firestore => getFirestore(getApp());
export const getAdminAuth = (): Auth => getAuth(getApp());

function parseServiceAccount(raw: string | undefined) {
  if (!raw) throw new Error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT.');
  try {
    return JSON.parse(raw) as Parameters<typeof cert>[0];
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido.');
  }
}
