import { createSign } from 'node:crypto';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

// Firebase Admin se salta las reglas de Firestore, así que aquí solo vive el plano de IDENTIDAD:
// resolver el token personal (`mcpTokens/{hash}` → uid), anotar `lastUsedAt` y emitir el custom token de `uid`.
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
/**
 * Admin Auth, solo contra el emulador (pruebas: crear cuentas y tokens). Se carga con `import()`: `firebase-admin/auth`
 * arrastra `jwks-rsa`, que hace `require()` de `jose` (solo ESM), y el cargador de funciones de Vercel no lo admite.
 * El emulador de Auth no separa por proyecto: usa su propia app en `demo-dya` aunque Firestore tenga otro (D41).
 */
export async function getAdminAuth(): Promise<Auth> {
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth(
    getApps().find((a) => a.name === 'dya-auth') ?? initializeApp({ projectId: EMULATOR_PROJECT }, 'dya-auth'),
  );
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');
const CUSTOM_TOKEN_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

/**
 * Custom token de Firebase para `signInWithCustomToken`. En producción se firma aquí (RS256 con la cuenta de servicio,
 * mismo formato que `createCustomToken` de Admin) para no cargar `firebase-admin/auth`; con emulador, el de Admin.
 */
export async function createCustomToken(uid: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  if (usingEmulator()) return (await getAdminAuth()).createCustomToken(uid);
  const sa = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT) as { client_email: string; private_key: string };
  return signCustomToken(uid, sa, now);
}

export function signCustomToken(uid: string, sa: { client_email: string; private_key: string }, now: number): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ iss: sa.client_email, sub: sa.client_email, aud: CUSTOM_TOKEN_AUD, iat: now, exp: now + 3600, uid }),
  );
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key);
  return `${head}.${body}.${b64url(sig)}`;
}

function parseServiceAccount(raw: string | undefined) {
  if (!raw) throw new Error('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT.');
  try {
    return JSON.parse(raw) as Parameters<typeof cert>[0];
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido.');
  }
}
