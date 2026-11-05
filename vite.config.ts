import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Sin `manualChunks`: Excalidraw, React Flow y Firestore ya van en chunks propios por `import()` y
// solo se piden al usarlos. Forzarlos con manualChunks hacía que el chunk arrastrara React, Radix y tslib y que
// el arranque los descargara enteros (Excalidraw ≈ 1,5 MB gzip en la pantalla de acceso).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    // Excalidraw se publica con un import de JSON sin atributo (open-color): lo transforma Vite en vez de Node.
    server: { deps: { inline: [/@excalidraw\/excalidraw/, /open-color/] } },
  },
});
