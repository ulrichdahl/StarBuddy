import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev: the Laravel backend (behind Caddy or `php artisan serve`)
    // listens on :8080. In production Caddy serves the built SPA and
    // proxies these prefixes itself, so the app always talks same-origin.
    proxy: {
      '/api': 'http://localhost:8080',
      '/sanctum': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
    },
  },
})
