/**
 * The endoscope painter in node, against a recording context: deterministic for a fixed seed and time, not empty, driven by the same tip motion as the 3D arms, and
 * never graphic (no blood red anywhere in its palette, no text, no incisions: the picture is a soft field, metal tips, a vignette).
 */
import { describe, expect, it } from 'vitest'
import { INSTRUMENT_ARMS, paintEndoscope, paintStandby, tipOnScreen, type EndoView, type TipOnScreen } from './endoscope'
import { tipMotion, type TipMotion } from './robotPose'
import { logCtx, rgbOf } from './testctx'

const paint = (v: EndoView, w = 384, h = 240) => {
  const l = logCtx()
  paintEndoscope(l.ctx, w, h, v)
  return l
}
const tip = (): TipOnScreen => ({ ex: 0, ey: 0, x: 0, y: 0, dx: 1, dy: 0, jaw: 0 })

describe('the endoscope picture', () => {
  it('is deterministic: the same seed and time paint exactly the same picture', () => {
    const a = paint({ seed: 7, t: 41.5, gain: 1 })
    const b = paint({ seed: 7, t: 41.5, gain: 1 })
    expect(a.calls).toEqual(b.calls)
    expect(a.calls.length).toBeGreaterThan(100)
  })

  it('changes with the time, the seed and the instruments\' gain', () => {
    const base = paint({ seed: 7, t: 41.5, gain: 1 }).calls
    expect(paint({ seed: 7, t: 44.5, gain: 1 }).calls).not.toEqual(base)
    expect(paint({ seed: 8, t: 41.5, gain: 1 }).calls).not.toEqual(base)
    expect(paint({ seed: 7, t: 41.5, gain: 0 }).calls).not.toEqual(base)
  })

  it('is not empty: a field, soft folds and highlights, three instruments with jaws, a vignette, and a round clip', () => {
    const l = paint({ seed: 7, t: 12, gain: 1 })
    expect(l.count('fillRect')).toBeGreaterThanOrEqual(3)
    expect(l.count('clip')).toBe(1)
    expect(l.count('createRadialGradient')).toBeGreaterThanOrEqual(16) // the field, nine folds, three patches, three highlights, the vignette
    expect(l.count('createLinearGradient')).toBe(3) // one per instrument shaft
    expect(l.count('arc')).toBeGreaterThanOrEqual(20)
    expect(l.count('stroke')).toBeGreaterThanOrEqual(12) // shadows, edges and jaw blades of three instruments
    expect(l.count('save')).toBe(l.count('restore'))
    expect(l.texts).toEqual([])
    // all inside the canvas: nothing is drawn at a size that is not the canvas's (a 256 x 160 picture is the same drawing)
    const small = paint({ seed: 7, t: 12, gain: 1 }, 256, 160)
    expect(small.count('fillRect')).toBe(l.count('fillRect'))
  })

  it('is never graphic: no blood red, no wet red, anywhere in its palette (the field is salmon and rose, the instruments grey metal)', () => {
    for (const v of [{ seed: 1, t: 3, gain: 1 }, { seed: 99, t: 700, gain: 1 }, { seed: 7, t: 41, gain: 0 }]) {
      const l = paint(v)
      expect(l.colours.length).toBeGreaterThan(30)
      for (const c of l.colours) {
        const rgb = rgbOf(c)
        if (!rgb) continue
        const [r, g, b] = rgb
        // red-saturated: strong red with little green and blue
        expect(r > 110 && g < r * 0.4 && b < r * 0.4, `colour ${c}`).toBe(false)
      }
    }
  })
})

describe('the instrument tips', () => {
  it('are arms 0, 2 and 3: the endoscope (arm 1) is the camera itself and is not in its own picture', () => {
    expect(INSTRUMENT_ARMS).toEqual([0, 2, 3])
  })

  it('move with the same tip motion as the 3D arms: the jaw is the arm\'s jaw, and the tip moves with its pitch and yaw', () => {
    const m: TipMotion = { insert: 0, pitch: 0, yaw: 0, jaw: 0, roll: 0 }
    const out = tip()
    const rest = tip()
    for (const t of [3, 17.3, 55.9, 120.4]) {
      INSTRUMENT_ARMS.forEach((arm, k) => {
        tipMotion(arm, t, 4242, m)
        tipOnScreen(k, { seed: 4242, t, gain: 1 }, out)
        expect(out.jaw).toBeCloseTo(m.jaw, 9)
        tipOnScreen(k, { seed: 4242, t, gain: 0 }, rest)
        // moved from the resting place by (yaw, pitch) in the picture, plus the insertion along the shaft
        expect(Math.hypot(out.x - rest.x, out.y - rest.y)).toBeLessThan(0.45)
        expect(rest.jaw).toBeCloseTo(0.3, 9)
      })
    }
  })

  it('stay in the picture: every tip is inside the circle and the shaft always runs in from the rim', () => {
    const out = tip()
    for (let t = 0; t < 600; t += 1.7) {
      for (let k = 0; k < 3; k++) {
        tipOnScreen(k, { seed: 9, t, gain: 1 }, out)
        expect(Math.hypot(out.x, out.y)).toBeLessThan(0.85)
        expect(Math.hypot(out.ex, out.ey)).toBeGreaterThan(1)
        expect(Math.hypot(out.dx, out.dy)).toBeCloseTo(1, 9)
        expect(out.jaw).toBeGreaterThanOrEqual(0)
        expect(out.jaw).toBeLessThanOrEqual(1)
      }
    }
  })

  it('open and close their jaws over time (the picture shows the bites)', () => {
    const out = tip()
    let lo = 1
    let hi = 0
    for (let t = 0; t < 400; t += 0.5) {
      tipOnScreen(0, { seed: 5, t, gain: 1 }, out)
      lo = Math.min(lo, out.jaw)
      hi = Math.max(hi, out.jaw)
    }
    expect(lo).toBeLessThan(0.1)
    expect(hi).toBeGreaterThan(0.9)
  })
})

describe('the standby picture', () => {
  it('is a dark field with a faint circle, its title and a line under it, and it is deterministic', () => {
    const a = logCtx()
    paintStandby(a.ctx, 256, 160, 'Title', 'Line')
    const b = logCtx()
    paintStandby(b.ctx, 256, 160, 'Title', 'Line')
    expect(a.calls).toEqual(b.calls)
    expect(a.texts).toEqual(['Title', 'Line'])
    expect(a.count('fillRect')).toBe(1)
    expect(a.count('arc')).toBeGreaterThanOrEqual(2)
  })
})
