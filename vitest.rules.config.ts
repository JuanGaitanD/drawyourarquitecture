import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests de reglas: corren contra los emuladores (pnpm test:rules los arranca con emulators:exec o reutiliza los vivos).
// El alias `@` permite probar el repo de contenido real (`infrastructure/firebase/content.ts`) contra las reglas.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    env: { VITE_USE_EMULATORS: '1' }, // firebase.ts apunta a los emuladores y no exige claves
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
