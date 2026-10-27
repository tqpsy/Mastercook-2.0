import { defineConfig, devices } from '@playwright/test';

// Porte cambiabili (MC_PORTA_SERVER, MC_PORTA_APP) se sul computer sono già occupate.
const PORTA_SERVER = process.env.MC_PORTA_SERVER ?? '54400';
const PORTA_APP = process.env.MC_PORTA_APP ?? '5173';
const SERVER = `http://localhost:${PORTA_SERVER}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${PORTA_APP}/Mastercook-2.0/`, locale: 'it-IT', trace: 'retain-on-failure' },
  projects: [
    { name: 'telefono', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium' } },
  ],
  webServer: [
    { command: 'node tests/e2e/server-prova.mjs', env: { PORTA: PORTA_SERVER }, url: `${SERVER}/auth/v1/health`, reuseExistingServer: false, stdout: 'pipe' },
    {
      command: `npx vite --port ${PORTA_APP} --strictPort`,
      url: `http://localhost:${PORTA_APP}/Mastercook-2.0/`,
      reuseExistingServer: false,
      env: { VITE_SUPABASE_URL: SERVER, VITE_SUPABASE_CHIAVE: 'chiave-di-prova' },
    },
  ],
});
