import type * as DatabaseSdk from 'firebase/database';
import { EMULATOR_HOST, EMULATOR_PORTS, HAS_DATABASE, USE_EMULATORS, app } from './firebase';

// Realtime Database (presencia y cursores) se carga con import() como Firestore: no entra en el bundle inicial.
export type DatabaseModule = { rtdb: typeof DatabaseSdk; db: DatabaseSdk.Database };

let sdk: Promise<DatabaseModule> | null = null;

/** `null` si no hay base configurada (sin `VITE_FIREBASE_DATABASE_URL` ni emuladores): la presencia se apaga. */
export function loadDatabase(): Promise<DatabaseModule | null> {
  if (!HAS_DATABASE) return Promise.resolve(null);
  const p = (sdk ??= import('firebase/database').then((rtdb) => {
    const db = rtdb.getDatabase(app);
    if (USE_EMULATORS) rtdb.connectDatabaseEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.database);
    return { rtdb, db };
  }));
  p.catch(() => {
    if (sdk === p) sdk = null;
  });
  return p;
}
