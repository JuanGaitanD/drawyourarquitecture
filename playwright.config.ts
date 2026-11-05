import { defineConfig, devices } from '@playwright/test';

// Pruebas e2e (tests/e2e). El dev server usa los emuladores de Firebase (proyecto demo-dya):
// `pnpm emulators` debe estar corriendo; la config no los arranca ni los detiene.
const PORT = 5185;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
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
    env: { VITE_USE_EMULATORS: '1' },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
