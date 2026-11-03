import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { api } from './server/api.ts'

export default defineConfig({
  server: { host: '127.0.0.1' },
  plugins: [
    react(),
    tailwind(),
    {
      name: 'omni-api',
      // shortcut: the API only runs inside the Vite dev server, move it to node:http when the app gets packaged.
      // This runs ahead of Vite's own middleware, so api.ts does its own host check.
      configureServer: (server) => void server.middlewares.use('/api', api),
    },
  ],
})
