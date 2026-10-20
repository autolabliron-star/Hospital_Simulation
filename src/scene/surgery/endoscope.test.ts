/**
 * The endoscope picture (the facade over endo/) in node, against a recording context: deterministic for a fixed view, full-frame 16:9, composed from the
 * baked plate, its wet layer, the instruments, the light and the in-image HUD; allocation-free per frame (no gradient, no image data after the first paint);
 * driven by the same tip motion as the 3D arms; and never graphic (no red colour anywhere in its palette, no blood words).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENDOSCOPE_UI } from '@/content/endoscopeUi'
import { mockEnv } from '@/scene/imaging/images/mockCanvas'
import { endoPlates, resetEndoPlates } from './endo/plates'
import { LOOKS } from './endo/looks'
import { isTierA, isTierB } from './endo/noBlood'
import { resetEndoSprites } from './endo/sprites'
import { bakeEndoPlatesNow, EndoPainter, INSTRUMENT_ARMS, newEndoView, newTip, paintEndoscope, paintStandby, setProcedureLooks, tipOnScreen, type EndoView } from './endoscope'
import { tipMotion, type TipMotion } from './robotPose'
import { logCtx, rgbOf } from './testctx'

const W = 384
const H = 216
const A = 16 / 9

/** A fresh painter each time, so its first-paint measurements do not leak between calls. */
const paint = (v: EndoView, w = W, h = H) => {
  const l = logCtx()
  new EndoPainter(w, h).paint(l.ctx, v)
  return l
}
const view = (over: Partial<Pick<EndoView, 'seed' | 't' | 'gain' | 'proc'>> = {}): EndoView => setProcedureLooks(newEndoView(over), over.proc ?? 0)

beforeAll(() => {
  // the cholecystectomy's plate (and the sprites) into mock canvases; the other two stay unbaked, so their pictures use the plain field
  bakeEndoPlatesNow(mockEnv().env, [0])
})
afterAll(() => {
  resetEndoPlates()
  resetEndoSprites()
})

