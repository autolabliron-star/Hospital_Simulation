/** A recording canvas-2D context for the painters' node tests: every call and every property set is logged, and the strings drawn and the colours used are kept. */
import type { Ctx2D } from '@/scene/imaging/images/ctx'

export interface Log {
  ctx: Ctx2D & CanvasRenderingContext2D
  /** Every call as "name(args)" and every property set as "name=value", in order (numbers rounded to 1/1000). */
  calls: string[]
  texts: string[]
  /** Every colour string given to a fill or stroke style or a gradient stop. */
  colours: string[]
  count(name: string): number
}

const r3 = (v: unknown): string => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : typeof v === 'string' ? v : typeof v === 'object' && v !== null ? '[obj]' : String(v))

export function logCtx(): Log {
  const calls: string[] = []
  const texts: string[] = []
  const colours: string[] = []
  const counts = new Map<string, number>()
  const store: Record<string, unknown> = {}
  const ctx = new Proxy(store, {
    get(t, key: string) {
      if (key in t) return t[key]
      return (...args: unknown[]) => {
        calls.push(`${key}(${args.map(r3).join(',')})`)
        counts.set(key, (counts.get(key) ?? 0) + 1)
        if (key === 'fillText') texts.push(String(args[0]))
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return { addColorStop: (_k: number, c: string) => void colours.push(c) }
        if (key === 'measureText') return { width: String(args[0]).length * 7 }
        return undefined
      }
    },
    set(t, key: string, value) {
      t[key] = value
      calls.push(`${key}=${r3(value)}`)
      if ((key === 'fillStyle' || key === 'strokeStyle') && typeof value === 'string') colours.push(value)
      return true
    },
  }) as unknown as Log['ctx']
  return { ctx, calls, texts, colours, count: (n) => counts.get(n) ?? 0 }
}

/** Parse "#rgb", "#rrggbb", "rgb(r,g,b)" or "rgba(r,g,b,a)" to [r, g, b] 0..255, or null. */
export function rgbOf(c: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(c)
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)]
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}
