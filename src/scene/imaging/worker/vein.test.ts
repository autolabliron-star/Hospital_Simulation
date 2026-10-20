/**
 * R3: the blood-draw robot's pictures come from the patient's synthetic forearm: the near-infrared map shows the veins darker than the
 * skin round them, the needle-guide ultrasound shows the vein as a black tube under the skin and the needle as a bright line going into
 * it; the same patient always gives the same picture.
 */
import { describe, expect, it } from 'vitest'
import { RenderCore, veinGeometry } from './core'
import type { VeinJob } from './protocol'

const job = (seed: number, needle: number): VeinJob => ({ t: 'vein', slot: 'draw0', id: 1, seed, needle, time: 1, n: 3, mapW: 150, mapH: 96, us: 96 })
const grey = (r: { rgba: Uint8ClampedArray; w: number }, x: number, y: number): number => r.rgba[(y * r.w + x) * 4]

describe('the vein scanner', () => {
  it('maps the target vein darker than the skin beside it, and puts the target on the map', () => {
    const core = new RenderCore()
    for (const seed of [7, 1234, 99991]) {
      const r = core.renderVein(job(seed, 0))
      const { tx, ty } = r.meta.vein!
      expect(tx).toBeGreaterThan(0.1)
      expect(tx).toBeLessThan(0.95)
      expect(ty).toBeGreaterThan(0.1)
      expect(ty).toBeLessThan(0.9)
      const x = Math.floor(tx * 150)
      const y = Math.floor(ty * 96)
      // the darkest pixel near the target against the skin's median along the same row
      let dark = 255
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) dark = Math.min(dark, grey(r, x + dx, y + dy))
      const row: number[] = []
      for (let i = 20; i < 130; i++) row.push(grey(r, i, Math.max(0, y - 14)))
      row.sort((a, b) => a - b)
      expect(dark, `seed ${seed}`).toBeLessThan(row[row.length >> 1] - 40)
    }
  })

  it('shows the needle as a bright line in the ultrasound once it is in, and is deterministic', () => {
    const core = new RenderCore()
    const usBright = (r: { rgba: Uint8ClampedArray; w: number }): number => {
      let n = 0
      for (let y = 0; y < 96; y++) for (let x = 150; x < 246; x++) if (grey(r, x, y) > 230) n++
      return n
    }
    const without = core.renderVein(job(1234, 0))
    const withNeedle = core.renderVein(job(1234, 0.9))
    expect(usBright(withNeedle)).toBeGreaterThan(usBright(without) + 20)
    const again = new RenderCore().renderVein(job(1234, 0.9))
    expect(Buffer.from(again.rgba).equals(Buffer.from(withNeedle.rgba))).toBe(true)
  })

  it('keeps the probe on the skin above the vein', () => {
    const core = new RenderCore()
    const b = core.body(1234, ['forearm'])
    const g = veinGeometry(b.ph, b.landmarks)
    expect(g.probe.oy).toBeLessThan(g.target[1])
    expect(g.target[1] - g.probe.oy).toBeLessThan(12)
  })
})