describe('the endoscope picture', () => {
  it('is deterministic: the same view paints exactly the same picture', () => {
    const a = paint(view({ seed: 7, t: 41.5 }))
    const b = paint(view({ seed: 7, t: 41.5 }))
    expect(a.calls).toEqual(b.calls)
    expect(a.calls.length).toBeGreaterThan(200)
  })

  it('changes with the time, the seed, the gain, the procedure and the instruments', () => {
    const base = paint(view({ seed: 7, t: 41.5 })).calls
    expect(paint(view({ seed: 7, t: 44.5 })).calls).not.toEqual(base)
    expect(paint(view({ seed: 8, t: 41.5 })).calls).not.toEqual(base)
    expect(paint(view({ seed: 7, t: 41.5, gain: 0 })).calls).not.toEqual(base)
    expect(paint(view({ seed: 7, t: 41.5, proc: 1 })).calls).not.toEqual(base)
    const swapped = view({ seed: 7, t: 41.5 })
    swapped.look[1] = LOOKS.findIndex((l) => l.id === 'hook')
    expect(paint(swapped).calls).not.toEqual(base)
  })

  it('is composed from the plate, its wet layer added on top, the instruments, the light and the HUD, with no gradient and no image data', () => {
    const l = paint(view({ seed: 7, t: 12 }))
    const plate = endoPlates.plates[0]!
    // the plate's window stretched over the whole 16:9 picture: a 16:9 source window into (0, 0, 384, 216)
    const plateCall = l.calls.find((c) => c.startsWith('drawImage(') && c.endsWith(`,0,0,${W},${H})`))
    expect(plateCall).toBeDefined()
    const [, , , sw, sh] = plateCall!.slice('drawImage('.length, -1).split(',').map(Number)
    expect(sw / sh).toBeCloseTo(A, 2)
    expect(sh).toBeLessThan(plate.h)
    expect(l.calls).toContain('globalCompositeOperation=lighter')
    // three instruments: dozens of sprites, each under its own transform
    expect(l.count('drawImage')).toBeGreaterThan(30)
    expect(l.count('setTransform')).toBeGreaterThan(25)
    // nothing made per frame
    for (const made of ['createLinearGradient', 'createRadialGradient', 'createImageData', 'putImageData', 'getImageData']) expect(l.count(made), made).toBe(0)
    // the HUD, in the image
    expect(l.texts).toContain(ENDOSCOPE_UI.hud.camera)
    expect(l.texts).toContain(ENDOSCOPE_UI.hud.simulated)
    expect(l.texts).toEqual(expect.arrayContaining(['1', '2', '3', '4', 'Bipolar', 'Scissors', 'Prograsp']))
    expect(l.texts).not.toContain(ENDOSCOPE_UI.hud.exchanging)
  })

  it('measures its HUD text once: the second paint of a painter measures nothing', () => {
    const p = new EndoPainter(W, H)
    const first = logCtx()
    p.paint(first.ctx, view({ t: 5 }))
    expect(first.count('measureText')).toBeGreaterThan(0)
    const second = logCtx()
    p.paint(second.ctx, view({ t: 6 }))
    expect(second.count('measureText')).toBe(0)
    expect(p.paints).toBe(2)
  })

  it('says "Exchanging" while an instrument is changed, and the tool is out of the picture at the bottom of it', () => {
    const v = view({ seed: 7, t: 30 })
    v.exchanging = 1
    v.withdraw[1] = 1
    const l = paint(v)
    expect(l.texts).toContain(ENDOSCOPE_UI.hud.exchanging)
    const tip = tipOnScreen(1, v, newTip())
    expect(Math.abs(tip.x) > A || Math.abs(tip.y) > 1).toBe(true)
  })

  it('paints a plain warm field (and still the tools, the light and the HUD) before the procedure\'s plate is baked', () => {
    const l = paint(view({ seed: 7, t: 12, proc: 2 }))
    expect(l.calls).toContain('fillStyle=#6b4a3e')
    expect(l.calls).toContain(`fillRect(0,0,${W},${H})`)
    expect(l.calls).not.toContain('globalCompositeOperation=lighter')
    expect(l.count('drawImage')).toBeGreaterThan(30)
    expect(l.texts).toContain(ENDOSCOPE_UI.hud.simulated)
  })

  it('draws the same picture at the console card\'s 768 x 432, scaled', () => {
    const small = paint(view({ seed: 3, t: 20 }))
    const big = paint(view({ seed: 3, t: 20 }), 768, 432)
    expect(big.count('drawImage')).toBe(small.count('drawImage'))
    expect(big.texts).toEqual(small.texts)
    // the shared facade keeps one painter per size
    const l = logCtx()
    paintEndoscope(l.ctx, 768, 432, view({ seed: 3, t: 20 }))
    expect(l.count('drawImage')).toBe(big.count('drawImage'))
  })

  it('is never graphic: no blood red anywhere in its palette, no graphic words', () => {
    for (const v of [view({ seed: 1, t: 3 }), view({ seed: 99, t: 700, proc: 1 }), view({ seed: 7, t: 41, gain: 0 })]) {
      v.energy[0] = 1
      const l = paint(v)
      expect(l.colours.length).toBeGreaterThan(20)
      for (const c of l.colours) {
        const rgb = rgbOf(c)
        if (!rgb) continue
        const [r, g, b] = rgb
        expect(r > 110 && g < r * 0.4 && b < r * 0.4, `colour ${c}`).toBe(false)
        expect(isTierA(r, g, b) || isTierB(r, g, b), `colour ${c}`).toBe(false)
      }
      for (const t of l.texts) expect(t).not.toMatch(/blood|bleed|incision|wound|cut/i)
    }
  })
})

