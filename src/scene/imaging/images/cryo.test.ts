/**
 * The cryoablation on the live ultrasound screen (ProSense, the breast; docs/research/cryoablation.md): the ice ball follows
 * ScannerState.detail and swallows the tumour with a margin, the probe comes in from the side, the readout says the step, the probe
 * temperature, the timer and the ice ball, the screen stays live through every step at the usual rate, and the paint path allocates nothing.
 * Built against a local fixture exam (the protocol itself lives in content/imaging.json, owned by the sim side).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { iceSize } from '@/sim/imaging/exam'
import { emptyProcedureView } from '@/sim/procedure/empty'
import { isTierA, isTierB } from '../../surgery/endo/noBlood'
import { IMAGING_UI } from '@/content/imagingUi'
import type { ImagingExam, ScannerPhase, ScannerState, ScanSequence } from '@/sim/types'
import { mockEnv } from './mockCanvas'
import { createPainter } from './paint'
import { LiveScreen, lumpMmOf, lumpOf, renderThumbnailOn, usOnPhantom } from './screen'
import { createUsScene, usScene, US_APEX_Y } from './ultrasound'
import {
  ICE_ELONGATION,
  ICE_RADIUS_MM,
  PROBE_COLD_C,
  RELOCATE_MM,
  SALINE_MM,
  US_LINEAR_HALF,
  createCryoReadout,
  cryoReadoutInto,
  iceShapeInto,
  isCryoExam,
  needleInto,
  newIceShape,
  newNeedleLine,
  paintUltrasound,
  probeTempC,
  setLumpMm,
} from './usPaint'

const seq = (name: string, seconds: number, step?: ScanSequence['step']): ScanSequence => ({ name, plane: 'sweep', contrast: 'none', seconds, images: 3, ...(step ? { step } : {}) })

const EXAM: ImagingExam = {
  id: 'e-cryo',
  modality: 'us',
  bodyPart: 'breast',
  protocol: 'Ultrasound-guided cryoablation (fixture)',
  sequences: [seq('Probe placement', 150, 'place'), seq('Freeze 1', 420, 'freeze'), seq('Thaw', 240, 'thaw'), seq('Freeze 2', 420, 'freeze')],
  patientId: 'p1',
  patientName: 'Ada Fenwick',
  source: 'demo',
  imageSeed: 4242,
}

function stateOf(phase: ScannerPhase, sequence: number, progress: number, activity: number, detail: number): ScannerState {
  return { modality: 'us', phase, exam: EXAM, sequence, progress, remaining: 0, phaseTime: 0, tablePos: 0, activity, detail, operatorId: null, procedure: emptyProcedureView() }
}

const breast = (seed = EXAM.imageSeed) => usScene(createUsScene(), 'breast', seed, 0.5, 1)

describe('cryoablation: the ice ball and the probe', () => {
  it('the ice ball grows with detail and at full size swallows the tumour with a margin', () => {
    for (const seed of [1, 4242, 99991]) {
      const s = breast(seed)
      const ice = newIceShape()
      let last = -1
      for (let i = 0; i <= 20; i++) {
        const d = i / 20
        iceShapeInto(s, d, ice)
        expect(ice.ry).toBeCloseTo(ICE_RADIUS_MM * d * s.mm, 9)
        expect(ice.rx).toBeGreaterThan(ice.ry - 1e-12)
        expect(ice.ry).toBeGreaterThan(last)
        last = ice.ry
        expect(ice.cx).toBe(s.tx)
        expect(ice.cy).toBe(s.ty)
      }
      iceShapeInto(s, 1, ice)
      // the tumour (and 5 mm round it) inside the ball; the leading edge still below the skin
      expect(ice.ry - s.tr).toBeGreaterThan(5 * s.mm)
      expect(ice.cy - ice.ry).toBeGreaterThan(US_APEX_Y + 3 * s.mm)
      // small at the start: the tumour still shows round it
      iceShapeInto(s, 0.2, ice)
      expect(ice.ry).toBeLessThan(s.tr)
      // out of range is clamped
      expect(iceShapeInto(s, 3, ice).ry).toBeCloseTo(ICE_RADIUS_MM * s.mm, 9)
      expect(iceShapeInto(s, -1, ice).ry).toBe(0)
    }
  })

  it('the probe comes in from the side and ends in the tumour', () => {
    const s = breast()
    const n = newNeedleLine()
    needleInto(s, 0, n)
    expect(n.ex).toBeLessThan(-US_LINEAR_HALF) // enters off the picture's left edge
    expect(n.px).toBeLessThan(s.tx - s.tr)
    needleInto(s, 1, n)
    expect(Math.hypot(n.px - s.tx, n.py - s.ty)).toBeLessThan(s.tr)
    expect(n.py).toBeGreaterThan(n.ey) // going deeper
  })
})

describe('cryoablation: the readout', () => {
  it('names the step, counts the freezes, times the step and sizes the ice ball', () => {
    const r = createCryoReadout()
    cryoReadoutInto(r, EXAM, 0, 0.5, 0)
    expect(r.active).toBe(true)
    expect(r.label).toBe('PROBE PLACEMENT')
    expect(r.size).toBe('')
    expect(r.advance).toBeGreaterThan(0.3)
    expect(r.timer).toBe('01:15')
    cryoReadoutInto(r, EXAM, 1, 0.6, 0.7)
    expect(r.label).toBe('FREEZE 1')
    expect(r.tempC).toBeLessThan(-165)
    expect(r.temp).toBe(`−${-r.tempC} °C`)
    expect(r.iceD).toBe(Math.round(2 * ICE_RADIUS_MM * 0.7))
    expect(r.size).toContain(`${r.iceW} x ${r.iceD} mm`)
    expect(r.timer).toBe('04:12')
    cryoReadoutInto(r, EXAM, 2, 0.9, 0.75)
    expect(r.label).toBe('THAW')
    cryoReadoutInto(r, EXAM, 3, 1, 1)
    expect(r.label).toBe('FREEZE 2')
    expect(r.iceD).toBe(2 * ICE_RADIUS_MM)
    // a plain sweep exam: nothing to show
    const plain = { sequences: [seq('Liver sweep', 60)] }
    expect(cryoReadoutInto(createCryoReadout(), plain, 0, 0.5, 0.5).active).toBe(false)
    expect(isCryoExam(plain)).toBe(false)
    expect(isCryoExam(EXAM)).toBe(true)
  })

  it('the probe plunges to about -170 °C freezing and warms toward 0 °C thawing', () => {
    expect(probeTempC('place', 0, 0.5)).toBeGreaterThan(30)
    expect(probeTempC('freeze', 1, 0)).toBeGreaterThan(30)
    expect(probeTempC('freeze', 1, 0.4)).toBeLessThan(-165)
    expect(probeTempC('freeze', 1, 1)).toBeCloseTo(PROBE_COLD_C, 0)
    let last = -1000
    for (let i = 0; i <= 10; i++) {
      const t = probeTempC('thaw', 1, i / 10)
      expect(t).toBeGreaterThan(last)
      expect(t).toBeLessThan(0)
      last = t
    }
    expect(last).toBeGreaterThan(-12)
    // the second freeze starts from where the thaw ended
    expect(probeTempC('freeze', 2, 0)).toBeCloseTo(probeTempC('thaw', 1, 1), 6)
  })

  it('keeps its strings while the shown values stay the same', () => {
    const r = createCryoReadout()
    cryoReadoutInto(r, EXAM, 1, 0.5, 0.6)
    const { label, temp, timer, size } = r
    cryoReadoutInto(r, EXAM, 1, 0.5 + 0.1 / 420, 0.6001)
    expect(r.label).toBe(label)
    expect(r.temp).toBe(temp)
    expect(r.timer).toBe(timer)
    expect(r.size).toBe(size)
  })
})

describe('cryoablation: the screen', () => {
  it('paints the probe and the ice ball only during a cryoablation step, and keeps one depth gradient', () => {
    const { env, rec } = mockEnv()
    const painter = createPainter(env)
    const surf = env.createSurface(384, 384)
    const s = breast()
    const r = cryoReadoutInto(createCryoReadout(), EXAM, 1, 0.5, 0.8)
    rec.reset()
    paintUltrasound(surf.ctx, 384, s, painter.tiles.speckle, painter.tiles.fine, 1, 0.5, true, null)
    const plain = rec.total()
    const ellipses = rec.count('ellipse')
    rec.reset()
    for (let i = 0; i < 5; i++) paintUltrasound(surf.ctx, 384, s, painter.tiles.speckle, painter.tiles.fine, 1 + i * 0.1, 0.5, true, r)
    expect(rec.total() / 5).toBeGreaterThan(plain)
    expect(rec.count('ellipse') / 5).toBeGreaterThanOrEqual(ellipses + 5) // the shadow (2) and the leading edge (3)
    expect(rec.count('createLinearGradient')).toBe(0) // made once, on the first paint, then kept
  })

  it('a breast exam keeps the vector picture even with the imaging worker (no phantom of the breast)', async () => {
    expect(usOnPhantom(EXAM)).toBe(false)
    expect(usOnPhantom({ bodyPart: 'kidneys' })).toBe(true)
    const { InlineBackend } = await import('../worker/client')
    const { env } = mockEnv()
    const backend = new InlineBackend()
    const screen = new LiveScreen('us', env, createPainter(env), backend)
    expect(screen.update(stateOf('scanning', 1, 0.3, 1, 0.4), 10, 1000, 100)).toBe(true)
    expect(backend.stats.sent).toBe(0)
  })

  it('stays live through placement, freezing and thawing at the usual rate, then holds the last frame', () => {
    const { env, rec } = mockEnv()
    const screen = new LiveScreen('us', env, createPainter(env))
    let now = 0
    let t = 0
    let drawn = 0
    let maxCalls = 0
    // placement: the probe goes in with activity 0 (no cryogen yet): still live
    for (let i = 0; i < 20; i++) {
      now += 100
      t += 0.1
      rec.reset()
      if (screen.update(stateOf('scanning', 0, i / 20, 0, 0), t, now, 100)) {
        drawn++
        maxCalls = Math.max(maxCalls, rec.total())
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(18)
    // the thaw (activity 0), also live
    drawn = 0
    for (let i = 0; i < 10; i++) {
      now += 100
      t += 0.1
      rec.reset()
      if (screen.update(stateOf('scanning', 2, i / 10, 0, 0.8 - i * 0.01), t, now, 100)) {
        drawn++
        maxCalls = Math.max(maxCalls, rec.total())
      }
    }
    expect(drawn).toBeGreaterThanOrEqual(9)
    expect(maxCalls).toBeLessThan(300)
    // the rate limit and the sim clock still rule: a second call in the same tenth of sim time draws nothing
    expect(screen.update(stateOf('scanning', 2, 0.95, 0, 0.7), t, now + 100, 100)).toBe(false)
    // a background screen (one redraw a second) is not raised by the overlay
    const slow = new LiveScreen('us', env, createPainter(env))
    let slowDrawn = 0
    for (let i = 0; i < 50; i++) if (slow.update(stateOf('scanning', 3, i / 50, 1, 0.8 + i * 0.004), i * 0.1, i * 100, 1000)) slowDrawn++
    expect(slowDrawn).toBeLessThanOrEqual(5)
    // the procedure ends: one frozen frame, then quiet
    expect(screen.update(stateOf('cleanup', 3, 1, 0, 1), t + 1, now + 1000, 100)).toBe(true)
    expect(screen.update(stateOf('cleanup', 3, 1, 0, 1), t + 2, now + 2000, 100)).toBe(false)
  })

  it('draws a thumbnail of each finished step', () => {
    const { env, rec } = mockEnv()
    const painter = createPainter(env)
    for (let si = 0; si < EXAM.sequences.length; si++) {
      rec.reset()
      expect(renderThumbnailOn(env, painter, EXAM, si, 112)).toBeTruthy()
      expect(rec.count('ellipse')).toBeGreaterThan(15)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// No allocations in the paint path (read from the source, like src/scene/monitors/noAllocations.test.ts)
// ---------------------------------------------------------------------------------------------

/** Code with comments and string contents blanked, keeping line numbers. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The body of the function called `name` (brace matching; the parameter list is skipped by paren matching). */
function bodyOf(src: string, name: string): string {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src)
  if (!m) throw new Error(`no function ${name}`)
  let i = m.index + m[0].length
  let depth = 1
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') depth--
  }
  const open = src.indexOf('{', i)
  let braces = 0
  let end = open
  for (; end < src.length; end++) {
    if (src[end] === '{') braces++
    else if (src[end] === '}' && --braces === 0) break
  }
  return src.slice(open, end + 1)
}

