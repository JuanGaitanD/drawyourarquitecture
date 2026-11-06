import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { EMULATOR_AUTH, EMULATOR_PROJECT, createCustomToken, usingEmulator } from './admin';

// Firestore del SDK web autenticado como la persona del token: Admin emite `createCustomToken(uid)` y
// `signInWithCustomToken` da la sesión. Todo acceso a datos pasa por las reglas de `firestore.rules`, tal cual.
// Una app por uid, en memoria de la función caliente.

const MAX_APPS = 20;
/** El SDK renueva el ID token solo; aun así se recrea la sesión cada 50 min por si el refresh token falló. */
const TTL_MS = 50 * 60_000;

interface Entry {
  app: FirebaseApp;
  db: Promise<Firestore>;
  at: number;
}
const cache = new Map<string, Entry>();

/** Misma configuración web que la app (`VITE_FIREBASE_*`, ya definidas en Vercel). */
function webConfig() {
  if (usingEmulator()) {
    return {
      apiKey: 'demo',
      authDomain: `${EMULATOR_PROJECT}.firebaseapp.com`,
      projectId: process.env.GCLOUD_PROJECT ?? EMULATOR_PROJECT,
      appId: 'demo',
    };
  }
  const e = process.env;
  if (!e.VITE_FIREBASE_API_KEY || !e.VITE_FIREBASE_PROJECT_ID) {
    throw new Error('Faltan VITE_FIREBASE_API_KEY y VITE_FIREBASE_PROJECT_ID en el entorno del servidor.');
  }
  return {
    apiKey: e.VITE_FIREBASE_API_KEY,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: e.VITE_FIREBASE_PROJECT_ID,
    messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: e.VITE_FIREBASE_APP_ID,
  };
}

/** Saca la sesión de la caché de forma síncrona (sin carreras entre peticiones) y cierra su app. */
function drop(uid: string): Promise<void> {
  const entry = cache.get(uid);
  if (!entry) return Promise.resolve();
  cache.delete(uid);
  return deleteApp(entry.app).catch(() => undefined);
}

function open(uid: string): Entry {
  const app = initializeApp(webConfig(), `dya-${uid}-${Date.now()}`);
  const db = (async () => {
    const auth = getAuth(app);
    if (usingEmulator()) {
      connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? EMULATOR_AUTH}`, {
        disableWarnings: true,
      });
    }
    await signInWithCustomToken(auth, await createCustomToken(uid));
    const fs = getFirestore(app);
    if (usingEmulator()) {
      const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST as string).split(':');
      connectFirestoreEmulator(fs, host, Number(port));
    }
    return fs;
  })();
  return { app, db, at: Date.now() };
}

/** Firestore autenticado como `uid` (reutilizado mientras la función siga caliente). */
export function getUserDb(uid: string): Promise<Firestore> {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.db;
  void drop(uid);
  if (cache.size >= MAX_APPS) void drop(cache.keys().next().value as string); // ponytail: FIFO; LRU si hiciera falta
  const entry = open(uid);
  cache.set(uid, entry);
  // Si el inicio de sesión falla no se cachea el error: la próxima petición reintenta.
  entry.db.catch(() => {
    if (cache.get(uid) === entry) void drop(uid);
  });
  return entry.db;
}

/** Cierra las sesiones (los tests lo llaman para que el proceso termine). */
export async function closeUserDbs(): Promise<void> {
  await Promise.all([...cache.keys()].map(drop));
}
