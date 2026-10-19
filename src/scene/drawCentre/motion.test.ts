import { describe, expect, it } from 'vitest'
import type { DrawPhase, DrawStationState } from '@/sim/types'
import { LAB_CATALOGUE } from '@/content/lab'
import { PREP_BIN_KIND, PREP_STOPS, TUBE_SLOTS, headZ, parkS, robotDims } from './dims'
import {
  CHASER_SEGMENTS,
  LED_HEX,
  PHASE_LIGHT,
  chaserIndex,
  chaserLevels,
  cuffTarget,
  decayFlash,
  gripTargetInto,
  headTargetS,
  headWorking,
  holdScan,
  labelGain,
  ledGain,
  needleTarget,
  newGripTarget,
  nirGain,
  nirTarget,
  slewTo,
  smooth,
  tubeFills,
  visibleTrays,
} from './motion'

const PHASES: DrawPhase[] = ['idle', 'calling', 'cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn', 'filling', 'needleOut', 'bandage', 'release', 'awaitPorter', 'armMoved', 'fallbackToNurse', 'reset']

describe('the head', () => {
  const park = parkS(robotDims(0).arm)

  it('parks beyond the wrist, towards the cabinet, and works only over the arm', () => {
    expect(park).toBeLessThan(0)
    for (const p of PHASES) {
      expect(headWorking(p), p).toBe(p === 'veinScan' || p === 'needleIn' || p === 'filling' || p === 'needleOut')
      if (!headWorking(p)) expect(headTargetS(p, 0.7, 0.7, park), p).toBe(park)
    }
  })

  it('follows scan in the vein scan and holds the last value afterwards, even if the sim resets scan', () => {
    let hold = -1
    for (const scan of [0, 0.2, 0.5, 0.9]) {
      hold = holdScan(hold, 'veinScan', scan)
      expect(headTargetS('veinScan', scan, hold, park)).toBeCloseTo(scan, 9)
    }
    hold = holdScan(hold, 'needleIn', 0)
    expect(hold).toBeCloseTo(0.9, 9)
    expect(headTargetS('needleIn', 0, hold, park)).toBeCloseTo(0.9, 9)
    hold = holdScan(hold, 'filling', 0)
    expect(hold).toBeCloseTo(0.9, 9)
    hold = holdScan(hold, 'needleOut', 0)
    expect(hold).toBeCloseTo(0.9, 9)
    // after the draw the hold is forgotten
    hold = holdScan(hold, 'bandage', 0)
    expect(hold).toBe(-1)
  })

  it('has a sensible hold if the sim never scans (a needle phase straight after the cuff)', () => {
    const hold = holdScan(-1, 'needleIn', 0)
    expect(hold).toBeGreaterThan(0.3)
    expect(hold).toBeLessThanOrEqual(1)
  })

  it('stays inside the tunnel for every s it can be asked for', () => {
    for (let i = 0; i < 3; i++) {
      const d = robotDims(i)
      for (const s of [parkS(d.arm), 0, 0.5, 1]) {
        const z = headZ(d.arm, s)
        expect(z).toBeGreaterThan(d.arm.zMouth)
        expect(z).toBeLessThan(d.arm.zFront)
      }
      // the wrist is nearer the cabinet than the crease
      expect(headZ(d.arm, 0)).toBeGreaterThan(headZ(d.arm, 1))
    }
  })

  it('slews: eases, never faster than the speed limit, holds at dt 0', () => {
    expect(slewTo(0, 1, 9, 0.5, 0)).toBe(0)
    let v = 0
    let worst = 0
    for (let i = 0; i < 600; i++) {
      const next = slewTo(v, 3, 9, 0.5, 1 / 60)
      worst = Math.max(worst, next - v)
      v = next
    }
    expect(worst).toBeLessThanOrEqual(0.5 / 60 + 1e-12)
    expect(v).toBeCloseTo(3, 3)
  })
})