const FLAGGED: [RegExp, string][] = [
  [/\bnew\s+[A-Za-z]/, 'new'],
  [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
  [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
  [/\.\.\./, 'spread'],
  [/=>/, 'closure'],
  [/\.(map|filter|reduce|slice|concat|splice|forEach|some|find)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
  [/\bof\s*\[/, 'array literal in a loop'],
]

const PATHS: Record<string, string[]> = {
  'usPaint.ts': [
    'paintUltrasound',
    'paintCryoOverlay',
    'paintCryoReadout',
    'shadowPath',
    'roLabel',
    'iceShapeInto',
    'needleInto',
    'probeTempC',
    'stepOf',
    'isCryoExam',
    // R5 wave 3: the stage layers and the stage's numbers
    'plus',
    'paintSaline',
    'paintLocal',
    'paintLumpMarks',
    'paintCalipers',
    'applyStage',
    'setLumpMm',
    'clamp01',
    // R5 fixes K12-K15: the callipers' ends, the probe-out temperature and the probe's and the ice's spots
    'calipersInto',
    'probeOutTempC',
    'placements',
    'probeSpot',
    'iceSpot',
  ],
  'ultrasound.ts': ['usScene', 'put', 'nthRandom'],
}

describe('the ultrasound paint path allocates nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(process.cwd(), 'src/scene/imaging/images', file), 'utf8'))
      const offenders: string[] = []
      for (const name of names) {
        let body: string
        try {
          body = bodyOf(src, name)
        } catch {
          // an arrow constant (stepOf): its own line
          const line = src.split('\n').find((l) => new RegExp(`const\\s+${name}\\b`).test(l)) ?? ''
          body = line.slice(line.indexOf('=>') + 2)
        }
        body.split('\n').forEach((line, i) => {
          for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`${name}+${i}: ${what}: ${line.trim()}`)
        })
      }
      expect(offenders).toEqual([])
    })
  }
})

