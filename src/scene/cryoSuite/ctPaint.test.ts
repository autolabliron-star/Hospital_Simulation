/**
 * R4: the suite's painters in node: deterministic (the same state paints the same calls), never empty, "Simulated" on every view, the base slice
 * painted once per image seed, the planning paths numbered with the current one amber, the needles and the ice on the live view, the sweep during a
 * scan, the console's temperatures and timer, and the station's alignment.
 */
import { describe, expect, it } from 'vitest'
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import type { Ctx2D, Surface } from '@/scene/imaging/images/ctx'
import { createRecorder, mockEnv, mockSurface } from '@/scene/imaging/images/mockCanvas'
import type { CryoSuiteState } from '@/sim/types'
import { baseSliceFor, clockOf, iceRadiusMm, imageBox, newBaseSliceCache, paintConsole, paintLive, paintPlanning, paintRobotStation, zoomBox, CRYO_IMAGE, INK, LIVE_ZOOM } from './ctPaint'
import { CRYO_SLICES } from './ctSlices'
import { rasterEnv, rasterSurface, redPixels, type RasterSurface } from './rasterTestkit'
import { cryoState } from './testkit'

/** A 2D context that logs every call and property set (with their arguments), for determinism and for reading what was drawn. */
function loggingCtx(): { ctx: Ctx2D; log: string[] } {
  const log: string[] = []
  const store: Record<string, unknown> = {}
  const ctx = new Proxy(store, {
    get(target, key: string) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        log.push(`${key}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : typeof a === 'object' ? 'obj' : String(a))).join(',')})`)
        if (key === 'measureText') return { width: String(args[0]).length * 6 }
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return { addColorStop: () => undefined }
        return undefined
      }
    },
    set(target, key: string, value) {
      target[key] = value
      log.push(`${key}=${String(value)}`)
      return true
    },
  }) as unknown as Ctx2D
  return { ctx, log }
}

const base: Surface = mockSurface(256, 256, createRecorder())
type Painter = (c: Ctx2D, w: number, h: number, s: CryoSuiteState) => void
const PAINTERS: [string, Painter][] = [
  ['planning', (c, w, h, s) => paintPlanning(c, w, h, s, base)],
  ['live', (c, w, h, s) => paintLive(c, w, h, s, base)],
  ['console', paintConsole],
  ['robot station', paintRobotStation],
]
const STATES: [string, CryoSuiteState][] = [
  ['idle', (() => { const s = cryoState({ step: 'idle', needles: 0 }); s.needles = []; return s })()],
  ['planning CT', cryoState({ step: 'planningCt', tablePos: 1, scan: 0.4, needles: 3 })],
  ['aim', cryoState({ step: 'aim', robot: 'aiming', robotNeedle: 1, inserted: [1, 0.4, 0] })],
  ['freeze', cryoState({ step: 'freeze1', ice: 0.6 })],
  ['six needles', cryoState({ step: 'freeze2', needles: 6, ice: 1 })],
]

const texts = (log: string[]) => log.filter((l) => l.startsWith('fillText(')).map((l) => l.slice(9, l.indexOf(',')))