describe('needle, cuff and the near-infrared light', () => {
  it('the needle only shows when it is in use, and is clamped', () => {
    for (const p of PHASES) {
      const w = needleTarget(p, 0.6)
      expect(w, p).toBe(p === 'needleIn' || p === 'filling' || p === 'needleOut' ? 0.6 : 0)
    }
    expect(needleTarget('needleIn', 4)).toBe(1)
    expect(needleTarget('needleIn', -1)).toBe(0)
  })

  it('the cuff follows the sim, clamped', () => {
    expect(cuffTarget(0.4)).toBe(0.4)
    expect(cuffTarget(2)).toBe(1)
    expect(cuffTarget(-1)).toBe(0)
  })

  it('the NIR light is on only while the robot looks for the vein, and pulses', () => {
    for (const p of PHASES) expect(nirTarget(p), p).toBe(p === 'veinScan' ? 1 : 0)
    expect(nirGain(0, 0.3)).toBe(0)
    const g = Array.from({ length: 40 }, (_, i) => nirGain(1, i / 40))
    expect(Math.max(...g)).toBeGreaterThan(Math.min(...g) + 0.3)
    expect(Math.min(...g)).toBeGreaterThan(0.6)
  })
})

describe('the scan-light chaser', () => {
  it('has 8 segments and its index is always 0..7, or -1 when it is not chasing', () => {
    expect(CHASER_SEGMENTS).toBe(8)
    for (const p of PHASES) {
      for (let t = 0; t < 30; t += 0.037) {
        const i = chaserIndex(p, t)
        if (p === 'veinScan' || p === 'sanitise') {
          expect(i, `${p} ${t}`).toBeGreaterThanOrEqual(0)
          expect(i, `${p} ${t}`).toBeLessThan(8)
        } else expect(i, `${p} ${t}`).toBe(-1)
      }
    }
  })

  it('runs round the segments in order, fast for the scan and slow for the skin clean', () => {
    const seen: number[] = []
    for (let k = 0; k < 40; k++) {
      const i = chaserIndex('veinScan', k / 12 + 0.01)
      if (seen[seen.length - 1] !== i) seen.push(i)
    }
    for (let k = 1; k < seen.length; k++) expect(seen[k]).toBe((seen[k - 1] + 1) % 8)
    const slow = new Set(Array.from({ length: 12 }, (_, k) => chaserIndex('sanitise', k * 0.1)))
    const fast = new Set(Array.from({ length: 12 }, (_, k) => chaserIndex('veinScan', k * 0.1)))
    expect(fast.size).toBeGreaterThan(slow.size)
  })

  it('lights the head brightest with a fading trail, a dim glow in the other working phases and nothing at rest', () => {
    const out = new Float32Array(8)
    chaserLevels(out, 'veinScan', 0.01)
    const head = chaserIndex('veinScan', 0.01)
    expect(out[head]).toBe(1)
    expect(out[(head + 7) % 8]).toBeCloseTo(0.55, 6)
    expect(out[(head + 6) % 8]).toBeCloseTo(0.25, 6)
    expect(Math.max(...Array.from(out))).toBe(1)
    for (const v of out) expect(v).toBeGreaterThanOrEqual(0)
    chaserLevels(out, 'idle', 1)
    expect(Array.from(out)).toEqual(new Array(8).fill(0))
    chaserLevels(out, 'cuff', 1)
    for (const v of out) expect(v).toBeCloseTo(0.22, 6)
  })
})

