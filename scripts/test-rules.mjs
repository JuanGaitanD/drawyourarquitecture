// pnpm test:rules: renderiza las reglas del emulador y corre tests/rules (Firestore + Realtime Database).
// Reutiliza los emuladores vivos (pnpm emulators u otro carril) y arranca con `firebase emulators:exec` solo los que
// faltan. Las reglas de Firestore se recargan al renderizar: el emulador vigila firestore.rules.
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';

const HOST = '127.0.0.1';
const EMULATORS = [
  { name: 'firestore', port: 8080, env: 'FIRESTORE_EMULATOR_HOST' },
  { name: 'database', port: 9000, env: 'FIREBASE_DATABASE_EMULATOR_HOST' },
];
const vitest = 'vitest run --config vitest.rules.config.ts';

const isAlive = (port) =>
  new Promise((resolve) => {
    const s = connect({ host: HOST, port, timeout: 1000 });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.once('timeout', () => (s.destroy(), resolve(false)));
  });

const run = (cmd, env = process.env) => spawnSync(cmd, { stdio: 'inherit', shell: true, env }).status ?? 1;

if (run('node scripts/render-rules.mjs --emulator') !== 0) process.exit(1);

const env = { ...process.env };
const missing = [];
for (const e of EMULATORS) {
  if (await isAlive(e.port)) {
    env[e.env] = `${HOST}:${e.port}`;
    console.log(`Emulador de ${e.name} vivo en ${HOST}:${e.port}: se reutiliza.`);
  } else missing.push(e.name);
}
if (!missing.length) process.exit(run(`pnpm exec ${vitest}`, env));
console.log(`Se arrancan con emulators:exec: ${missing.join(', ')}.`);
process.exit(run(`pnpm exec firebase emulators:exec --only ${missing.join(',')} --project demo-dya "${vitest}"`, env));