describe('the painters', () => {
  for (const [name, paint] of PAINTERS) {
    it(`${name}: deterministic, never empty, "Simulated" on every state, at the tile's and the panel's size`, () => {
      for (const [label, s] of STATES) {
        for (const [w, h] of [[418, 256], [384, 384]]) {
          const a = loggingCtx()
          const b = loggingCtx()
          paint(a.ctx, w, h, s)
          paint(b.ctx, w, h, s)
          expect(a.log, `${name} ${label}`).toEqual(b.log)
          const shapes = a.log.filter((l) => /^(fill|stroke|fillRect|drawImage|fillText)\(/.test(l)).length
          expect(shapes, `${name} ${label}`).toBeGreaterThan(4)
          expect(texts(a.log), `${name} ${label}`).toContain(CRYO_SUITE_COPY.panel.tag)
          expect(a.log.join(' ')).not.toMatch(/NaN|undefined/)
        }
      }
    })
  }

  it('planning: numbers every path, the one being aimed in amber', () => {
    const s = cryoState({ step: 'aim', needles: 4, robot: 'aiming', robotNeedle: 2, inserted: [1, 1, 0, 0] })
    const { ctx, log } = loggingCtx()
    paintPlanning(ctx, 418, 256, s, base)
    const t = texts(log)
    for (const k of ['1', '2', '3', '4']) expect(t).toContain(k)
    expect(t).toContain('Needle 3 of 4')
    expect(log).toContain(`strokeStyle=${INK.amber}`)
    expect(log.filter((l) => l.startsWith('setLineDash(obj')).length).toBeGreaterThan(3)
  })

  it('live: the needles drawn only once they are in, the ice only while there is ice, the sweep only during a scan', () => {
    const count = (s: CryoSuiteState) => {
      const { ctx, log } = loggingCtx()
      paintLive(ctx, 418, 256, s, base)
      return { ellipses: log.filter((l) => l.startsWith('ellipse(')).length, sweep: log.includes(`fillStyle=${INK.teal}`), ice: log.includes(`fillStyle=${INK.ice}`) }
    }
    const before = count(cryoState({ step: 'planning', inserted: [0, 0, 0], ice: 0 }))
    expect(before.ice).toBe(false)
    expect(before.sweep).toBe(false)
    const freezing = count(cryoState({ step: 'freeze1', ice: 0.7 }))
    expect(freezing.ice).toBe(true)
    expect(freezing.ellipses).toBeGreaterThan(before.ellipses)
    expect(count(cryoState({ step: 'checkCt', scan: 0.5, tablePos: 1 })).sweep).toBe(true)
    // the ice grows with `ice`
    expect(iceRadiusMm(cryoState({ ice: 0.9 }))).toBeGreaterThan(iceRadiusMm(cryoState({ ice: 0.3 })))
    expect(iceRadiusMm(cryoState({ ice: 0 }))).toBe(0)
  })

  it('console: each needle\'s temperature, the timer and the margin sensor', () => {
    const s = cryoState({ step: 'freeze1', timer: 125 })
    const { ctx, log } = loggingCtx()
    paintConsole(ctx, 400, 256, s)
    const t = texts(log)
    for (const n of s.needles) expect(t).toContain(`${Math.round(n.tempC)} °C`)
    expect(t).toContain('2:05')
    expect(t).toContain(CRYO_SUITE_COPY.panel.margin)
    expect(clockOf(0)).toBe('0:00')
    expect(clockOf(600)).toBe('10:00')
  })

  it('R5 wave 3 review: the console, the picture and the station count the lung\'s freezes 1 to 3, the others the common way', () => {
    const labelled = (target: 'kidney' | 'lung', step: 'anchorFreeze' | 'freeze1' | 'thaw' | 'freeze2') => {
      const s = cryoState({ step, timer: 20 })
      s.target = target
      const out: string[][] = []
      for (const paint of [paintConsole, paintRobotStation, (c: Ctx2D, w: number, h: number, st: CryoSuiteState) => paintLive(c, w, h, st, base)]) {
        const { ctx, log } = loggingCtx()
        paint(ctx, 418, 256, s)
        out.push(texts(log))
      }
      return out
    }
    for (const [step, label] of [['anchorFreeze', 'Freeze 1 of 3 (short)'], ['freeze1', 'Freeze 2 of 3'], ['thaw', 'Thaw 2 of 3'], ['freeze2', 'Freeze 3 of 3']] as const) {
      for (const t of labelled('lung', step)) {
        expect(t, `lung ${step}`).toContain(label)
        expect(t.join('|'), `lung ${step}`).not.toMatch(/Short first freeze|First thaw|First freeze|Passive thaw|Second freeze/)
      }
      for (const t of labelled('kidney', step)) expect(t, `kidney ${step}`).toContain(CRYO_SUITE_COPY.steps[step])
    }
  })

  it('robot station: "Aligned 1.2 mm" style lines for the needles in, the one being aimed marked', () => {
    const s = cryoState({ step: 'aim', robot: 'aligned', robotNeedle: 1, inserted: [1, 0, 0] })
    const { ctx, log } = loggingCtx()
    paintRobotStation(ctx, 418, 256, s)
    const t = texts(log)
    expect(t).toContain(`Aligned ${s.needles[0].errorMm.toFixed(1)} mm`)
    expect(t).toContain(`Aligned ${s.needles[1].errorMm.toFixed(1)} mm`)
  })
})

describe('the base slice', () => {
  it('is painted once per image seed, then only blitted', () => {
    const { env, rec } = mockEnv()
    const cache = newBaseSliceCache()
    baseSliceFor(cache, env, 11)
    const calls = rec.total()
    expect(calls).toBeGreaterThan(50)
    baseSliceFor(cache, env, 11)
    baseSliceFor(cache, env, 11)
    expect(cache.paints).toBe(1)
    expect(rec.total()).toBe(calls)
    baseSliceFor(cache, env, 12)
    expect(cache.paints).toBe(2)
  })

  it('live: magnified round the tumour, so a full-size ice ball is a good share of the picture, not a speck', () => {
    const b = imageBox(384, 384, { x: 0, y: 0, size: 0, colX: 0, colW: 0 })
    const z = zoomBox(b, LIVE_ZOOM, { x: 0, y: 0, size: 0, colX: 0, colW: 0 })
    // the tumour is at the picture's centre
    expect(z.x + z.size / 2 + (CRYO_IMAGE.tumour.x * z.size) / 2).toBeCloseTo(192, 6)
    expect(z.y + z.size / 2 + (CRYO_IMAGE.tumour.y * z.size) / 2).toBeCloseTo(192, 6)
    // a 40 mm ice ball spans at least a fifth of the picture
    const iceDiameterPx = ((40 / CRYO_IMAGE.mmPerUnit) * z.size) / 2
    expect(iceDiameterPx / b.size).toBeGreaterThan(0.2)
    // and the painter clips the magnified slice to its square
    const { ctx, log } = loggingCtx()
    paintLive(ctx, 384, 384, cryoState({ step: 'freeze2', ice: 1 }), base)
    expect(log.some((l) => l.startsWith('clip('))).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// R5 wave 3: the lung's and the liver's pictures, probed pixel by pixel on a software canvas
// ---------------------------------------------------------------------------------------------

describe('R5 wave 3: the lung\'s and the liver\'s CT pictures (face down: the back at the top)', () => {
  const N = CRYO_IMAGE.size
  const sliceOf = (target: 'kidney' | 'lung' | 'liver', seed = 4242): RasterSurface => baseSliceFor(newBaseSliceCache(), rasterEnv().env, seed, target) as RasterSurface
  /** The mean grey (0..255) round a point of the slice's -1..1 square (x right, y down). */
  const grey = (s: RasterSurface, x: number, y: number, r = 5): number => s.mean(((x + 1) / 2) * N, ((y + 1) / 2) * N, r)[0]
  const lung = sliceOf('lung')
  const liver = sliceOf('liver')

  it('names where each target\'s tumour is in its picture, the kidney\'s being the picture it always had; the lung and the liver are turned (prone)', () => {
    expect(CRYO_SLICES.kidney).toEqual({ prone: false, tumour: CRYO_IMAGE.tumour })
    expect(CRYO_SLICES.lung.prone).toBe(true)
    expect(CRYO_SLICES.liver.prone).toBe(true)
    // both prone tumours lie on the patient's right (the picture's right), a little above the middle, 80-100 mm from the spine at x = 0
    for (const t of [CRYO_SLICES.lung, CRYO_SLICES.liver]) {
      expect(t.tumour.x * CRYO_IMAGE.mmPerUnit).toBeGreaterThan(80)
      expect(t.tumour.x * CRYO_IMAGE.mmPerUnit).toBeLessThan(100)
      expect(t.tumour.y).toBeLessThan(0.1)
    }
  })

  it('the base slice is painted once per image seed AND target', () => {
    const { env } = rasterEnv()
    const cache = newBaseSliceCache()
    baseSliceFor(cache, env, 7, 'lung')
    baseSliceFor(cache, env, 7, 'lung')
    expect(cache.paints).toBe(1)
    baseSliceFor(cache, env, 7, 'liver')
    expect(cache.paints).toBe(2)
    baseSliceFor(cache, env, 7, 'liver')
    baseSliceFor(cache, env, 7)
    expect(cache.paints).toBe(3)
    baseSliceFor(cache, env, 7, 'kidney')
    expect(cache.paints).toBe(3)
  })

  it('lung: the back is at the top (the spine under the top edge, the breastbone at the bottom), the lungs dark, the heart on the patient\'s left (the picture\'s left)', () => {
    // the spine (a bone-white vertebral body) is in the upper half, the sternum in the lower
    expect(grey(lung, 0, -0.37)).toBeGreaterThan(200)
    expect(grey(lung, 0, 0.64, 3)).toBeGreaterThan(200)
    // both lungs are dark
    expect(grey(lung, 0.5, -0.02)).toBeLessThan(60)
    expect(grey(lung, -0.5, -0.02)).toBeLessThan(60)
    // the heart (soft tissue) on the picture's left, bright, and not on the right
    expect(grey(lung, -0.12, 0.1, 8)).toBeGreaterThan(150)
    expect(grey(lung, 0.62, 0.15, 8)).toBeLessThan(80)
    // the ribs: white, round the chest wall
    expect(grey(lung, 0.72, -0.35, 4) + grey(lung, -0.72, -0.35, 4)).toBeGreaterThan(150)
    // the table pad touches the front of the body at the bottom; the corners are empty
    expect(grey(lung, 0, 0.79, 3)).toBeGreaterThan(120)
    expect(grey(lung, 0.9, 0.5, 6)).toBeLessThan(10)
  })

  it('liver: the back at the top (the spine in the upper half), the liver the big organ on the picture\'s right, the tumour inside it, the lungs\' lowest edges beside the spine', () => {
    expect(grey(liver, 0, -0.3, 6)).toBeGreaterThan(200)
    // pixels of the liver's grey (portal-phase liver, 173): most of them on the right half of the picture
    let right = 0
    let left = 0
    for (let y = 0; y < N; y += 3) {
      for (let x = 0; x < N; x += 3) {
        const g = liver.at(x, y)[0]
        if (g >= 170 && g <= 176) (x > N / 2 ? right++ : left++)
      }
    }
    expect(right).toBeGreaterThan(3 * left)
    expect(right).toBeGreaterThan(4000)
    // the tumour's centre is in the liver's grey; the lung bases beside the spine are black
    expect(grey(liver, CRYO_SLICES.liver.tumour.x, CRYO_SLICES.liver.tumour.y, 4)).toBeGreaterThan(165)
    expect(grey(liver, CRYO_SLICES.liver.tumour.x, CRYO_SLICES.liver.tumour.y, 4)).toBeLessThan(180)
    expect(grey(liver, 0.45, -0.4, 4)).toBeLessThan(40)
    expect(grey(liver, -0.45, -0.4, 4)).toBeLessThan(40)
    // the ribs
    expect(grey(liver, 0.55, 0.28, 3)).toBeGreaterThan(150)
    // the pad at the bottom
    expect(grey(liver, 0, 0.7, 3)).toBeGreaterThan(80)
  })

  it('the kidney\'s picture is the one it always had: the abdomen at the kidneys, anterior at the top, no table', () => {
    const k = sliceOf('kidney')
    // the liver (portal grey 173) is on the picture's LEFT for the kidney (the patient's right), and the pad is not there
    let right = 0
    let left = 0
    for (let y = 0; y < N; y += 3) {
      for (let x = 0; x < N; x += 3) {
        const g = k.at(x, y)[0]
        if (g >= 170 && g <= 176) (x > N / 2 ? right++ : left++)
      }
    }
    expect(left).toBeGreaterThan(right)
    expect(grey(k, 0, 0.9, 4)).toBeLessThan(10)
    // the spine is at the BOTTOM half of the kidney's picture
    expect(grey(k, 0, 0.3, 6)).toBeGreaterThan(200)
  })

  const planned = (target: 'kidney' | 'lung' | 'liver', over: Partial<CryoSuiteState> = {}): CryoSuiteState => {
    const s = cryoState({ step: 'freeze1', ice: 0.8, needles: 3 })
    s.target = target
    if (target !== 'kidney') {
      // the prone plan: skin entries up and to the right of the tumour (+x right, +y down in the picture), tips at the tumour
      s.needles.forEach((n, k) => {
        const f = k / 2 - 0.5
        n.entry = { x: 40 + 12 * Math.abs(f), y: -80 + 30 * f }
        n.tip = { x: 4 * f, y: 8 * f }
      })
    }
    return Object.assign(s, over)
  }
  const paintedAs = (target: 'kidney' | 'lung' | 'liver', which: 'plan' | 'live', s = planned(target)): { base: RasterSurface; pic: RasterSurface } => {
    const { env } = rasterEnv()
    const base = baseSliceFor(newBaseSliceCache(), env, s.imageSeed, s.target) as RasterSurface
    const pic = rasterSurface(418, 256)
    if (which === 'plan') paintPlanning(pic.ctx, 418, 256, s, base)
    else paintLive(pic.ctx, 418, 256, s, base)
    return { base, pic }
  }

  it('planning: the tumour is drawn where its picture has it (a bright lump in the black lung, a dark one in the liver), the paths run up and to the right to the skin, numbered', () => {
    for (const target of ['lung', 'liver'] as const) {
      const s = planned(target)
      const { base, pic } = paintedAs(target, 'plan', s)
      const t = CRYO_SLICES[target].tumour
      const px = ((t.x + 1) / 2) * 256
      const py = ((t.y + 1) / 2) * 256
      const before = base.mean((px / 256) * N, (py / 256) * N, 4)[0]
      const after = pic.mean(px, py, 3)[0]
      if (target === 'lung') expect(after, 'lung tumour brighter than the lung').toBeGreaterThan(before + 80)
      else expect(after, 'liver tumour darker than the liver').toBeLessThan(before - 25)
      // the first path: halfway from the tip to the entry is on the teal path (not the grey of the slice)
      const n = s.needles[0]
      const mx = px + ((n.tip.x + n.entry.x) / 2 / CRYO_IMAGE.mmPerUnit) * 128
      const my = py + ((n.tip.y + n.entry.y) / 2 / CRYO_IMAGE.mmPerUnit) * 128
      let teal = 0
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const [r, g, b] = pic.at(mx + dx, my + dy)
        if (g > r + 40 && b > r + 40) teal++
      }
      expect(teal, `${target} path`).toBeGreaterThan(0)
      // the side marker names the patient's right on the turned picture
      expect(pic.texts).toContain('R')
    }
    expect(paintedAs('kidney', 'plan').pic.texts).not.toContain('R')
  })

  it('live: the picture is centred on the tumour whatever the target, the ice is a dark oval in the liver and a grey haze in the lung', () => {
    for (const target of ['lung', 'liver'] as const) {
      const none = planned(target, { ice: 0 })
      const some = planned(target, { ice: 1, iceMm: { short: 36, long: 48 } })
      const a = paintedAs(target, 'live', none)
      const b = paintedAs(target, 'live', some)
      // the view's square is magnified round the tumour, so its centre is the tumour; probed a little to the lower left of the needle tips
      const probe = (p: RasterSurface): number => p.mean(116, 140, 2)[0]
      const ice = probe(b.pic)
      if (target === 'lung') {
        // lung: black air with a lump of tissue in it (bright); the ice over it a grey haze, still brighter than the air round it
        expect(probe(a.pic)).toBeGreaterThan(150)
        expect(ice).toBeLessThan(probe(a.pic))
        expect(ice).toBeGreaterThan(90)
        expect(b.pic.mean(168, 168, 3)[0]).toBeLessThan(ice - 30)
      } else {
        expect(probe(a.pic)).toBeLessThan(150)
        expect(ice).toBeLessThan(80)
        // outside the ice (the lower left of the square) is the liver's grey
        expect(b.pic.mean(60, 190, 3)[0]).toBeGreaterThan(120)
      }
    }
  })

  it('no red anywhere in the lung\'s and the liver\'s pictures (the slices, planning and live, needles in and ice on); the kidney\'s outline still is (so the probe sees red)', () => {
    for (const target of ['lung', 'liver'] as const) {
      expect(redPixels(sliceOf(target)), `${target} slice`).toBe(0)
      for (const which of ['plan', 'live'] as const) {
        for (const over of [{ ice: 0 }, { ice: 0.7 }, { ice: 1 }] as Partial<CryoSuiteState>[]) {
          const { pic } = paintedAs(target, which, planned(target, over))
          expect(redPixels(pic), `${target} ${which} ${JSON.stringify(over)}`).toBe(0)
        }
      }
    }
    expect(redPixels(paintedAs('kidney', 'plan').pic)).toBeGreaterThan(0)
  })

  it('the kidney\'s painting uses the inks it always had (the grey tumour, the red dashed outline, the dark ice); the lung and the liver use their own', () => {
    const inks = (target: 'kidney' | 'lung' | 'liver', which: 'plan' | 'live') => {
      const { ctx, log } = loggingCtx()
      const s = planned(target)
      if (which === 'plan') paintPlanning(ctx, 418, 256, s, base)
      else paintLive(ctx, 418, 256, s, base)
      return log
    }
    const kp = inks('kidney', 'plan')
    expect(kp).toContain(`fillStyle=${INK.tumour}`)
    expect(kp).toContain(`strokeStyle=${INK.red}`)
    expect(inks('kidney', 'live')).toContain(`fillStyle=${INK.ice}`)
    for (const target of ['lung', 'liver'] as const) {
      const lp = inks(target, 'plan')
      expect(lp, target).not.toContain(`strokeStyle=${INK.red}`)
      expect(lp, target).not.toContain(`fillStyle=${INK.tumour}`)
      expect(lp.join(' '), target).not.toMatch(/#ff6b5a/i)
    }
    expect(inks('lung', 'live')).toContain(`fillStyle=${INK.iceLung}`)
    expect(inks('liver', 'live')).toContain(`fillStyle=${INK.ice}`)
  })
})
