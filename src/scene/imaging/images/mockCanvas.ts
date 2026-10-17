/**
 * A recording 2D context for node tests: every method call is counted by name, properties can be set, gradients and image data are
 * stubbed. It lets the screens and painters run (and be measured in canvas calls) without a browser.
 */
import type { Ctx2D, Env, Surface } from './ctx'

export interface Recorder {
  calls: Map<string, number>
  total(): number
  reset(): void
  count(name: string): number
}

export function mockSurface(width: number, height: number, rec: Recorder): Surface {
  const store: Record<string, unknown> = {}
  const canvas = { width, height }
  const ctx = new Proxy(store, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (key === 'canvas') return canvas
      return (...args: unknown[]) => {
        rec.calls.set(key, (rec.calls.get(key) ?? 0) + 1)
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return { addColorStop: () => undefined }
        if (key === 'createImageData') return { data: new Uint8ClampedArray((args[0] as number) * (args[1] as number) * 4) }
        if (key === 'measureText') return { width: 10 }
        return undefined
      }
    },
    set(target, key: string, value) {
      target[key] = value
      return true
    },
  }) as unknown as Ctx2D
  return { canvas: canvas as unknown as Surface['canvas'], ctx }
}

export function createRecorder(): Recorder {
  const calls = new Map<string, number>()
  return {
    calls,
    total: () => [...calls.values()].reduce((a, b) => a + b, 0),
    reset: () => calls.clear(),
    count: (name) => calls.get(name) ?? 0,
  }
}

export function mockEnv(rec: Recorder = createRecorder()): { env: Env; rec: Recorder } {
  return { env: { createSurface: (w, h) => mockSurface(w, h, rec), supportsFilter: true }, rec }
}
