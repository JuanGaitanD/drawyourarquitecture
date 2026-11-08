import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import type { AuthUser, Identity } from '@/application/ports';
import { EMULATOR_AUTH_PROJECT, EMULATOR_HOST, EMULATOR_PORTS, USE_EMULATORS, auth } from './firebase';

/** Uid fijo del dueño en los emuladores: coincide con `OWNER_UID` de las reglas renderizadas con --emulator. */
export const EMULATOR_OWNER_UID = 'owner-test';
// Con `localStorage['dya:testUser'] = 'guest-a'` (solo emuladores) se entra como otra cuenta de prueba: sirve para
// probar la colaboración con dos navegadores.
const testUser = () => (USE_EMULATORS && globalThis.localStorage?.getItem('dya:testUser')) || EMULATOR_OWNER_UID;
const TEST_PASSWORD = 'test-password-1';

const toUser = (u: User | null): AuthUser | null =>
  u ? { uid: u.uid, name: u.displayName ?? u.email ?? 'Cuenta', photo: u.photoURL ?? undefined } : null;

/**
 * Login de prueba para el emulador: crea (si falta) un usuario con uid `owner-test` mediante la API de
 * administración del emulador y entra con correo y clave. Nunca se usa contra Firebase real.
 */
async function signInEmulator(): Promise<void> {
  const uid = testUser();
  const email = uid === EMULATOR_OWNER_UID ? 'owner@test.dev' : `${uid}@test.dev`;
  await fetch(
    `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}/identitytoolkit.googleapis.com/v1/projects/${EMULATOR_AUTH_PROJECT}/accounts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({
        localId: uid,
        email,
        password: TEST_PASSWORD,
        displayName: uid === EMULATOR_OWNER_UID ? 'Dueño de prueba' : `Invitado ${uid}`,
        emailVerified: true,
      }),
    },
  ).catch(() => undefined); // si ya existe responde 400: da igual
  await signInWithEmailAndPassword(auth, email, TEST_PASSWORD);
}

export const identity: Identity = {
  current: () => toUser(auth.currentUser),
  onChange: (cb) => onAuthStateChanged(auth, (u) => cb(toUser(u))),
  async signIn() {
    if (USE_EMULATORS) return signInEmulator();
    await signInWithPopup(auth, new GoogleAuthProvider());
  },
  signOut: () => signOut(auth),
};
