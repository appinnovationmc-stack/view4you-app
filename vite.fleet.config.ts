import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Fleet & Asset Portal is its own web app: separate sign-in, separate build, never bundled into the phone app
// or the operator admin console. Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the repo-root .env.
export default defineConfig({
  root: 'fleet',
  envDir: '..',
  base: './',
  publicDir: '../public',
  plugins: [react()],
  build: { outDir: '../dist-fleet', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5175 },
})
