import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';

// Prepara el emulador antes del e2e (D29). Causa del fallo intermitente tras `test:rules`: los emuladores son de todos
// los carriles y el proyecto `demo-dya` es uno solo, así que otro `test:rules` (que hace `clearFirestore()` entre
// pruebas y recarga reglas) o un `emulators:exec` que cierra Realtime Database pisaban datos, reglas y puertos en
// pleno e2e. El e2e usa SU PROYECTO (`demo-dya-e2e`): el emulador separa por proyecto los datos, las reglas y las
// cuentas de Auth, y la app lo recibe en `VITE_EMULATOR_PROJECT`.
//   1. Auth (9099) y Firestore (8080) tienen que estar vivos: no se arrancan (los lleva `pnpm emulators`).
//   2. Se cargan las reglas de este repo en Firestore y en Realtime Database para el proyecto del e2e.
//   3. Si no hay Realtime Database en 9000 (presencia y cursores) se arranca uno y se cierra al terminar.
export const E2E_PROJECT = 'demo-dya-e2e';
const HOST = '127.0.0.1';
const OWNER = 'owner-test';

const isAlive = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect({ host: HOST, port, timeout: 1000 });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.once('timeout', () => (s.destroy(), resolve(false)));
  });

async function waitFor(port: number, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
    if (await isAlive(port)) return true;
  }
  return false;
}

async function put(url: string, body: string, what: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { method: 'PUT', body, headers });
  if (!res.ok)
    throw new Error(`No se pudieron cargar las reglas de ${what}: ${res.status} ${await res.text()}`);
}

/** Misma llamada que usa `@firebase/rules-unit-testing`; la plantilla se renderiza en memoria (sin tocar firestore.rules). */
const loadFirestoreRules = () =>
  put(
    `http://${HOST}:8080/emulator/v1/projects/${E2E_PROJECT}:securityRules`,
    JSON.stringify({
      rules: {
        files: [{ content: readFileSync('firestore.rules.tpl', 'utf8').replaceAll('__OWNER_UID__', OWNER) }],
      },
    }),
    'Firestore',
  );

/** Reglas de Realtime Database para el espacio por defecto del proyecto (el que usa la app con emuladores). */
const loadDatabaseRules = () =>
  put(
    `http://${HOST}:9000/.settings/rules.json?ns=${E2E_PROJECT}-default-rtdb`,
    readFileSync('database.rules.json', 'utf8'),
    'Realtime Database',
    { Authorization: 'Bearer owner' },
  );

/** Mata el árbol de procesos por PID (el CLI de Firebase lanza Java como nieto). */
function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
}

export default async function globalSetup() {
  for (const [name, port] of [
    ['Auth', 9099],
    ['Firestore', 8080],
  ] as const) {
    if (!(await isAlive(port))) {
      throw new Error(`El emulador de ${name} no está en ${HOST}:${port}: arranca \`pnpm emulators\`.`);
    }
  }
  await loadFirestoreRules();

  let db: ChildProcess | undefined;
  if (!(await isAlive(9000))) {
    console.log('Realtime Database no está en 9000: se arranca para el e2e y se cierra al terminar.');
    db = spawn(`pnpm exec firebase emulators:start --only database --project demo-dya`, {
      shell: true,
      stdio: 'ignore',
    });
    if (!(await waitFor(9000, 90_000))) {
      killTree(db);
      throw new Error('El emulador de Realtime Database no arrancó en 90 s.');
    }
  }
  try {
    await loadDatabaseRules();
  } catch (e) {
    if (db) killTree(db);
    throw e;
  }
  return () => {
    if (db) killTree(db);
  };
}
