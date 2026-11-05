import { defineConfig, devices } from '@playwright/test';
import { E2E_PROJECT } from './tests/e2e/global-setup';

// Pruebas e2e (tests/e2e). El dev server usa los emuladores de Firebase (proyecto demo-dya): Auth y Firestore los
// lleva `pnpm emulators` (deben estar corriendo). `global-setup.ts` carga las reglas de este repo en Firestore y
// arranca (y cierra al terminar) un emulador de Realtime Database si no hay uno en 9000.
const PORT = Number(process.env.E2E_PORT ?? 5185); // E2E_PORT si otro carril ocupa el 5185

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  // Un solo worker: los escenarios comparten la cuenta de prueba del emulador y su lista de proyectos.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    env: { VITE_USE_EMULATORS: '1', VITE_EMULATOR_PROJECT: E2E_PROJECT },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
