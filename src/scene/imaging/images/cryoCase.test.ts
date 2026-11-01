/**
 * R5 wave 3 review fixes for the ProSense picture (K4, K9-K15), against the painter on its own and, last, against a whole case of the real simulation:
 *
 *   K4   the lump check's label says what the picture shows, from the case: the lump covered, or part of it outside the ice ball (the probe is moved)
 *   K9   the lump drawn is the case's own (`exam.lumpMm`), and the survey's "Lump N mm" reads it
 *   K10  after the dressing the picture is one still, quiet frame (no saline band coming back, no live redraw of an empty couch)
 *   K11  the lump's outline is drawn over the ice ball and its shadow, dashed
 *   K12  every mark (ice ball, callipers, lump, probe) is inside the linear probe's picture, for every stage, size, spot and lump
 *   K13  the cryoprobe is drawn along the lump's long axis, parallel to the chest wall, as the survey's path is
 *   K14  the thaw through "probe loosening" and the probe out reads as a thaw: temperature rising, warm colours, the ice shrinking
 *   K15  at the probe move the old ice ball melts with the sim's number and the probe slides; the thumbnails show the spot the probe is at
 *
 * Second round: the skin prep, the draping and the Time Out hold the survey's stored picture still (their steps carried the survey's live scope forward), and the
 * two regex literals of the redraw path are made once.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IMAGING_UI } from '@/content/imagingUi'
import { CONFIG } from '@/sim/config'
import { iceSize, lumpMmOfExam, type CryoExam } from '@/sim/imaging/exam'
import { emptyProcedureView } from '@/sim/procedure/empty'
import { Simulation } from '@/sim/Simulation'
import type { ImagingExam, ScannerPhase, ScannerState, ScanSequence } from '@/sim/types'
import type { Ctx2D } from './ctx'
import { mockEnv } from './mockCanvas'
import { createPainter } from './paint'
import { LiveScreen, cryoThumbnailReadout, lumpMmOf, lumpOf, renderThumbnailOn } from './screen'
import { createUsScene, usScene, type UsLump, type UsScene } from './ultrasound'
import {
  ICE_ELONGATION,
  ICE_RADIUS_MM,
  NEEDLE_ANGLE,
  PROBE_THAW_END_C,
  RELOCATE_MM,
  US_LINEAR_HALF,
  calipersInto,
  createCryoReadout,
  cryoReadoutInto,
  iceShapeInto,
  needleInto,
  newCalipers,
  newIceShape,
  newNeedleLine,
  paintCryoOverlay,
  paintCryoReadout,
  probeOutTempC,
  probeTempC,
  setLumpMm,
} from './usPaint'

const DT = CONFIG.sim.step
const seq = (name: string, seconds: number, step?: ScanSequence['step']): ScanSequence => ({ name, plane: 'sweep', contrast: 'none', seconds, images: 3, ...(step ? { step } : {}) })

const fibro = (relocate: boolean, lumpMm?: number): CryoExam => ({
  id: relocate ? 'e-fibro-moved' : 'e-fibro',
  modality: 'us',
  bodyPart: 'breast',
  protocol: 'Ultrasound-guided cryoablation of a fibroadenoma, left breast (ProSense)',
  sequences: [
    seq('Probe placement', 120, 'place'),
    seq('Freeze 1', 264, 'freeze'),
    seq('Thaw', 264, 'thaw'),
    seq('Freeze 2', 264, 'freeze'),
    ...(relocate ? [seq('Probe moved', 90, 'place'), seq('Freeze 3', 264, 'freeze')] : []),
  ],
  patientId: 'p1',
  patientName: 'Ada Fenwick',
  source: 'demo',
  imageSeed: 4242,
  ...(lumpMm !== undefined ? { lumpMm } : {}),
})

const cancer: ImagingExam = {
  id: 'e-cancer',
  modality: 'us',
  bodyPart: 'breast',
  protocol: 'Ultrasound-guided cryoablation, left breast (ProSense)',
  sequences: [seq('Probe placement', 150, 'place'), seq('Freeze 1', 420, 'freeze'), seq('Thaw', 240, 'thaw'), seq('Freeze 2', 420, 'freeze')],
  patientId: 'p2',
  patientName: 'Maud Harcourt',
  source: 'demo',
  imageSeed: 77,
}

const proc = (scope: string | null, progress = 0.5) => ({ procedureId: scope === null ? null : 'us-fibroadenoma', scope, progress })
const kindOf = (exam: ImagingExam): UsLump => lumpOf(exam)

/** A recording 2D context that keeps the order of every call and the fill colour each text was drawn with. */
function sequenceCtx(): { ctx: Ctx2D; calls: string[]; texts: { text: string; fill: string }[] } {
  const calls: string[] = []
  const texts: { text: string; fill: string }[] = []
  const store: Record<string, unknown> = {}
  const ctx = new Proxy(store, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (key === 'canvas') return { width: 384, height: 384 }
      return (...args: unknown[]) => {
        calls.push(key)
        if (key === 'fillText') texts.push({ text: String(args[0]), fill: String(target.fillStyle) })
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return { addColorStop: () => undefined }
        if (key === 'measureText') return { width: 10 }
        return undefined
      }
    },
    set(target, key: string, value) {
      target[key] = value
      return true
    },
  }) as unknown as Ctx2D
  return { ctx, calls, texts }
}

