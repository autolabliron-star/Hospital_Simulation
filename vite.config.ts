/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    maxWorkers: 2,
  },
})
