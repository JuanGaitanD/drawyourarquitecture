import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Los motores pesados van en chunks propios y solo se piden en las rutas de editor.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@excalidraw')) return 'excalidraw';
          if (id.includes('@xyflow')) return 'xyflow';
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'firebase';
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