function stateOf(exam: ImagingExam, phase: ScannerPhase, sequence: number, progress: number, detail: number, scope: string | null, stageProgress = 0.5): ScannerState {
  const procedure = emptyProcedureView()
  if (scope !== null) {
    procedure.procedureId = 'us-fibroadenoma'
    procedure.scope = scope
    procedure.progress = stageProgress
  }
  return { modality: 'us', phase, exam, sequence, progress, remaining: 0, phaseTime: 0, tablePos: 0, activity: 0, detail, operatorId: null, procedure }
}

const readout = (exam: ImagingExam, si: number, detail: number, scope: string, stageProgress = 0.5, progress = 1) =>
  cryoReadoutInto(createCryoReadout(), exam, si, progress, detail, proc(scope, stageProgress))

// ---------------------------------------------------------------------------------------------
// K4, K11: the lump check
// ---------------------------------------------------------------------------------------------

describe('K4: the lump check says what the picture shows, from the case', () => {
  it('the label is "lump covered" for a lump one ice ball covers and "part of the lump outside: move probe" for one that needs the probe moved', () => {
    const t = IMAGING_UI.us.cryo
    expect(t.lumpCovered).toBe('LUMP COVERED')
    expect(t.lumpOutside).toBe('PART OF THE LUMP OUTSIDE: MOVE PROBE')
    const covered = readout(fibro(false), 1, 0.86, 'lumpCheck')
    expect(covered.inside).toBe(true)
    expect(covered.label).toBe(t.lumpCovered)
    const outside = readout(fibro(true), 1, 0.86, 'lumpCheck')
    expect(outside.inside).toBe(false)
    expect(outside.label).toBe(t.lumpOutside)
    // the words change with the case when the same readout object is reused (the screen keeps one)
    const r = createCryoReadout()
    expect(cryoReadoutInto(r, fibro(false), 1, 1, 0.86, proc('lumpCheck')).label).toBe(t.lumpCovered)
    expect(cryoReadoutInto(r, fibro(true), 1, 1, 0.86, proc('lumpCheck')).label).toBe(t.lumpOutside)
    expect(cryoReadoutInto(r, fibro(false), 1, 1, 0.86, proc('lumpCheck')).label).toBe(t.lumpCovered)
  })

  it('the label is true to the geometry for every lump the day can draw (10-38 mm): the ice ball of the first freeze covers it, or the moved probe\'s first spot leaves part of it out', () => {
    const [lo, hi] = CONFIG.imaging.cryo.fibroadenoma.lumpMm
    const ice = newIceShape()
    for (let mm = lo; mm <= hi; mm++) {
      const relocate = mm > CONFIG.imaging.cryo.fibroadenoma.relocateOverMm
      const exam = fibro(relocate, mm)
      for (const seed of [1, 4242, 99991]) {
        const s = usScene(createUsScene(), 'breast', seed, 0.5, 1, kindOf(exam), lumpMmOfExam(exam))
        const r = readout(exam, 1, CONFIG.imaging.cryo.firstFreezeSize, 'lumpCheck')
        iceShapeInto(s, CONFIG.imaging.cryo.firstFreezeSize, ice, r.iceShift * RELOCATE_MM * s.mm)
        // the lump (an oval of half-width tw and half-height th about the same level) lies inside the ice ball when both its ends do and it is no taller
        const covered = ice.cx - ice.rx <= s.tx - s.tw && s.tx + s.tw <= ice.cx + ice.rx && s.th <= ice.ry
        expect(covered, `${mm} mm seed ${seed}`).toBe(!relocate)
        expect(r.inside, `${mm} mm`).toBe(covered)
        expect(r.label, `${mm} mm`).toBe(covered ? IMAGING_UI.us.cryo.lumpCovered : IMAGING_UI.us.cryo.lumpOutside)
      }
    }
  })

  it('K11: the lump\'s dashed outline is drawn over the ice ball and its shadow (after the last fill), not under it', () => {
    const exam = fibro(true, 34)
    const s = usScene(createUsScene(), 'breast', exam.imageSeed, 0.5, 1, kindOf(exam), 34)
    const r = readout(exam, 1, 0.86, 'lumpCheck')
    const { ctx, calls } = sequenceCtx()
    paintCryoOverlay(ctx, 384, s, r)
    const lastFill = calls.lastIndexOf('fill')
    const dash = calls.indexOf('setLineDash')
    expect(lastFill, 'the shadow of the ice ball is painted').toBeGreaterThan(0)
    expect(dash, 'the outline is dashed').toBeGreaterThan(lastFill)
    // the outline's ellipse and stroke come after the dash is set, and after every ice stroke
    expect(calls.indexOf('ellipse', dash)).toBeGreaterThan(dash)
    expect(calls.lastIndexOf('stroke')).toBeGreaterThan(calls.indexOf('ellipse', dash))
    // the survey's marks (before any ice) stay under, as before
    const survey = sequenceCtx()
    paintCryoOverlay(survey.ctx, 384, s, readout(exam, 0, 0, 'survey', 0.5, 0.5))
    expect(survey.calls).toContain('setLineDash')
    expect(survey.calls.filter((c) => c === 'fill')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------
// K9: the lump the picture draws is the case's
// ---------------------------------------------------------------------------------------------

describe('K9: the picture draws the lump the case treats, and the survey reads its size', () => {
  it('the scene\'s lump is exactly the case\'s size for every size the day can draw (10-38 mm) and for the cancer (12 mm)', () => {
    for (let mm = 10; mm <= 38; mm++) {
      for (const seed of [3, 41, 977]) {
        const exam = fibro(mm > 30, mm)
        const s = usScene(createUsScene(), 'breast', seed, 0.5, 2.5, kindOf(exam), lumpMmOfExam(exam))
        expect(lumpMmOf(s, kindOf(exam)), `${mm} mm seed ${seed}`).toBeCloseTo(mm, 6)
      }
    }
    for (const seed of [3, 41, 977, 31337]) {
      const s = usScene(createUsScene(), 'breast', seed, 0.5, 2.5, 'cancer', 12)
      expect(lumpMmOf(s, 'cancer'), `cancer seed ${seed}`).toBeCloseTo(12, 6)
    }
    // (without the case's size the kind's seeded range is what it was)
    const old = usScene(createUsScene(), 'breast', 3, 0.5, 2.5, 'fibroadenomaLarge')
    expect(lumpMmOf(old, 'fibroadenomaLarge')).toBeGreaterThanOrEqual(32)
    expect(lumpMmOf(old, 'fibroadenomaLarge')).toBeLessThanOrEqual(36)
  })

  it('the live screen draws the exam\'s lump and its survey says "Lump N mm" with that N', () => {
    for (const mm of [11, 24, 34]) {
      const { env } = mockEnv()
      const screen = new LiveScreen('us', env, createPainter(env))
      const exam = fibro(mm > 30, mm)
      expect(screen.update(stateOf(exam, 'prep', -1, 0, 0, 'survey', 0.4), 10, 1000, 100)).toBe(true)
      const inner = screen as unknown as { us: UsScene; cryo: ReturnType<typeof createCryoReadout> }
      expect(lumpMmOf(inner.us, kindOf(exam))).toBeCloseTo(mm, 6)
      expect(inner.cryo.note).toBe(`Lump ${mm} mm`)
    }
    // the cancer's survey reads its 12 mm
    const { env } = mockEnv()
    const screen = new LiveScreen('us', env, createPainter(env))
    const exam: CryoExam = { ...cancer, lumpMm: 12 }
    screen.update(stateOf(exam, 'prep', -1, 0, 0, 'survey', 0.4), 10, 1000, 100)
    expect((screen as unknown as { cryo: ReturnType<typeof createCryoReadout> }).cryo.note).toBe('Lump 12 mm')
  })

  it('a thumbnail draws the exam\'s lump as well', () => {
    const { env } = mockEnv()
    const painter = createPainter(env)
    expect(renderThumbnailOn(env, painter, fibro(true, 36), 1, 112)).toBeTruthy()
    expect(setLumpMm).toBeTypeOf('function')
  })
})

// ---------------------------------------------------------------------------------------------
// K10: standby
// ---------------------------------------------------------------------------------------------

describe('K10: after the dressing the picture is one still, quiet frame', () => {
  it('the standby stage shows the treated area: no probe, no ice, no saline band', () => {
    const e = fibro(true, 34)
    for (const p of [0, 0.5, 1]) {
      const r = readout(e, 5, 0, 'standby', p)
      expect(r.stage).toBe('standby')
      expect(r.probeShown).toBe(false)
      expect(r.ice).toBe(0)
      expect(r.saline).toBe(0)
      expect(r.label).toBe(IMAGING_UI.us.cryo.treated)
      expect(r.tone).toBe('place')
    }
  })

  it('the saline band fades away through the dressing and does not come back for the cold pack, the Sign Out or the walk out', () => {
    const e = cancer
    const bands: number[] = []
    for (const [scope, steps] of [['dressing', 40], ['standby', 40], ['standby', 40], ['standby', 40]] as const) {
      for (let i = 0; i <= steps; i++) bands.push(readout(e, 3, 0, scope, i / steps).saline)
    }
    expect(bands[0]).toBe(1)
    for (let i = 1; i < bands.length; i++) expect(bands[i], `band at ${i}`).toBeLessThanOrEqual(bands[i - 1] + 1e-9)
    expect(bands.at(-1)).toBe(0)
    // three whole steps after the dressing: nothing at all
    for (const b of bands.slice(41)) expect(b).toBe(0)
  })

  it('the screen draws the standby frame once and then nothing, however long the Sign Out and the walk out last; the live stages still redraw at 4 Hz', () => {
    const { env } = mockEnv()
    const screen = new LiveScreen('us', env, createPainter(env))
    const e = cancer
    let t = 100
    let now = 5000
    const tick = (st: ScannerState): boolean => {
      t += 0.05
      now += 50
      return screen.update(st, t, now, 100)
    }
    // the dressing: live
    let drawn = 0
    for (let i = 0; i < 40; i++) if (tick(stateOf(e, 'cleanup', 3, 1, 0, 'dressing', i / 40))) drawn++
    expect(drawn).toBeGreaterThanOrEqual(7)
    expect(drawn).toBeLessThanOrEqual(10)
    // the standby steps: one frozen frame, then silence (2 minutes of the Sign Out and the walk out)
    let standbyDrawn = 0
    for (let i = 0; i < 2400; i++) if (tick(stateOf(e, 'cleanup', 3, 1, 0, 'standby', (i % 400) / 400))) standbyDrawn++
    expect(standbyDrawn).toBeGreaterThanOrEqual(1)
    expect(standbyDrawn).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------------------------
// The drape unit: the survey's stored picture
// ---------------------------------------------------------------------------------------------

describe('the skin prep, the draping and the Time Out hold the survey\'s stored picture still', () => {
  it('the hold stage is the survey\'s stored picture: its own label and the lump\'s size, the survey\'s marks, no probe, no ice, no saline, no needle, neutral', () => {
    const t = IMAGING_UI.us.cryo
    expect(t.held).toBe('SURVEY STORED')
    for (const e of [fibro(true, 34), fibro(false, 14), { ...cancer, lumpMm: 12 } as CryoExam]) {
      for (const p of [0, 0.5, 1]) {
        const h = readout(e, 0, 0, 'hold', p, 0)
        expect(h.stage).toBe('hold')
        expect(h.scripted).toBe(true)
        expect(h.probeShown).toBe(false)
        expect(h.ice).toBe(0)
        expect(h.saline).toBe(0)
        expect(h.needle).toBe(0)
        expect(h.tone).toBe('place')
        expect(h.showTemp || h.showTimer).toBe(false)
        expect(h.label).toBe(t.held)
        expect(h.label).not.toBe(t.survey)
        expect(h.label).not.toBe(t.treated)
      }
    }
    // the lump's size is read out on it, as on the survey
    const h = readout(fibro(true, 34), 0, 0, 'hold', 0.5, 0)
    setLumpMm(h, 34)
    expect(h.note).toBe('Lump 34 mm')
    const sv = readout(fibro(true, 34), 0, 0, 'survey', 0.5, 0)
    setLumpMm(sv, 34)
    expect(h.note).toBe(sv.note)
  })

  it('paints the same marks as the survey does (the planned path and the callipers on the lump), and nothing the survey does not', () => {
    for (const exam of [fibro(true, 34), fibro(false, 16), { ...cancer, lumpMm: 12 } as CryoExam]) {
      const sc = usScene(createUsScene(), 'breast', exam.imageSeed, 0.5, 1, kindOf(exam), lumpMmOfExam(exam))
      const survey = sequenceCtx()
      const hold = sequenceCtx()
      paintCryoOverlay(survey.ctx, 384, sc, readout(exam, 0, 0, 'survey', 0.5, 0))
      paintCryoOverlay(hold.ctx, 384, sc, readout(exam, 0, 0, 'hold', 0.5, 0))
      expect(hold.calls).toEqual(survey.calls)
      expect(hold.calls).toContain('setLineDash')
      expect(hold.calls.filter((c) => c === 'fill')).toHaveLength(0)
    }
  })

  it('the screen draws the survey live, the stored picture once, then nothing through the skin prep, the draping and the Time Out; the live stage after it draws again', () => {
    const { env } = mockEnv()
    const screen = new LiveScreen('us', env, createPainter(env))
    const e = fibro(true, 30)
    let t = 100
    let now = 5000
    const tick = (st: ScannerState): boolean => {
      t += 0.05
      now += 50
      return screen.update(st, t, now, 100)
    }
    // the survey: live at 4 Hz through its 40 s (800 ticks of 50 ms)
    let survey = 0
    for (let i = 0; i < 800; i++) if (tick(stateOf(e, 'prep', -1, 0, 0, 'survey', i / 800))) survey++
    expect(survey).toBeGreaterThanOrEqual(150)
    expect(survey).toBeLessThanOrEqual(210)
    // the drape unit's three steps (48 s): one stored frame, then silence
    let held = 0
    for (let i = 0; i < 960; i++) if (tick(stateOf(e, 'positioning', -1, 0, 0, 'hold', (i % 320) / 320))) held++
    expect(held, 'the stored picture is drawn once or twice, not at 4 Hz').toBeGreaterThanOrEqual(1)
    expect(held).toBeLessThanOrEqual(2)
    // the local anaesthetic is live again
    let local = 0
    for (let i = 0; i < 200; i++) if (tick(stateOf(e, 'scanning', 0, i / 200, 0, 'local', i / 200))) local++
    expect(local).toBeGreaterThanOrEqual(30)
    // (the readout the screen kept for the hold is the stored picture's)
    const inner = screen as unknown as { cryo: ReturnType<typeof createCryoReadout> }
    expect(inner.cryo.stage).toBe('local')
  })

  it('the screen\'s stored frame says "FREEZE" and reads the lump, like a frozen survey on the machine', () => {
    const { env } = mockEnv()
    const screen = new LiveScreen('us', env, createPainter(env))
    const e = fibro(true, 34)
    expect(screen.update(stateOf(e, 'positioning', -1, 0, 0, 'hold', 0.3), 10, 1000, 100)).toBe(true)
    const inner = screen as unknown as { cryo: ReturnType<typeof createCryoReadout>; frozenDrawn: boolean }
    expect(inner.frozenDrawn).toBe(true)
    expect(inner.cryo.label).toBe(IMAGING_UI.us.cryo.held)
    expect(inner.cryo.note).toBe('Lump 34 mm')
  })
})

describe('the redraw path makes its regexes once', () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '')
  const body = (src: string, name: string): string => {
    const at = src.indexOf(`function ${name}(`)
    expect(at, name).toBeGreaterThan(-1)
    const open = src.indexOf('{', src.indexOf(')', at))
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
    }
    throw new Error(name)
  }

  it('lumpOf (every redraw of the picture) and cryoKindOf (the device card) test a module-level regex, not a literal made per call', () => {
    const screen = strip(readFileSync(join(process.cwd(), 'src/scene/imaging/images/screen.ts'), 'utf8'))
    const ui = strip(readFileSync(join(process.cwd(), 'src/content/imagingUi.ts'), 'utf8'))
    expect(screen).toMatch(/^const FIBROADENOMA = \/fibroadenoma\/i$/m)
    expect(ui).toMatch(/^const FIBROADENOMA = \/fibroadenoma\/i$/m)
    for (const [file, src, fn] of [['screen.ts', screen, 'lumpOf'], ['imagingUi.ts', ui, 'cryoKindOf']] as const) {
      const b = body(src, fn)
      expect(b, `${file} ${fn}`).toContain('FIBROADENOMA.test(')
      expect(b, `${file} ${fn}: no regex literal`).not.toMatch(/\/[A-Za-z\\[(][^/\n]*\/[gimsuy]*\s*[.),;]/)
    }
  })

  it('and they still say the same: the fibroadenoma\'s protocol, in any case, and nothing else', () => {
    expect(lumpOf({ protocol: 'Ultrasound-guided cryoablation of a Fibroadenoma, left breast (ProSense)', sequences: fibro(false).sequences })).toBe('fibroadenoma')
    expect(lumpOf({ protocol: fibro(true).protocol, sequences: fibro(true).sequences })).toBe('fibroadenomaLarge')
    expect(lumpOf(cancer)).toBe('cancer')
  })
})

// ---------------------------------------------------------------------------------------------
// K12, K13: the field and the probe's angle
// ---------------------------------------------------------------------------------------------

describe('K12: every mark is inside the linear probe\'s picture', () => {
  const MARGIN = 0.004
  const inside = (x: number) => Math.abs(x) <= US_LINEAR_HALF - MARGIN

  it('the field is wider than the full ice ball and its second spot (it was 41 mm for a 41.6 mm ice ball)', () => {
    const s = usScene(createUsScene(), 'breast', 4242, 0.5, 1)
    const fieldMm = (2 * US_LINEAR_HALF) / s.mm
    const fullIceMm = 2 * ICE_RADIUS_MM * ICE_ELONGATION
    expect(fieldMm).toBeGreaterThan(fullIceMm + 2 * RELOCATE_MM + 8)
    expect(US_LINEAR_HALF).toBeLessThan(0.48) // the depth ruler stays clear at the right edge
  })

  it('both callipers\' ends of the 35 and the 40 mm measurements, the ice ball at every size and spot, the lump and the probe\'s tip are inside the picture (30 seeds, every lump size)', () => {
    const cal = newCalipers()
    const ice = newIceShape()
    const needle = newNeedleLine()
    let checked = 0
    for (let seed = 1; seed <= 30; seed++) {
      for (let mm = 10; mm <= 38; mm += 4) {
        const exam = fibro(mm > 30, mm)
        const sc = usScene(createUsScene(), 'breast', seed * 7919, 0.5, seed * 0.37, kindOf(exam), mm)
        // the lump
        expect(inside(sc.tx - sc.tw), `lump ${mm} left, seed ${seed}`).toBe(true)
        expect(inside(sc.tx + sc.tw), `lump ${mm} right, seed ${seed}`).toBe(true)
        for (const spot of exam.sequences.length > 4 ? [-1, 0, 1] : [0]) {
          for (const size of [0.3, CONFIG.imaging.cryo.firstFreezeSize, 1]) {
            iceShapeInto(sc, size, ice, spot * RELOCATE_MM * sc.mm)
            expect(inside(ice.cx - ice.rx), `ice ${size} at ${spot}, lump ${mm}, seed ${seed}`).toBe(true)
            expect(inside(ice.cx + ice.rx), `ice ${size} at ${spot}, lump ${mm}, seed ${seed}`).toBe(true)
            calipersInto(sc, size, spot, cal)
            expect(inside(cal.x0), `calliper left, ${size} at ${spot}`).toBe(true)
            expect(inside(cal.x1), `calliper right, ${size} at ${spot}`).toBe(true)
            expect(cal.x1 - cal.x0).toBeCloseTo(2 * ICE_RADIUS_MM * ICE_ELONGATION * size * sc.mm, 9)
            checked++
          }
          needleInto(sc, 1, needle, spot * RELOCATE_MM * sc.mm)
          expect(inside(needle.px), `probe tip at ${spot}`).toBe(true)
        }
      }
      const c = usScene(createUsScene(), 'breast', seed * 104729, 0.5, seed * 0.11, 'cancer', 12)
      for (const size of [CONFIG.imaging.cryo.firstFreezeSize, 1]) {
        calipersInto(c, size, 0, cal)
        expect(inside(cal.x0) && inside(cal.x1), `cancer callipers at ${size}, seed ${seed}`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('the measurements read the sim\'s ice ball: the 40 mm calliper span is the whole ball (41.6 mm), in the picture', () => {
    const c = usScene(createUsScene(), 'breast', 77, 0.5, 1, 'cancer', 12)
    const cal = calipersInto(c, 1, 0, newCalipers())
    expect((cal.x1 - cal.x0) / c.mm).toBeCloseTo(2 * ICE_RADIUS_MM * ICE_ELONGATION, 6)
    const r = readout(cancer, 3, 1, 'measure40')
    expect(r.target).toBe(40)
    expect(r.iceW).toBeGreaterThanOrEqual(40)
  })
})

describe('K13: the cryoprobe is drawn along the lump\'s long axis, parallel to the chest wall', () => {
  it('within two degrees of the horizontal, entering from the side, ending on the lump\'s level', () => {
    expect(NEEDLE_ANGLE).toBeGreaterThan(0)
    expect(NEEDLE_ANGLE).toBeLessThanOrEqual((2 * Math.PI) / 180)
    const n = newNeedleLine()
    for (const seed of [1, 4242, 99991]) {
      for (const lump of ['cancer', 'fibroadenoma'] as const) {
        const s = usScene(createUsScene(), 'breast', seed, 0.5, 1, lump)
        needleInto(s, 1, n)
        const slope = Math.atan2(n.py - n.ey, n.px - n.ex)
        expect(slope, `${lump} seed ${seed}`).toBeGreaterThan(0)
        expect(slope, `${lump} seed ${seed}`).toBeLessThanOrEqual((2 * Math.PI) / 180 + 1e-9)
        expect(n.ex, 'enters off the left edge').toBeLessThan(-US_LINEAR_HALF)
        // the tip is on the lump's level (the survey's planned path runs along it, horizontally): within a millimetre
        expect(Math.abs(n.py - s.ty) / s.mm, `${lump} seed ${seed}: tip level`).toBeLessThan(1)
        // and along the whole shaft it stays within 2 mm of that level
        needleInto(s, 0.2, n)
        expect(Math.abs(n.py - s.ty) / s.mm).toBeLessThan(2.5)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// K14: the thaw's readout
// ---------------------------------------------------------------------------------------------

describe('K14: the thaw to the probe\'s release, and the probe out, read as a thaw', () => {
  const t = IMAGING_UI.us.cryo
  it('the temperature rises from the freeze\'s -170 °C through thawFree and on through the probe out, in warm colours; the ice is the sim\'s melting number', () => {
    let last = -1000
    for (let i = 0; i <= 20; i++) {
      const r = readout(cancer, 3, 1 - i / 20, 'thawFree', i / 20)
      expect(r.label).toBe(t.thawFree)
      expect(r.tone).toBe('warm')
      expect(r.showTemp).toBe(true)
      expect(r.tempC, `thaw at ${i}/20`).toBeGreaterThanOrEqual(last)
      last = r.tempC
      expect(r.ice).toBeCloseTo(1 - i / 20, 9)
    }
    expect(readout(cancer, 3, 1, 'thawFree', 0).tempC).toBeLessThan(-165)
    expect(readout(cancer, 3, 0, 'thawFree', 1).tempC).toBeGreaterThan(-12)
    expect(readout(cancer, 3, 0, 'thawFree', 1).tempC).toBeLessThan(0)
    expect(probeTempC('thaw', 2, 1)).toBeCloseTo(PROBE_THAW_END_C, 9)
    // the probe out carries on from where the thaw ended, up to body temperature
    expect(readout(cancer, 3, 0, 'probeOut', 0).tempC).toBeCloseTo(Math.round(PROBE_THAW_END_C), 0)
    for (let i = 1; i <= 20; i++) {
      const r = readout(cancer, 3, 0, 'probeOut', i / 20)
      expect(r.tone, 'probe out').toBe('warm')
      expect(r.tempC).toBeGreaterThanOrEqual(readout(cancer, 3, 0, 'probeOut', (i - 1) / 20).tempC)
    }
    expect(readout(cancer, 3, 0, 'probeOut', 1).tempC).toBe(Math.round(probeOutTempC(1)))
    expect(probeOutTempC(1)).toBeCloseTo(34, 9)
    // (a thaw the exam names, before the second freeze, is warm too; a freeze or a measurement is cold; the placement and the cleanup are neutral)
    expect(readout(cancer, 2, 0.8, 'thaw').tone).toBe('warm')
    for (const [scope, si] of [['freeze1', 1], ['freeze2', 3], ['measure35', 1], ['measure40', 3], ['lumpCheck', 1]] as const) expect(readout(fibro(false), si, 0.8, scope).tone, scope).toBe('cold')
    for (const [scope, si] of [['dressing', 3], ['standby', 3], ['survey', 0], ['probeIn', 0], ['saline', 0], ['programme', 0]] as const) expect(readout(fibro(false), si, 0, scope).tone, scope).toBe('place')
  })

  it('the cleanup labels are not painted in the freeze\'s cold blue (the exam is still on its last freeze), the thaw and the probe out in warm', () => {
    const COLD = '#9edcff'
    const WARM = '#ffd68c'
    const s = usScene(createUsScene(), 'breast', 77, 0.5, 1, 'cancer', 12)
    const colourOf = (scope: string, label: string, stageProgress = 0.5): string => {
      const r = readout(cancer, 3, scope === 'thawFree' ? 0.5 : 0, scope, stageProgress)
      expect(r.label).toBe(label)
      const { ctx, texts } = sequenceCtx()
      paintCryoReadout(ctx, 384, s, r)
      return texts.find((x) => x.text === label)!.fill
    }
    expect(colourOf('thawFree', t.thawFree)).toBe(WARM)
    expect(colourOf('probeOut', t.probeOut)).toBe(WARM)
    expect(colourOf('dressing', t.treated)).not.toBe(COLD)
    expect(colourOf('standby', t.treated)).not.toBe(COLD)
    // the freeze itself is cold
    const { ctx, texts } = sequenceCtx()
    paintCryoReadout(ctx, 384, s, readout(cancer, 3, 0.9, 'freeze2', 0.5, 0.5))
    expect(texts.find((x) => x.text === 'FREEZE 2')!.fill).toBe(COLD)
  })

  it('the thaw before the probe is moved reads the same way, at the first spot', () => {
    const e = fibro(true, 34)
    const r = readout(e, 4, 0.5, 'thawFree', 0.1)
    expect(r.tone).toBe('warm')
    expect(r.shift).toBe(-1) // the probe does not move while it thaws
    expect(r.iceShift).toBe(-1)
    expect(r.tempC).toBeLessThan(-100)
    expect(readout(e, 4, 0, 'thawFree', 1).tempC).toBeGreaterThan(-12)
  })
})

// ---------------------------------------------------------------------------------------------
// K15: the move, and the thumbnails
// ---------------------------------------------------------------------------------------------

describe('K15: at the probe move the old ice ball melts with the sim\'s number and the probe slides', () => {
  const e = fibro(true, 34)
  it('the ice ball is the sim\'s (it is not forced to nothing in one frame) and stays at the first spot while it melts', () => {
    for (const d of [0.86, 0.5, 0.1, 0]) {
      const r = readout(e, 4, d, 'relocate', 0.2)
      expect(r.ice).toBeCloseTo(d, 9)
      expect(r.iceShift).toBe(-1)
    }
    // the first freeze's spot before, the second after
    expect(readout(e, 3, 0.86, 'freeze2').iceShift).toBe(-1)
    expect(readout(e, 5, 0.5, 'freeze3').iceShift).toBe(1)
    expect(readout(e, 5, 1, 'thawFree', 0.1).iceShift).toBe(1)
    // a plain placement exam (no script) shows the sim's ice too
    expect(cryoReadoutInto(createCryoReadout(), e, 4, 0.3, 0.4).ice).toBeCloseTo(0.4, 9)
  })

  it('the probe is drawn back, slid along and pushed in again, without a jump at either end of the step', () => {
    const before = readout(e, 4, 0, 'thawFree', 1) // the thaw before it
    const start = readout(e, 4, 0, 'relocate', 0)
    const mid = readout(e, 4, 0, 'relocate', 0.5)
    const end = readout(e, 4, 0, 'relocate', 1)
    const after = readout(e, 5, 0, 'freeze3', 0)
    expect(start.advance).toBeCloseTo(before.advance, 9)
    expect(start.shift).toBeCloseTo(before.shift, 9)
    expect(end.advance).toBeCloseTo(after.advance, 9)
    expect(end.shift).toBeCloseTo(after.shift, 9)
    expect(mid.advance).toBeLessThan(0.7)
    expect(mid.advance).toBeGreaterThan(0.4)
    expect(mid.shift).toBeCloseTo(0, 6)
    let lastA = 1
    let lastS = -1
    for (let i = 0; i <= 50; i++) {
      const r = readout(e, 4, 0, 'relocate', i / 50)
      expect(Math.abs(r.advance - lastA), `advance at ${i}`).toBeLessThan(0.1)
      expect(r.shift, `shift at ${i}`).toBeGreaterThanOrEqual(lastS - 1e-9)
      lastA = r.advance
      lastS = r.shift
    }
  })

  it('a moved probe\'s thumbnails show the spot it is at: the placement and the first cycle at the first spot, the move and the third freeze at the second', () => {
    const shifts = e.sequences.map((_, si) => cryoThumbnailReadout(e, si).shift)
    expect(shifts).toEqual([-1, -1, -1, -1, 1, 1])
    const names = e.sequences.map((q) => q.name)
    expect(names[0]).toBe('Probe placement')
    expect(names[4]).toBe('Probe moved')
    expect(cryoThumbnailReadout(e, 0).shift).not.toBe(cryoThumbnailReadout(e, 4).shift)
    // the ice each step leaves is the sim's: 0.86 after freeze 1, eased back by the thaw, gone after the move, full after freeze 3
    const ice = e.sequences.map((_, si) => cryoThumbnailReadout(e, si).ice)
    expect(ice[0]).toBe(0)
    expect(ice[1]).toBeCloseTo(CONFIG.imaging.cryo.firstFreezeSize, 6)
    expect(ice[2]).toBeCloseTo(CONFIG.imaging.cryo.firstFreezeSize * CONFIG.imaging.cryo.thawKeep, 6)
    expect(ice[4]).toBe(0)
    expect(ice[5]).toBeCloseTo(1, 6)
    expect(ice).toEqual(e.sequences.map((_, si) => iceSize(e.sequences, si, 1)))
    // one spot only for a lump one ice ball covers
    expect(fibro(false).sequences.map((_, si) => cryoThumbnailReadout(fibro(false), si).shift)).toEqual([0, 0, 0, 0])
    // and every thumbnail paints
    const { env } = mockEnv()
    const painter = createPainter(env)
    for (let si = 0; si < e.sequences.length; si++) expect(renderThumbnailOn(env, painter, e, si, 112)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------------------------
// The picture against a whole case of the real simulation (K5, K10, K14, K15 end to end)
// ---------------------------------------------------------------------------------------------

describe('a whole case in the simulation, painted at every tick', () => {
  function paintedCase(protocol: string, seed: number) {
    const sim = new Simulation(seed, { startHour: 10, inFlight: false })
    expect(sim.imaging.startDemoScan('us', protocol, { watch: true })).toBe(true)
    const sc = sim.imaging.machines.us
    const view = sc.state.procedure
    const r = createCryoReadout()
    const rows: { step: string; scope: string; ice: number; advance: number; shift: number; iceShift: number; saline: number; probe: boolean; tone: string; temp: number; label: string; stage: string; inside: boolean }[] = []
    const { env } = mockEnv()
    const screen = new LiveScreen('us', env, createPainter(env))
    let standbyFrames = 0
    let standbyTicks = 0
    let holdFrames = 0
    let holdTicks = 0
    let surveyFrames = 0
    let surveyTicks = 0
    let ran = false
    for (let i = 0, n = Math.round(1800 / DT); i < n; i++) {
      sim.step(DT)
      const st = sc.state
      if (view.procedureId !== null) ran = true
      if (view.procedureId !== null && view.scope !== null && st.exam !== null) {
        const si = Math.max(0, st.sequence)
        cryoReadoutInto(r, st.exam, si, st.phase === 'scanning' ? st.progress : 1, st.detail, view)
        rows.push({ step: view.stepId, scope: view.scope, ice: r.ice, advance: r.advance, shift: r.shift, iceShift: r.iceShift, saline: r.saline, probe: r.probeShown, tone: r.tone, temp: r.tempC, label: r.label, stage: r.stage, inside: r.inside })
        // the screen at the rate the viewer offers it (every 0.1 s of sim time)
        if (i % 6 === 0) {
          const drew = screen.update(st, sim.t, Math.round(sim.t * 1000), 100)
          if (view.scope === 'standby') {
            standbyTicks++
            if (drew) standbyFrames++
          }
          if (view.scope === 'hold') {
            holdTicks++
            if (drew) holdFrames++
          }
          if (view.scope === 'survey') {
            surveyTicks++
            if (drew) surveyFrames++
          }
        }
      }
      if (ran && view.procedureId === null && sc.session === null) break
    }
    return { rows, standbyFrames, standbyTicks, holdFrames, holdTicks, surveyFrames, surveyTicks }
  }

  it.each([
    ['us-cryo-fibroadenoma', 5],
    ['us-cryo-breast', 2],
  ] as const)('%s: no jump of the ice ball, the probe or its spot between two ticks; the thaws shrink the ice with a rising temperature in warm colours; standby is one frame', { timeout: 600_000 }, (protocol, seed) => {
    const { rows, standbyFrames, standbyTicks, holdFrames, holdTicks, surveyFrames, surveyTicks } = paintedCase(protocol, seed)
    expect(rows.length).toBeGreaterThan(30_000)
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]
      const b = rows[i]
      const where = `tick ${i} ${a.step} -> ${b.step}`
      expect(Math.abs(b.ice - a.ice), `ice, ${where}`).toBeLessThan(0.02)
      expect(Math.abs(b.shift - a.shift), `probe spot, ${where}`).toBeLessThan(0.05)
      expect(Math.abs(b.iceShift - a.iceShift) <= 0.001 || b.step === 'relocate' || a.step === 'freeze2' || a.step === 'thawMove' || a.step === 'relocate', `ice spot, ${where}`).toBe(true)
      if (a.probe && b.probe) expect(Math.abs(b.advance - a.advance), `probe depth, ${where}`).toBeLessThan(0.05)
      // the saline band never comes back once the dressing has begun to take it away
      if (a.scope === 'dressing' || a.scope === 'standby') expect(b.saline, `saline, ${where}`).toBeLessThanOrEqual(a.saline + 1e-9)
    }
    const by = (step: string) => rows.filter((x) => x.step === step)
    // the thaw to the probe's release: ice shrinking to nothing, temperature rising from the freeze's, warm
    const thaw = by('thawFree')
    expect(thaw.length).toBeGreaterThan(60)
    expect(thaw[0].temp).toBeLessThan(-150)
    expect(thaw.at(-1)!.temp).toBeGreaterThan(-15)
    expect(thaw[0].ice).toBeGreaterThan(0.95)
    expect(thaw.at(-1)!.ice).toBeLessThan(0.02)
    for (let i = 1; i < thaw.length; i++) {
      expect(thaw[i].temp).toBeGreaterThanOrEqual(thaw[i - 1].temp)
      expect(thaw[i].ice).toBeLessThanOrEqual(thaw[i - 1].ice + 1e-9)
      expect(thaw[i].tone).toBe('warm')
    }
    for (const x of by('probeOut')) {
      expect(x.tone).toBe('warm')
      expect(x.ice).toBeLessThan(0.02)
    }
    expect(by('probeOut').at(-1)!.temp).toBeGreaterThan(30)
    // the cleanup after the probe is out is never a freeze's cold
    for (const step of ['dressing', 'coldPack', 'signOut', 'walkOut']) for (const x of by(step)) expect(x.tone, step).toBe('place')
    // standby: the dressing's band does not return, the probe is away, and the screen drew its frozen frame once or twice, not at 4 Hz
    for (const step of ['coldPack', 'signOut', 'walkOut']) for (const x of by(step)) expect(x.saline, step).toBe(0)
    expect(standbyTicks).toBeGreaterThan(100)
    expect(standbyFrames).toBeLessThanOrEqual(2)
    // the survey is live (4 Hz); the skin prep, the draping and the Time Out that follow it are the survey's stored picture: one frame, then silence
    expect(surveyTicks).toBeGreaterThan(300)
    expect(surveyFrames).toBeGreaterThan(Math.round(0.3 * surveyTicks))
    expect(holdTicks).toBeGreaterThan(300)
    expect(holdFrames).toBeLessThanOrEqual(2)
    for (const step of ['prepSkin', 'drape', 'timeOut']) {
      for (const x of by(step)) {
        expect(x.scope, step).toBe('hold')
        expect(x.stage, step).toBe('hold')
        expect(x.probe, step).toBe(false)
        expect(x.ice, step).toBe(0)
        expect(x.saline, step).toBe(0)
        expect(x.label, step).toBe(IMAGING_UI.us.cryo.held)
      }
    }
    if (protocol === 'us-cryo-fibroadenoma') {
      // the move: the old ice melts through the thaw before it, the probe slides in the move, and the lump check said part of the lump is outside
      const check = by('lumpCheck')
      expect(check.length).toBeGreaterThan(30)
      expect(check[0].inside).toBe(false)
      expect(check[0].label).toBe(IMAGING_UI.us.cryo.lumpOutside)
      const move = by('relocate')
      expect(move[0].shift).toBeLessThan(-0.95)
      expect(move.at(-1)!.shift).toBeGreaterThan(0.95)
      expect(by('thawMove')[0].ice).toBeGreaterThan(0.8)
      expect(by('thawMove').at(-1)!.ice).toBeLessThan(0.02)
      expect(by('freeze3').at(-1)!.ice).toBeGreaterThan(0.98)
      expect(by('freeze3')[0].iceShift).toBe(1)
    }
  })
})