// ---------------------------------------------------------------------------------------------
// R5 wave 3: the scripted ProSense stages (the script's `scope` keys), the two measurements and the fibroadenoma
// ---------------------------------------------------------------------------------------------

const fibroExam = (relocate: boolean): ImagingExam => ({
  ...EXAM,
  id: 'e-fibro',
  protocol: 'Ultrasound-guided cryoablation of a fibroadenoma, left breast (ProSense)',
  sequences: [
    seq('Probe placement', 120, 'place'),
    seq('Freeze 1', 264, 'freeze'),
    seq('Thaw', 264, 'thaw'),
    seq('Freeze 2', 264, 'freeze'),
    ...(relocate ? [seq('Probe moved', 90, 'place'), seq('Freeze 3', 264, 'freeze')] : []),
  ],
})

const proc = (scope: string | null, progress = 0.5) => ({ procedureId: scope === null ? null : 'us-breastCancer', scope, progress })

describe('the scripted ProSense stages', () => {
  const r = createCryoReadout()
  const at = (scope: string, si: number, detail: number, progress = 0.5, exam: ImagingExam = EXAM) => cryoReadoutInto(r, exam, si, 1, detail, proc(scope, progress))

  it('names each step of the script: the lump, the anaesthetic, the nick, the probe, the saline, the programme, the freezes, the checks, the thaw, the probe out', () => {
    const t = IMAGING_UI.us.cryo
    expect(at('survey', 0, 0).label).toBe(t.survey)
    expect(at('local', 0, 0).label).toBe(t.local)
    expect(at('nick', 0, 0).label).toBe(t.nick)
    expect(at('probeIn', 0, 0).label).toBe(t.place)
    expect(at('saline', 0, 0).label).toBe(t.saline)
    expect(at('programme', 0, 0).label).toBe(t.programme)
    expect(at('freeze1', 1, 0.5).label).toBe('FREEZE 1')
    expect(at('measure35', 1, 0.86).label).toBe(t.measure)
    expect(at('thaw', 2, 0.7).label).toBe(t.thaw)
    expect(at('freeze2', 3, 0.9).label).toBe('FREEZE 2')
    expect(at('thawFree', 3, 1).label).toBe(t.thawFree)
    expect(at('probeOut', 3, 1).label).toBe(t.probeOut)
    expect(at('dressing', 3, 1).label).toBe(t.treated)
    expect(at('standby', 3, 0).label).toBe(t.treated)
    // a scope the picture does not know leaves the exam's own step
    expect(at('somethingElse', 1, 0.5).label).toBe('FREEZE 1')
    expect(at('somethingElse', 1, 0.5).scripted).toBe(true)
    // no script: exactly the exam's (the stage fields at rest)
    cryoReadoutInto(r, EXAM, 1, 0.5, 0.5, proc(null))
    expect(r.scripted).toBe(false)
    expect(r.stage).toBe('plain')
    expect(r.probeShown).toBe(true)
  })

  it('shows the layers where the step is: the probe only once it is in, the saline layer from the saline step to the end of the thaws, the needle only for the anaesthetic', () => {
    for (const scope of ['survey', 'local', 'nick', 'dressing']) {
      at(scope, 0, 0)
      expect(r.probeShown, scope).toBe(false)
      expect(r.ice, scope).toBe(0)
    }
    expect(at('local', 0, 0, 0.8).needle).toBeGreaterThan(0.5)
    expect(at('local', 0, 0, 0).needle).toBe(0)
    expect(at('probeIn', 0, 0, 0.1).needle).toBe(0)
    expect(at('probeIn', 0, 0, 0.1).advance).toBeLessThan(at('probeIn', 0, 0, 0.9).advance)
    expect(at('probeIn', 0, 0, 1).advance).toBe(1)
    expect(at('probeIn', 0, 0, 0.5).saline).toBe(0)
    expect(at('saline', 0, 0, 0.1).saline).toBeLessThan(at('saline', 0, 0, 0.9).saline)
    for (const [scope, si] of [['programme', 0], ['freeze1', 1], ['measure35', 1], ['thaw', 2], ['freeze2', 3], ['measure40', 3], ['thawFree', 3]] as const) expect(at(scope, si, 0.5).saline, scope).toBe(1)
    // the probe is drawn back out, the ice has melted away
    expect(at('probeOut', 3, 1, 0.05).probeShown).toBe(true)
    expect(at('probeOut', 3, 1, 0.99).probeShown).toBe(false)
    expect(at('probeOut', 3, 1, 0.5).ice).toBe(0)
    // the ice is the sim's own number (R5 fix K14: the sim melts it through the thaw, the picture follows; it does not melt it a second time)
    expect(at('thawFree', 3, 1, 0).ice).toBeCloseTo(1, 6)
    expect(at('thawFree', 3, 0.4, 0.5).ice).toBeCloseTo(0.4, 6)
    expect(at('thawFree', 3, 0, 1).ice).toBe(0)
  })

  it('measures the ice ball against 35 mm after the first freeze and 40 mm after the second: the numbers the sim publishes meet the targets', () => {
    // the sim's ice ball at the end of freeze 1 (the freeze grew over the first part of its window, then the doctor measured it) and of freeze 2
    const seqs = EXAM.sequences
    const grow = [1, 0.78, 1, 0.76]
    const after1 = iceSize(seqs, 1, 1, grow)
    const after2 = iceSize(seqs, 3, 1, grow)
    const w = (d: number) => 2 * ICE_RADIUS_MM * ICE_ELONGATION * d
    expect(w(after1)).toBeGreaterThanOrEqual(CONFIG.imaging.cryo.targetsMm[0])
    expect(w(after2)).toBeGreaterThanOrEqual(CONFIG.imaging.cryo.targetsMm[1])
    // while it is being measured the size holds (the freeze has finished growing at the start of the measurement)
    const startOfMeasure = iceSize(seqs, 1, 0.78, grow)
    expect(w(startOfMeasure)).toBeGreaterThanOrEqual(CONFIG.imaging.cryo.targetsMm[0])
    expect(iceSize(seqs, 1, 0.9, grow)).toBeCloseTo(startOfMeasure, 9)
    at('measure35', 1, after1)
    expect(r.target).toBe(35)
    expect(r.iceW).toBeGreaterThanOrEqual(35)
    expect(r.note).toBe(`Ice ball ${r.iceW} mm (target 35+)`)
    at('measure40', 3, after2)
    expect(r.target).toBe(40)
    expect(r.iceW).toBeGreaterThanOrEqual(40)
    expect(r.note).toBe(`Ice ball ${r.iceW} mm (target 40+)`)
    // the first ice ball does not give 40: the second freeze is needed
    expect(w(after1)).toBeLessThan(CONFIG.imaging.cryo.targetsMm[1])
  })

  it('shows the programme the console holds, the lump the survey measured and the ice size otherwise', () => {
    expect(at('programme', 0, 0).note).toBe('7-4-7 min') // the fixture's own freeze and thaw seconds (420, 240, 420)
    setLumpMm(r, 12)
    expect(at('survey', 0, 0).note).toBe('Lump 12 mm')
    expect(at('freeze1', 1, 0.5).note).toBe(r.size)
    expect(at('freeze1', 1, 0.5).note).toContain('mm')
  })

  it('paints the saline layer, the anaesthetic needle, the lump marks and the callipers, each only in its stage', () => {
    const { env, rec } = mockEnv()
    const painter = createPainter(env)
    const surf = env.createSurface(384, 384)
    const s = breast()
    const paint = (scope: string, si: number, detail: number, progress = 0.6) => {
      cryoReadoutInto(r, EXAM, si, 1, detail, proc(scope, progress))
      rec.reset()
      paintUltrasound(surf.ctx, 384, s, painter.tiles.speckle, painter.tiles.fine, 1, 0.5, true, r)
      return { rects: rec.count('fillRect'), dashes: rec.count('setLineDash'), ellipses: rec.count('ellipse') }
    }
    const probe = paint('probeIn', 0, 0, 1)
    const saline = paint('saline', 0, 0, 1)
    expect(saline.rects).toBeGreaterThanOrEqual(probe.rects + 2) // the band and its bright lower border
    const survey = paint('survey', 0, 0)
    expect(survey.dashes).toBeGreaterThanOrEqual(2) // the planned path is dashed
    const lumpCheck = paint('lumpCheck', 1, 0.86)
    expect(lumpCheck.dashes).toBeGreaterThanOrEqual(2) // the lump's outline
    const freeze = paint('freeze1', 1, 0.86)
    expect(freeze.dashes).toBe(0)
    const measure = paint('measure35', 1, 0.86)
    expect(measure.dashes).toBeGreaterThanOrEqual(2) // the callipers' dashed line
    const local = paint('local', 0, 0, 0.9)
    expect(local.ellipses).toBeGreaterThan(freeze.ellipses - 5) // the pocket of anaesthetic round the lump
    // a quiet step paints nothing of the stage
    const dressing = paint('dressing', 3, 1, 0.5)
    expect(dressing.dashes).toBe(0)
  })

  it('moves the probe and the ice ball to a second spot for a fibroadenoma too big for one ice ball, and keeps both inside the picture', () => {
    const exam = fibroExam(true)
    expect(lumpOf(exam)).toBe('fibroadenomaLarge')
    expect(lumpOf(fibroExam(false))).toBe('fibroadenoma')
    expect(lumpOf(EXAM)).toBe('cancer')
    const before = cryoReadoutInto(createCryoReadout(), exam, 3, 1, 0.86, proc('freeze2', 0.5)).shift
    const during = cryoReadoutInto(createCryoReadout(), exam, 4, 1, 0.3, proc('relocate', 0.5)).shift
    const after = cryoReadoutInto(createCryoReadout(), exam, 5, 1, 0.5, proc('freeze3', 0.5)).shift
    expect([before, after]).toEqual([-1, 1])
    expect(during).toBeCloseTo(0, 6)
    // no second spot without a second placement
    expect(cryoReadoutInto(createCryoReadout(), fibroExam(false), 3, 1, 0.86, proc('freeze2', 0.5)).shift).toBe(0)
    const sc = usScene(createUsScene(), 'breast', exam.imageSeed, 0.5, 1, 'fibroadenomaLarge')
    const a = newNeedleLine()
    const b = newNeedleLine()
    needleInto(sc, 1, a, -RELOCATE_MM * sc.mm)
    needleInto(sc, 1, b, RELOCATE_MM * sc.mm)
    expect(b.px - a.px).toBeCloseTo(2 * RELOCATE_MM * sc.mm, 9)
    const ice = newIceShape()
    iceShapeInto(sc, 1, ice, RELOCATE_MM * sc.mm)
    expect(ice.cx).toBeCloseTo(sc.tx + RELOCATE_MM * sc.mm, 9)
  })

  it('a fibroadenoma is a smooth oval wider than it is tall; one ice ball covers it, and a large one needs the probe moved so that the two cover all of it', () => {
    for (const seed of [1, 4242, 99991]) {
      const small = usScene(createUsScene(), 'breast', seed, 0.5, 1, 'fibroadenoma')
      const ice = newIceShape()
      iceShapeInto(small, 1, ice)
      expect(small.tw).toBeGreaterThan(small.th * 1.4)
      expect(ice.rx - small.tw).toBeGreaterThan(3 * small.mm) // inside the full ice ball with a margin
      expect(ice.ry - small.th).toBeGreaterThan(3 * small.mm)
      expect(lumpMmOf(small, 'fibroadenoma')).toBeGreaterThanOrEqual(18)
      expect(lumpMmOf(small, 'fibroadenoma')).toBeLessThanOrEqual(24)
      const large = usScene(createUsScene(), 'breast', seed, 0.5, 1, 'fibroadenomaLarge')
      const shift = RELOCATE_MM * large.mm
      iceShapeInto(large, 1, ice)
      // the first ball (shifted one way) leaves one end of the lump out, the second ball (the other way) the other end: together they cover it
      expect(large.tw).toBeGreaterThan(ice.rx - shift)
      expect(large.tw).toBeLessThanOrEqual(ice.rx + shift)
      expect(lumpMmOf(large, 'fibroadenomaLarge')).toBeGreaterThanOrEqual(32)
      // the cancer keeps its small, dark, lobulated lump
      const cancer = usScene(createUsScene(), 'breast', seed, 0.5, 1)
      expect(cancer.tw).toBe(cancer.tr)
      expect(cancer.th).toBe(cancer.tr)
      expect(lumpMmOf(cancer, 'cancer')).toBeGreaterThanOrEqual(11)
      expect(lumpMmOf(cancer, 'cancer')).toBeLessThanOrEqual(13.1)
      // the saline layer lifts the skin off the ice ball: the layer ends above the ice ball's leading edge at full size
      const edge = cancer.ty - ICE_RADIUS_MM * cancer.mm
      expect(US_APEX_Y + 0.034 + SALINE_MM * cancer.mm).toBeLessThanOrEqual(edge + 1e-9)
    }
  })

  it('shows the script on the live screen from the survey on (the prep and drape phases too), at most 4 times a second, and stays quiet between cases', () => {
    const { env } = mockEnv()
    const screen = new LiveScreen('us', env, createPainter(env))
    const st = stateOf('prep', -1, 0, 0, 0)
    st.procedure.procedureId = 'us-breastCancer'
    st.procedure.scope = 'survey'
    st.procedure.progress = 0.4
    let drawn = 0
    for (let i = 0; i < 40; i++) if (screen.update(st, 10 + i * 0.05, 1000 + i * 50, 50)) drawn++ // 2 s of sim time, offered every 50 ms
    expect(drawn).toBeGreaterThanOrEqual(7)
    expect(drawn).toBeLessThanOrEqual(10)
    // the drape (positioning): still the live picture
    st.phase = 'positioning'
    st.procedure.scope = 'survey'
    expect(screen.update(st, 20, 5000, 50)).toBe(true)
    // no script (and not scanning): the patient-setup page, drawn once
    const plain = new LiveScreen('us', env, createPainter(env))
    const set = stateOf('prep', -1, 0, 0, 0)
    expect(plain.update(set, 1, 1000, 100)).toBe(true)
    expect(plain.update(set, 2, 2000, 100)).toBe(false)
  })

  it('uses no red: every colour the ultrasound painter writes is neither blood red (tier A) nor brick (tier B), and no label is graphic', () => {
    const src = readFileSync(join(process.cwd(), 'src/scene/imaging/images/usPaint.ts'), 'utf8')
    const colours = [...src.matchAll(/'#([0-9a-fA-F]{6})'/g)].map((m) => [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)])
    for (const m of src.matchAll(/'rgba?\((\d+),(\d+),(\d+)/g)) colours.push([Number(m[1]), Number(m[2]), Number(m[3])])
    expect(colours.length).toBeGreaterThan(8)
    for (const [cr, cg, cb] of colours) {
      expect(isTierA(cr, cg, cb), `${cr},${cg},${cb}`).toBe(false)
      expect(isTierB(cr, cg, cb), `${cr},${cg},${cb}`).toBe(false)
    }
    for (const [k, v] of Object.entries(IMAGING_UI.us.cryo)) expect(v, k).not.toMatch(/\b(blood|bleed\w*|wounds?|incisions?|gore)\b/i)
  })
})
