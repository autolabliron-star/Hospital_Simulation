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
