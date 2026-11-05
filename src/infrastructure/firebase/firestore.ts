import type * as FirestoreSdk from 'firebase/firestore';
import { EMULATOR_HOST, EMULATOR_PORTS, USE_EMULATORS, app } from './firebase';

// El SDK de Firestore se carga con import() la primera vez que se usa (tras el login o al abrir un enlace
// público): así queda fuera del bundle inicial, que solo lleva la pantalla de acceso.
export type FirestoreModule = { fs: typeof FirestoreSdk; db: FirestoreSdk.Firestore };

let sdk: Promise<FirestoreModule> | null = null;

export function loadFirestore(): Promise<FirestoreModule> {
  const p = (sdk ??= import('firebase/firestore').then((fs) => {
    const db = fs.getFirestore(app);
    if (USE_EMULATORS) fs.connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore);
    return { fs, db };
  }));
  // Si la carga falla (red), la próxima llamada vuelve a intentarlo.
  p.catch(() => {
    if (sdk === p) sdk = null;
  });
  return p;
}