describe('the instrument tips', () => {
  it('are arms 0, 2 and 3: the endoscope (arm 1) is the camera itself and is not in its own picture', () => {
    expect(INSTRUMENT_ARMS).toEqual([0, 2, 3])
  })

  it('move with the same tip motion as the 3D arms: the jaw is the arm\'s jaw, and the tip moves with its pitch, yaw and insertion', () => {
    const m: TipMotion = { insert: 0, pitch: 0, yaw: 0, jaw: 0, roll: 0 }
    const out = newTip()
    const rest = newTip()
    for (const t of [3, 17.3, 55.9, 120.4]) {
      INSTRUMENT_ARMS.forEach((arm, k) => {
        tipMotion(arm, t, 4242, m)
        tipOnScreen(k, newEndoView({ seed: 4242, t, gain: 1 }), out)
        expect(out.jaw).toBeCloseTo(m.jaw, 9)
        tipOnScreen(k, newEndoView({ seed: 4242, t, gain: 0 }), rest)
        expect(Math.hypot(out.x - rest.x, out.y - rest.y)).toBeLessThan(0.6)
        expect(rest.jaw).toBeCloseTo(0.3, 9)
        expect(rest.bend).toBeCloseTo(0, 12)
      })
    }
  })

  it('stay in the 16:9 picture while in place, and the shaft always comes in from outside it', () => {
    const out = newTip()
    for (let t = 0; t < 600; t += 1.7) {
      for (let k = 0; k < 3; k++) {
        tipOnScreen(k, newEndoView({ seed: 9, t, gain: 1 }), out)
        expect(Math.abs(out.x)).toBeLessThan(A * 0.85)
        expect(Math.abs(out.y)).toBeLessThan(0.85)
        expect(Math.abs(out.ex) > A || Math.abs(out.ey) > 1).toBe(true)
        expect(Math.hypot(out.dx, out.dy)).toBeCloseTo(1, 9)
        expect(out.jaw).toBeGreaterThanOrEqual(0)
        expect(out.jaw).toBeLessThanOrEqual(1)
      }
    }
  })

  it('slide back out along their own shaft as they are withdrawn', () => {
    const v = newEndoView({ seed: 5, t: 77 })
    const a = tipOnScreen(0, v, newTip())
    v.withdraw[0] = 0.5
    const b = tipOnScreen(0, v, newTip())
    v.withdraw[0] = 1
    const c = tipOnScreen(0, v, newTip())
    // along the shaft, toward the entry
    const along = (p: { x: number; y: number }): number => (p.x - a.ex) * a.dx + (p.y - a.ey) * a.dy
    expect(along(b)).toBeLessThan(along(a))
    expect(along(c)).toBeLessThan(0)
    expect(Math.abs((b.x - a.x) * a.dy - (b.y - a.y) * a.dx)).toBeLessThan(1e-9)
  })

  it('open and close their jaws over time (the picture shows the bites)', () => {
    const out = newTip()
    let lo = 1
    let hi = 0
    for (let t = 0; t < 400; t += 0.5) {
      tipOnScreen(0, newEndoView({ seed: 5, t, gain: 1 }), out)
      lo = Math.min(lo, out.jaw)
      hi = Math.max(hi, out.jaw)
    }
    expect(lo).toBeLessThan(0.1)
    expect(hi).toBeGreaterThan(0.9)
  })
})

describe('the standby picture', () => {
  it('is a dark 16:9 field with a soft glow, a thin frame, its title and a line under it, and it is deterministic', () => {
    const a = logCtx()
    paintStandby(a.ctx, W, H, 'Title', 'Line')
    const b = logCtx()
    paintStandby(b.ctx, W, H, 'Title', 'Line')
    expect(a.calls).toEqual(b.calls)
    expect(a.texts).toEqual(['Title', 'Line'])
    expect(a.calls).toContain(`fillRect(0,0,${W},${H})`)
    expect(a.count('arc')).toBe(4)
    expect(a.count('stroke')).toBe(1)
  })
})
