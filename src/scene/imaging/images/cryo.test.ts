/**
 * The cryoablation on the live ultrasound screen (ProSense, the breast; docs/research/cryoablation.md): the ice ball follows
 * ScannerState.detail and swallows the tumour with a margin, the probe comes in from the side, the readout says the step, the probe
 * temperature, the timer and the ice ball, the screen stays live through every step at the usual rate, and the paint path allocates nothing.
 * Built against a local fixture exam (the protocol itself lives in content/imaging.json, owned by the sim side).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ImagingExam, ScannerPhase, ScannerState, ScanSequence } from '@/sim/types'
import { mockEnv } from './mockCanvas'
import { createPainter } from './paint'
import { LiveScreen, renderThumbnailOn, usOnPhantom } from './screen'
import { createUsScene, usScene, US_APEX_Y } from './ultrasound'
import {
  ICE_RADIUS_MM,
  PROBE_COLD_C,
  createCryoReadout,
  cryoReadoutInto,
  iceShapeInto,
  isCryoExam,
  needleInto,
  newIceShape,
  newNeedleLine,
  paintUltrasound,
  probeTempC,
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
  return { modality: 'us', phase, exam: EXAM, sequence, progress, remaining: 0, phaseTime: 0, tablePos: 0, activity, detail, operatorId: null }
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
    expect(n.ex).toBeLessThan(-0.36) // enters off the picture's left edge
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
  'usPaint.ts': ['paintUltrasound', 'paintCryoOverlay', 'paintCryoReadout', 'shadowPath', 'roLabel', 'iceShapeInto', 'needleInto', 'probeTempC', 'stepOf', 'isCryoExam'],
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
