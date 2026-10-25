/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/** Whole-day sim runs (each over a minute): `npm run test:quick` skips them so the rest of the suite finishes in under 10 minutes. */
const SLOW_TESTS = [
  'src/sim/population.integration.test.ts',
  'src/sim/vitals/determinism.test.ts',
  'src/sim/surgery/surgery.test.ts',
  'src/sim/er/kiosk.test.ts',
  'src/sim/reactions.test.ts',
  'src/sim/opening.integration.test.ts',
  'src/sim/surgery/showcase.test.ts',
  'src/sim/day/shifts.test.ts',
  'src/sim/clinicalSense.test.ts',
  'src/sim/er/inFlight.test.ts',
  'src/sim/beds/flow.warm.test.ts',
  'src/sim/blood/morning.test.ts',
  'src/sim/soak.test.ts',
  'src/sim/vitals/morning.test.ts',
]

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', ...(process.env.QUICK_TESTS ? SLOW_TESTS : [])],
    maxWorkers: 2,
  },
})
