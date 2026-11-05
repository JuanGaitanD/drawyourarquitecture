import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';

// Único sitio que crea la app de Firebase. Con VITE_USE_EMULATORS=1 todo apunta a los emuladores locales.

export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === '1';
/** `VITE_EMULATOR_PROJECT` aísla datos y reglas en el emulador compartido (el e2e usa `demo-dya-e2e`). */
export const EMULATOR_PROJECT: string = import.meta.env.VITE_EMULATOR_PROJECT || 'demo-dya';
export const EMULATOR_HOST = '127.0.0.1';
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, database: 9000 } as const;

const env = import.meta.env;
const config = USE_EMULATORS
  ? {
      apiKey: 'demo',
      authDomain: `${EMULATOR_PROJECT}.firebaseapp.com`,
      projectId: EMULATOR_PROJECT,
      appId: 'demo',
    }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
      databaseURL: env.VITE_FIREBASE_DATABASE_URL || undefined,
      measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
    };

/** Sin configuración la app sigue arrancando y la pantalla de acceso explica qué falta. */
export const isFirebaseConfigured = USE_EMULATORS || Boolean(config.apiKey && config.projectId);

export const app: FirebaseApp = initializeApp(config);
export const auth: Auth = getAuth(app);
// Firestore y Realtime Database no se crean aquí: pesan y se cargan con import() al usarlos (firestore.ts, database.ts).
/** Realtime Database (presencia y cursores) existe con emuladores o con `VITE_FIREBASE_DATABASE_URL`. */
export const HAS_DATABASE = USE_EMULATORS || Boolean(config.databaseURL);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
}
