import { defineConfig } from '@playwright/test';
import { pilotE2eEnv } from './tests/e2e/global-setup';

// VVE-100 E2E spine: backend (:8000, Pilot HTTP surface) + Vite dev app
// (:5173, API/WS/login proxied to the backend), seeded by global-setup with
// the deterministic local Managed Board fixture.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  globalSetup: './tests/e2e/global-setup.js',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    // channel 'chrome' runs the locally installed Google Chrome headlessly;
    // the Playwright CDN download for the pinned build is not needed.
    { name: 'chromium', use: { browserName: 'chromium', channel: 'chrome' } },
  ],
  webServer: [
    {
      command: 'npm run build && node dist/src/server.js',
      cwd: '../server',
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        ...process.env,
        ...pilotE2eEnv,
        HOST: '127.0.0.1',
        PORT: '8000',
        // Pilot HTTP surface without production fail-fast checks.
        VVE_PILOT_SURFACE: '1',
        CORS_ORIGIN: 'http://localhost:5173',
      },
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        // Same-origin API/WS through the Vite dev proxy; the Administrator
        // logs in with the passphrase (no build-time secret in the frontend).
        VITE_BACKEND_URL: 'http://localhost:5173'
      }
    },
  ],
});
