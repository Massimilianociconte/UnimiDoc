import { defineConfig } from 'vitest/config'

// Config vitest separata da vite.config.ts: il progetto usa rolldown-vite e i
// tipi di vitest/config (vite npm) confliggono con i suoi in tsc -b.
// Qui solo unit test: gli spec in e2e/ sono Playwright e non devono essere
// raccolti da vitest (fallirebbero con "test() did not expect to be called").
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
})
