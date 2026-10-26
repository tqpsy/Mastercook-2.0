import { defineConfig, devices } from '@playwright/test';

const SERVER = 'http://localhost:54400';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5173/Mastercook-2.0/', locale: 'it-IT', trace: 'retain-on-failure' },
  projects: [
    { name: 'telefono', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium' } },
  ],
  webServer: [
    { command: 'node tests/e2e/server-prova.mjs', url: `${SERVER}/auth/v1/health`, reuseExistingServer: false, stdout: 'pipe' },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173/Mastercook-2.0/',
      reuseExistingServer: false,
      env: { VITE_SUPABASE_URL: SERVER, VITE_SUPABASE_CHIAVE: 'chiave-di-prova' },
    },
  ],
});
