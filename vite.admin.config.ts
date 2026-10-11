import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The operator console is a separate web app (never bundled into the phone app).
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the repo-root .env, like the main app.
export default defineConfig({
  root: 'admin',
  envDir: '..',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist-admin', emptyOutDir: true },
  server: { port: 5174 },
})
