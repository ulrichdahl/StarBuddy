import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // `docker compose up` runs this dev server in the `frontend` container
    // behind Caddy (docker-compose.override.yml): Caddy routes the API
    // itself and proxies the rest here, HMR websocket included, so the
    // browser sees one origin. The proxy below only matters when you run
    // `npm run dev` directly on the host against a stack on HTTP_PORT.
    proxy: {
      '/api': `http://localhost:${process.env.HTTP_PORT ?? 8080}`,
      '/sanctum': `http://localhost:${process.env.HTTP_PORT ?? 8080}`,
      '/broadcasting': `http://localhost:${process.env.HTTP_PORT ?? 8080}`,
      '/app': { target: `http://localhost:${process.env.HTTP_PORT ?? 8080}`, ws: true },
    },
  },
})
