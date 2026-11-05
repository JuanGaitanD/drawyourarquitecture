// pnpm test:rules: renderiza las reglas del emulador y corre tests/rules.
// Si ya hay un emulador de Firestore vivo en 8080 (pnpm emulators u otro carril) lo reutiliza; si no, arranca uno
// con `firebase emulators:exec`. Las reglas se recargan al renderizar: el emulador vigila firestore.rules.
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';

const HOST = '127.0.0.1';
const PORT = 8080;
const vitest = 'vitest run --config vitest.rules.config.ts';

const alive = await new Promise((resolve) => {
  const s = connect({ host: HOST, port: PORT, timeout: 1000 });
  s.once('connect', () => (s.destroy(), resolve(true)));
  s.once('error', () => resolve(false));
  s.once('timeout', () => (s.destroy(), resolve(false)));
});

const run = (cmd, env = process.env) => spawnSync(cmd, { stdio: 'inherit', shell: true, env }).status ?? 1;

if (run('node scripts/render-rules.mjs --emulator') !== 0) process.exit(1);
if (alive) {
  console.log(`Emulador de Firestore vivo en ${HOST}:${PORT}: se reutiliza.`);
  process.exit(run(`pnpm exec ${vitest}`, { ...process.env, FIRESTORE_EMULATOR_HOST: `${HOST}:${PORT}` }));
}
console.log('Sin emulador en 8080: se arranca uno con emulators:exec.');
process.exit(run(`pnpm exec firebase emulators:exec --only firestore --project demo-dya "${vitest}"`));
