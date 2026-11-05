import { defineConfig } from 'vitest/config';

// Tests de reglas: corren contra los emuladores (pnpm test:rules los arranca con emulators:exec).
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