describe('the status colours', () => {
  const lights: DrawStationState['light'][] = ['white', 'teal', 'amber', 'green']

  it('has four different colours: white, teal, amber, green', () => {
    expect(new Set(lights.map((l) => LED_HEX[l])).size).toBe(4)
    const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const [wr, wg, wb] = rgb(LED_HEX.white)
    expect(Math.min(wr, wg, wb)).toBeGreaterThan(220)
    const [tr, tg, tb] = rgb(LED_HEX.teal)
    expect(tg).toBeGreaterThan(tr)
    expect(tb).toBeGreaterThan(tr)
    const [ar, , ab] = rgb(LED_HEX.amber)
    expect(ar).toBeGreaterThan(ab * 2)
    const [gr, gg] = rgb(LED_HEX.green)
    expect(gg).toBeGreaterThan(gr * 2)
  })

  it('is bright enough to bloom when working, and pulses when a person is needed', () => {
    expect(ledGain('teal', 'filling', 0)).toBeGreaterThan(1)
    expect(ledGain('green', 'bandage', 0)).toBeGreaterThan(1)
    expect(ledGain('white', 'idle', 0)).toBeLessThan(1)
    const pulse = Array.from({ length: 30 }, (_, i) => ledGain('amber', 'armMoved', i / 30))
    expect(Math.max(...pulse)).toBeGreaterThan(Math.min(...pulse) + 0.2)
    // a steady light does not pulse
    const steady = Array.from({ length: 30 }, (_, i) => ledGain('teal', 'veinScan', i / 30))
    expect(new Set(steady).size).toBe(1)
  })

  it('every phase is lit by one of the four colours the sim publishes (a colour for each phase and light)', () => {
    for (const p of PHASES) for (const l of lights) expect(ledGain(l, p, 1.3), `${p} ${l}`).toBeGreaterThan(0)
  })

  it('has the agreed colour for each phase: white free, teal working, amber needs a person, green done', () => {
    expect(Object.keys(PHASE_LIGHT).sort()).toEqual([...PHASES].sort())
    for (const p of PHASES) expect(lights, p).toContain(PHASE_LIGHT[p])
    for (const p of ['idle', 'calling', 'reset'] as DrawPhase[]) expect(PHASE_LIGHT[p], p).toBe('white')
    for (const p of ['cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn', 'filling', 'needleOut'] as DrawPhase[]) expect(PHASE_LIGHT[p], p).toBe('teal')
    for (const p of ['armMoved', 'fallbackToNurse'] as DrawPhase[]) expect(PHASE_LIGHT[p], p).toBe('amber')
    for (const p of ['bandage', 'release', 'awaitPorter'] as DrawPhase[]) expect(PHASE_LIGHT[p], p).toBe('green')
    // and the colour the bar shows for each phase is the palette entry of that light
    const shown = new Set(PHASES.map((p) => LED_HEX[PHASE_LIGHT[p]]))
    expect(shown.size).toBe(4)
  })
})

