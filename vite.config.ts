import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honor a harness-assigned port (e.g. preview tooling's autoPort).
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
})
