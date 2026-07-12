import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Rispetta la porta assegnata dall'ambiente (PORT), così i preview con
    // porta dinamica raggiungono il server anche quando la 5173 è occupata.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    // Il dev server serve solo l'app in src/: ignora gli artefatti di tooling
    // (cache dello scraper del catalogo, seed SQL, migrazioni) così una
    // rigenerazione del catalogo non scatena centinaia di reload HMR.
    watch: {
      ignored: [
        '**/tools/unimi-catalog/cache/**',
        '**/tools/unimi-catalog/*.json',
        '**/supabase/seed/**',
        '**/supabase/migrations/**',
      ],
    },
    proxy: {
      '/api/functions': {
        target: 'https://pmpzfkikwfylesehfezv.supabase.co/functions/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/functions/, ''),
      },
    },
  },
})
