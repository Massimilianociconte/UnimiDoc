import { defineConfig, devices } from '@playwright/test'

// E2E in modalità demo (--mode e2e ⇒ .env.e2e azzera le credenziali Supabase):
// i flussi critici — esplora/classifiche, login, upload, pagine corso — girano
// interamente sul catalogo demo e sul wallet locale, senza toccare il backend.
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --mode e2e --port 5199 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
