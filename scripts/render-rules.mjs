// Genera firestore.rules y storage.rules a partir de las plantillas *.rules.tpl.
//   node scripts/render-rules.mjs             toma OWNER_UID de .env (o del entorno) y falla si falta
//   node scripts/render-rules.mjs --emulator  usa «owner-test», el uid del login de prueba del emulador
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const emulator = process.argv.includes('--emulator');

let uid = 'owner-test';
if (!emulator) {
  try {
    process.loadEnvFile(join(root, '.env'));
  } catch {
    /* sin .env: puede venir del entorno */
  }
  uid = process.env.OWNER_UID ?? '';
  if (!uid) {
    console.error(
      'Falta OWNER_UID (en .env o en el entorno). Es el uid del único dueño con permiso de escritura.',
    );
    process.exit(1);
  }
}
// El uid acaba dentro de un literal de las reglas: solo caracteres seguros.
if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
  console.error('OWNER_UID no es válido: solo letras, números, «_» y «-» (máximo 128).');
  process.exit(1);
}

for (const name of ['firestore', 'storage']) {
  const tpl = readFileSync(join(root, `${name}.rules.tpl`), 'utf8');
  writeFileSync(join(root, `${name}.rules`), tpl.replaceAll('__OWNER_UID__', uid));
}
console.log(`Reglas generadas para ${emulator ? 'el emulador (owner-test)' : 'OWNER_UID de .env'}.`);