describe('the tube bars', () => {
  const out = new Float32Array(TUBE_SLOTS.count)
  const s = (o: Partial<DrawStationState>): Pick<DrawStationState, 'phase' | 'tubes' | 'tube' | 'tubeFill'> => ({ phase: 'filling', tubes: ['citrate', 'serum', 'EDTA', 'fluoride'], tube: 0, tubeFill: 0, ...o })

  it('fills in turn: done tubes full, the current one partly, the rest empty', () => {
    expect(tubeFills(out, s({ tube: 2, tubeFill: 0.4 }))).toBe(4)
    expect(Array.from(out).map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 1, 0.4, 0, 0])
  })

  it('shows empty slots before the filling and full tubes after it', () => {
    for (const phase of ['idle', 'calling', 'cardScan', 'armIn', 'cuff', 'sanitise', 'veinScan', 'needleIn'] as DrawPhase[]) {
      tubeFills(out, s({ phase, tube: 2, tubeFill: 0.4 }))
      expect(Array.from(out), phase).toEqual([0, 0, 0, 0, 0])
    }
    for (const phase of ['needleOut', 'bandage', 'release', 'awaitPorter'] as DrawPhase[]) {
      tubeFills(out, s({ phase, tube: 0, tubeFill: 0 }))
      expect(Array.from(out), phase).toEqual([1, 1, 1, 1, 0])
    }
  })

  it('handles no tubes, five tubes and a tube index past the end', () => {
    expect(tubeFills(out, s({ tubes: [] }))).toBe(0)
    expect(tubeFills(out, s({ tubes: ['citrate', 'serum', 'heparin', 'EDTA', 'fluoride'], tube: 4, tubeFill: 1 }))).toBe(5)
    expect(Array.from(out)).toEqual([1, 1, 1, 1, 1])
    tubeFills(out, s({ tube: 9, tubeFill: 0.5 }))
    expect(Array.from(out)).toEqual([1, 1, 1, 1, 0])
  })

  it('has a cap colour for every tube kind in the content', () => {
    for (const k of PREP_BIN_KIND) expect(LAB_CATALOGUE.tubes[k].hex).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('the prep gripper', () => {
  const g = newGripTarget()
  const inside = (): void => {
    expect(g.lx).toBeGreaterThanOrEqual(-0.27)
    expect(g.lx).toBeLessThanOrEqual(0.27)
    expect(g.lz).toBeGreaterThanOrEqual(-0.34)
    expect(g.lz).toBeLessThanOrEqual(0.37)
    expect(g.y).toBeGreaterThanOrEqual(PREP_STOPS.yPick - 1e-9)
    expect(g.y).toBeLessThanOrEqual(PREP_STOPS.yHome + 1e-9)
    expect(g.open).toBeGreaterThanOrEqual(0)
    expect(g.open).toBeLessThanOrEqual(1)
  }

  it('rests at home, open, with nothing held', () => {
    gripTargetInto(g, { phase: 'idle', bin: -1, held: null, progress: 0 })
    expect(g.lx).toBe(PREP_STOPS.home.lx)
    expect(g.lz).toBe(PREP_STOPS.home.lz)
    expect(g.y).toBe(PREP_STOPS.yHome)
    expect(g.held).toBe(false)
    expect(g.open).toBe(1)
    inside()
  })

  it('stays over the deck for every phase, bin and progress, and holds a tube only when the sim says so', () => {
    for (const phase of ['idle', 'picking', 'labelling', 'output'] as const)
      for (let bin = -1; bin < 8; bin++)
        for (const held of [null, 'serum'] as const)
          for (let k = 0; k <= 10; k++) {
            gripTargetInto(g, { phase, bin, held, progress: k / 10 })
            inside()
            expect(g.held).toBe(held !== null)
          }
  })

  it('goes over the chosen bin to pick, then to the printer, then spins the tube in the wrap station, then to the tray', () => {
    gripTargetInto(g, { phase: 'picking', bin: 6, held: null, progress: 0.9 })
    const bin6 = { lx: g.lx, lz: g.lz }
    expect(g.y).toBeCloseTo(PREP_STOPS.yPick + (PREP_STOPS.yCarry - PREP_STOPS.yPick) * (1 - smooth(0, 0.7, 0.9)), 9)
    gripTargetInto(g, { phase: 'picking', bin: 6, held: null, progress: 0.9 })
    expect(g.open).toBe(0) // closed on the tube at the end of the pick
    gripTargetInto(g, { phase: 'labelling', bin: 6, held: 'EDTA', progress: 0.2 })
    expect(g.printing).toBe(true)
    expect(g.lz).toBeCloseTo(PREP_STOPS.printer.lz, 9)
    expect(g.spin).toBe(false)
    gripTargetInto(g, { phase: 'labelling', bin: 6, held: 'EDTA', progress: 0.8 })
    expect(g.spin).toBe(true)
    expect(g.label).toBe(true)
    expect(g.lx).toBeCloseTo(PREP_STOPS.wrap.lx, 9)
    gripTargetInto(g, { phase: 'output', bin: 6, held: 'EDTA', progress: 1 })
    expect(g.lz).toBeCloseTo(PREP_STOPS.drop.lz, 9)
    expect(g.open).toBe(1) // let go on the tray
    expect(Math.hypot(bin6.lx - g.lx, bin6.lz - g.lz)).toBeGreaterThan(0.2)
  })

  it('shows at most the rack height of trays', () => {
    expect(visibleTrays([])).toBe(0)
    expect(visibleTrays(['a', 'b'])).toBe(2)
    expect(visibleTrays(['a', 'b', 'c', 'd', 'e'])).toBe(PREP_STOPS.trays)
  })

  it('the label strip glows hard while printing and faintly otherwise; flashes decay to zero', () => {
    expect(labelGain(true, 0.3)).toBeGreaterThan(0.6)
    expect(labelGain(false, 0.3)).toBeLessThan(0.4)
    let f = 1
    for (let i = 0; i < 100; i++) f = decayFlash(f, 0.1, 0.9)
    expect(f).toBe(0)
    expect(decayFlash(0, 1, 1)).toBe(0)
    expect(decayFlash(1, 0, 1)).toBe(1)
  })
})
