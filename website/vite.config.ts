import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps the built site loadable from any static-host subpath
// (e.g. GitHub Pages project sites) without extra configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
})
