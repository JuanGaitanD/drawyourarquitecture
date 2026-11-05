import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// D41: con emulador, las pruebas de `src/server` usan un proyecto propio por ejecución (como `test:rules` con
// `RULES_PROJECT`): el emulador separa datos y reglas por proyecto, así que otro carril no pisa lo nuestro.
// `admin.ts` y `userDb.ts` ya leen `GCLOUD_PROJECT`; el servidor MCP del e2e de `src/server` lo hereda.
const emulatorProject = process.env.FIRESTORE_EMULATOR_HOST
  ? (process.env.GCLOUD_PROJECT ??
    `demo-dya-t${process.pid.toString(36)}${Date.now().toString(36).slice(-3)}`)
  : undefined;

// Sin `manualChunks`: Excalidraw, React Flow y Firestore ya van en chunks propios por `import()` y
// solo se piden al usarlos. Forzarlos con manualChunks hacía que el chunk arrastrara React, Radix y tslib y que
// el arranque los descargara enteros (Excalidraw ≈ 1,5 MB gzip en la pantalla de acceso).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    env: emulatorProject ? { GCLOUD_PROJECT: emulatorProject } : {},
    // Excalidraw se publica con un import de JSON sin atributo (open-color): lo transforma Vite en vez de Node.
    server: { deps: { inline: [/@excalidraw\/excalidraw/, /open-color/] } },
  },
});
