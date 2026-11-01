/**
 * R5: the endoscope picture follows the step (stages.ts) in node: every scope a script carries has a stage and every stage a step, in the script's order;
 * a stage that has something happen in it is one step of the script; the view takes its stage from the room's published scope (and only for the case's own
 * procedure), remembers the one before and eases the camera between them; the camera always looks inside the plate and the instruments stay in the picture;
 * each feature comes in over its stage's progress and stays (or goes where it says); a view without a stage paints today's picture; the glow darkens the
 * picture only while the stage has one; nothing draws a gradient or image data per frame; and nothing is red.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compiledFor } from '@/sim/procedure'
import type { ProcedureId, SurgeryProcedure, SurgeryState } from '@/sim/types'
import { mockEnv } from '@/scene/imaging/images/mockCanvas'
import { surgeryState } from '../testkit'
import { logCtx, rgbOf } from '../testctx'
import { PATCHES, PLATE_ASPECT, PROCEDURE_KEYS } from './anatomy'
import { newTip, tipOnScreen, TOOL_REACH, TOOL_ZOOM, windowInto } from './frame'
import { isTierA, isTierB } from './noBlood'
import { EndoPainter } from './paint'
import { bakeEndoPlatesNow, endoPlates, resetEndoPlates } from './plates'
import { resetEndoSprites } from './sprites'
import { appear, drawGlow, drawStage, glowOf, newWindow, procOfId, STAGE_COLOURS, STAGE_EASE, STAGE_SETS, stageCamInto, stageGlow, stageIndex, stageKeys, } from './stages'
import { cameraPose, fillEndoView, newCameraPose, newEndoView, REST_HALF, setProcedureLooks, type EndoView } from './view'

const W = 384
const H = 216
const A = PLATE_ASPECT
const PROCS = PROCEDURE_KEYS as readonly SurgeryProcedure[]
const idOf = (p: number): ProcedureId => `or-${PROCS[p]}` as ProcedureId

beforeAll(() => {
  bakeEndoPlatesNow(mockEnv().env)
}, 60_000)
afterAll(() => {
  resetEndoPlates()
  resetEndoSprites()
})

/** A view of `proc` at stage `key`, `progress` of the way through its step, the camera settled. */
function viewAt(proc: number, key: string | null, progress = 1, over: Partial<EndoView> = {}): EndoView {
  const v = setProcedureLooks(newEndoView({ seed: 7, t: 0, gain: 0, proc }), proc)
  v.stage = stageIndex(proc, key)
  v.stageProc = proc
  v.prevStage = v.stage
  v.stageMix = 1
  v.stageP = progress
  return Object.assign(v, over)
}

const alphasOf = (calls: readonly string[]): number[] => calls.filter((c) => c.startsWith('globalAlpha=')).map((c) => Number(c.slice('globalAlpha='.length)))

describe('the stage tables and the scripts', () => {
  it.each([0, 1, 2])('procedure %s: every scope its script carries has a stage, every stage has a step, and the stages are in the script\'s order', (p) => {
    const cs = compiledFor(idOf(p))!
    expect(cs, `a script for ${PROCS[p]}`).toBeDefined()
    const keys = stageKeys(p)
    expect(new Set(keys).size).toBe(keys.length)
    const used: number[] = []
    cs.script.steps.forEach((step, i) => {
      const key = cs.scopeAt[i]
      if (key === null) return
      const at = keys.indexOf(key)
      expect(at, `${step.id} carries scope "${key}", which ${PROCS[p]} has no stage for`).toBeGreaterThanOrEqual(0)
      if (used.length > 0) expect(at, `${step.id}: "${key}" comes before an earlier stage`).toBeGreaterThanOrEqual(used[used.length - 1])
      used.push(at)
    })
    for (let i = 0; i < keys.length; i++) expect(used, `no step has the stage "${keys[i]}"`).toContain(i)
    // the first stage is the picture at rest
    const rest = stageCamInto(p, 0, { cx: 0, cy: 0, zoom: 0 })
    expect(rest).toEqual({ cx: A / 2, cy: 0.5, zoom: 1 })
  })

  it.each([0, 1, 2])('procedure %s: a stage with something happening in it is exactly one step (a step\'s progress is the stage\'s)', (p) => {
    const cs = compiledFor(idOf(p))!
    const set = STAGE_SETS[p]
    const featured = new Set<number>()
    for (const group of [set.patches, set.blobs, set.marks, set.sutures, set.clips, set.bags]) for (const f of group) featured.add(f.at)
    expect(featured.size).toBeGreaterThan(0)
    for (const at of featured) {
      const key = set.stages[at].key
      const steps = cs.script.steps.filter((_, i) => cs.scopeAt[i] === key)
      expect(steps.map((s) => s.id), `stage "${key}"`).toHaveLength(1)
    }
  })

  it('looks a stage up by its key, and gives -1 for no key, an unknown key or a procedure that has none', () => {
    expect(stageIndex(1, 'colpotomy')).toBe(stageKeys(1).indexOf('colpotomy'))
    expect(stageIndex(0, 'colpotomy')).toBe(-1)
    expect(stageIndex(0, null)).toBe(-1)
    expect(stageIndex(0, 'nonsense')).toBe(-1)
    expect(stageIndex(7, 'survey')).toBe(-1)
    expect(procOfId('or-cholecystectomy')).toBe(0)
    expect(procOfId('or-hysterectomy')).toBe(1)
    expect(procOfId('or-prostatectomy')).toBe(2)
    expect(procOfId('cryo-kidney')).toBe(-1)
    expect(procOfId(null)).toBe(-1)
    // a stage that is not there has no place and no glow
    expect(stageCamInto(1, 99, { cx: 0, cy: 0, zoom: 0 }).zoom).toBe(1)
    expect(stageGlow(0, -1)).toBe(0)
  })

  it('has every stage\'s place inside the plate and no closer than the picture can hold (zoom 1 to 2), the glow in 0..1 and only the dye\'s stages glowing', () => {
    for (let p = 0; p < 3; p++) {
      STAGE_SETS[p].stages.forEach((s) => {
        const hh = REST_HALF / s.zoom
        expect(s.zoom, `${PROCS[p]} ${s.key}`).toBeGreaterThanOrEqual(1)
        expect(s.zoom, `${PROCS[p]} ${s.key}`).toBeLessThanOrEqual(2)
        expect(s.cx).toBeGreaterThan(0)
        expect(s.cx).toBeLessThan(A)
        expect(s.cy).toBeGreaterThan(0)
        expect(s.cy).toBeLessThan(1)
        expect(s.cy - hh, `${PROCS[p]} ${s.key} (the window may be pushed in: only by a little)`).toBeGreaterThan(-0.2)
        expect(s.glow).toBeGreaterThanOrEqual(0)
        expect(s.glow).toBeLessThanOrEqual(1)
        if (s.glow > 0) expect(['firefly', 'criticalView']).toContain(s.key)
      })
    }
    expect(STAGE_SETS[0].stages.filter((s) => s.glow > 0).map((s) => s.key)).toEqual(['firefly', 'criticalView'])
    expect(stageGlow(0, stageIndex(0, 'firefly'))).toBe(1)
    expect(stageGlow(0, stageIndex(0, 'criticalView'))).toBeLessThan(1)
  })

  it('has every feature timed inside its stage (a window of the progress), and every patch one of anatomy.ts\'s', () => {
    for (let p = 0; p < 3; p++) {
      const set = STAGE_SETS[p]
      for (const group of [set.patches, set.blobs, set.marks, set.sutures, set.clips, set.bags]) {
        for (const f of group) {
          expect(f.at).toBeGreaterThanOrEqual(0)
          expect(f.at).toBeLessThan(set.stages.length)
          expect(f.p0).toBeGreaterThanOrEqual(0)
          expect(f.p1).toBeLessThanOrEqual(1)
          expect(f.p0).toBeLessThan(f.p1)
          if (f.gone >= 0) expect(f.gone).toBeGreaterThan(f.at)
        }
      }
      for (const u of set.patches) expect(PATCHES[u.id].proc).toBe(p)
    }
    // the chole's artery and duct clips lie on the plate's structures; the pedicle clips on the prostate's sides
    expect(STAGE_SETS[0].clips).toHaveLength(6)
    expect(STAGE_SETS[2].clips).toHaveLength(6)
    expect(STAGE_SETS[0].clips.every((c) => c.kind === 0)).toBe(true)
    expect(STAGE_SETS[2].clips.every((c) => c.kind === 1)).toBe(true)
  })
})

describe('the view takes its stage from the room', () => {
  const state = (id: ProcedureId | null, scope: string | null, progress = 0.5): SurgeryState => {
    const s = surgeryState()
    s.procedure.procedureId = id
    s.procedure.scope = scope
    s.procedure.progress = progress
    return s
  }

  it('reads the published scope for the case\'s own procedure only, and the step\'s progress', () => {
    const v = newEndoView()
    // (the testkit's case table is empty: the view's procedure stays what it was, so set it as a case would)
    v.proc = 1
    fillEndoView(state('or-hysterectomy', 'colpotomy', 0.25), 100, v)
    expect(v.stage).toBe(stageIndex(1, 'colpotomy'))
    expect(v.stageP).toBeCloseTo(0.25, 9)
    // another procedure's script, no script, no scope, or a scope the procedure does not know: today's picture
    fillEndoView(state('or-prostatectomy', 'colpotomy'), 101, v)
    expect(v.stage).toBe(-1)
    fillEndoView(state(null, null), 102, v)
    expect(v.stage).toBe(-1)
    fillEndoView(state('or-hysterectomy', null), 103, v)
    expect(v.stage).toBe(-1)
    fillEndoView(state('or-hysterectomy', 'liverBed'), 104, v)
    expect(v.stage).toBe(-1)
    // progress is kept to 0..1
    fillEndoView(state('or-hysterectomy', 'colpotomy', 7), 105, v)
    expect(v.stageP).toBe(1)
  })

  it('keeps the stage before and when this one began, and eases the camera between them over STAGE_EASE seconds', () => {
    const v = newEndoView()
    v.proc = 1
    fillEndoView(state('or-hysterectomy', 'roundLigament'), 100, v)
    const first = v.stage
    fillEndoView(state('or-hysterectomy', 'roundLigament'), 100 + 3 * STAGE_EASE, v)
    expect(v.stageMix).toBe(1)
    expect(v.stage).toBe(first)
    fillEndoView(state('or-hysterectomy', 'bladderFlap'), 200, v)
    expect([v.prevStage, v.stage]).toEqual([first, stageIndex(1, 'bladderFlap')])
    expect(v.stageSince).toBe(200)
    expect(v.stageMix).toBe(0)
    fillEndoView(state('or-hysterectomy', 'bladderFlap'), 200 + STAGE_EASE / 2, v)
    expect(v.stageMix).toBeCloseTo(0.5, 9)
    fillEndoView(state('or-hysterectomy', 'bladderFlap'), 200 + STAGE_EASE, v)
    expect(v.stageMix).toBe(1)
    // the same stage again (the next step carries the same scope): no new transition
    fillEndoView(state('or-hysterectomy', 'bladderFlap'), 230, v)
    expect([v.prevStage, v.stageSince]).toEqual([first, 200])
    // a stage of another procedure is not an "earlier" one: the camera does not ease from it
    v.proc = 0
    fillEndoView(state('or-cholecystectomy', 'clipping'), 300, v)
    expect([v.prevStage, v.stage]).toEqual([-1, stageIndex(0, 'clipping')])
    expect(v.stageProc).toBe(0)
  })
})

describe('the camera of a stage', () => {
  it.each([0, 1, 2])('procedure %s: settles on each stage\'s place at that zoom, and its window is always inside the plate (the seeded pan and the breathing on top)', (p) => {
    const cam = newCameraPose()
    STAGE_SETS[p].stages.forEach((s, i) => {
      const v = viewAt(p, s.key, 1, { gain: 0 })
      // at rest (no seeded motion), the breath at its zero: the stage's place, kept inside the plate
      v.t = 1 / (2 * 0.23)
      cameraPose(v, cam)
      const hh = REST_HALF / (s.zoom * (1 + 0.012 * Math.sin(2 * Math.PI * 0.23 * v.t)))
      expect(cam.hh).toBeCloseTo(hh, 9)
      expect(cam.zs).toBeCloseTo(s.zoom, 9)
      const hw = cam.hh * A
      expect(cam.bx).toBeCloseTo(Math.min(A - hw, Math.max(hw, s.cx)), 9)
      expect(cam.by).toBeCloseTo(Math.min(1 - hh, Math.max(hh, s.cy)), 9)
      for (let t = 0; t < 400; t += 3.1) {
        for (const gain of [0, 1]) {
          v.t = t
          v.gain = gain
          v.seed = 11 + i
          cameraPose(v, cam)
          const w = cam.hh * A
          expect(cam.cx - w, `${PROCS[p]} ${s.key} t=${t}`).toBeGreaterThanOrEqual(-1e-9)
          expect(cam.cx + w).toBeLessThanOrEqual(A + 1e-9)
          expect(cam.cy - cam.hh).toBeGreaterThanOrEqual(-1e-9)
          expect(cam.cy + cam.hh).toBeLessThanOrEqual(1 + 1e-9)
        }
      }
    })
  })

  it('eases from the stage before to this one: its place at mix 0, the new place at mix 1 and between them in between, the zoom too', () => {
    const cam = newCameraPose()
    const from = stageIndex(0, 'survey')
    const to = stageIndex(0, 'calotDissection')
    const v = viewAt(0, 'calotDissection', 1, { gain: 0, t: 1 / (4 * 0.23) })
    v.prevStage = from
    const at = (mix: number): [number, number] => {
      v.stageMix = mix
      cameraPose(v, cam)
      return [cam.zs, cam.bx]
    }
    const [z0, x0] = at(0)
    const [z1, x1] = at(1)
    const [zh, xh] = at(0.5)
    expect(z0).toBe(1)
    expect(z1).toBeCloseTo(STAGE_SETS[0].stages[to].zoom, 9)
    expect(zh).toBeGreaterThan(z0)
    expect(zh).toBeLessThan(z1)
    expect(xh).toBeGreaterThan(Math.min(x0, x1))
    expect(xh).toBeLessThan(Math.max(x0, x1))
    // (and the zoom is monotone through the ease)
    let prev = 0
    for (let m = 0; m <= 1.0001; m += 0.1) {
      const z = at(Math.min(1, m))[0]
      expect(z).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = z
    }
  })

  it('a view with no stage is the picture at rest exactly as before: the middle of the plate, zoom 1, the instruments at their own size', () => {
    const cam = newCameraPose()
    const v = newEndoView({ seed: 5, t: 0, gain: 0 })
    cameraPose(v, cam)
    expect([cam.bx, cam.by, cam.zs]).toEqual([A / 2, 0.5, 1])
    // the stage's pan and most of its zoom leave the instruments where they are: a stage at zoom 2 grows them by only TOOL_ZOOM of it, and spreads them by less
    const a = newTip()
    const b = newTip()
    tipOnScreen(0, v, a)
    const staged = viewAt(0, 'clipping', 1, { seed: 5, t: 0, gain: 0 })
    tipOnScreen(0, staged, b)
    const zoom = STAGE_SETS[0].stages[stageIndex(0, 'clipping')].zoom
    expect(b.scale).toBeCloseTo(1 + (zoom - 1) * TOOL_ZOOM, 6)
    expect(a.scale).toBeCloseTo(1, 6)
    // (and they work only a little farther from the middle of the picture: the tips are brought to the work)
    expect(b.x / a.x).toBeCloseTo(1 + (zoom - 1) * TOOL_REACH, 6)
  })

  it('keeps every instrument in the picture, at every stage, over time', () => {
    const tip = newTip()
    for (let p = 0; p < 3; p++) {
      STAGE_SETS[p].stages.forEach((s) => {
        const v = viewAt(p, s.key, 0.5, { seed: 9, gain: 1 })
        for (let t = 0; t < 300; t += 7.3) {
          v.t = t
          for (let k = 0; k < 3; k++) {
            tipOnScreen(k, v, tip)
            expect(Math.abs(tip.x), `${PROCS[p]} ${s.key} arm ${k}`).toBeLessThan(A * 0.95)
            expect(Math.abs(tip.y), `${PROCS[p]} ${s.key} arm ${k}`).toBeLessThan(0.95)
          }
        }
      })
    }
  })
})

describe('when a feature shows', () => {
  const chole = (key: string, progress: number, over: Partial<EndoView> = {}): EndoView => viewAt(0, key, progress, over)

  it('is not there before its stage, comes in over its window of the stage, and stays after it', () => {
    const t = { at: 4, p0: 0.2, p1: 0.8, gone: -1 }
    const v = viewAt(0, null)
    v.stage = 3
    expect(appear(t, v)).toBe(0)
    v.stage = 4
    v.stageP = 0.1
    expect(appear(t, v)).toBe(0)
    v.stageP = 0.5
    expect(appear(t, v)).toBeCloseTo(0.5, 9)
    v.stageP = 0.9
    expect(appear(t, v)).toBe(1)
    v.stage = 7
    v.stageP = 0
    expect(appear(t, v)).toBe(1)
  })

  it('goes as its `gone` stage begins (fading as the camera moves), and is gone after it', () => {
    const t = { at: 4, p0: 0, p1: 0.5, gone: 6 }
    const v = viewAt(0, null)
    v.stage = 5
    expect(appear(t, v)).toBe(1)
    v.stage = 6
    v.stageMix = 0
    expect(appear(t, v)).toBe(1)
    v.stageMix = 0.25
    expect(appear(t, v)).toBeCloseTo(0.75, 9)
    v.stageMix = 1
    expect(appear(t, v)).toBe(0)
    v.stage = 7
    expect(appear(t, v)).toBe(0)
  })

  it('lays the cleared patch over Calot\'s triangle as the dissection goes on (by the step\'s progress), and keeps it for the steps after', () => {
    const win = newWindow()
    const drawn = (v: EndoView): { images: number; alphas: number[] } => {
      const l = logCtx()
      drawStage(l.ctx, W, H, v, windowInto(cameraPose(v, newCameraPose()), win))
      return { images: l.count('drawImage'), alphas: alphasOf(l.calls) }
    }
    expect(drawn(chole('calotDissection', 0)).images).toBe(0)
    const half = drawn(chole('calotDissection', 0.5))
    // the patch's tissue and its wet highlights, at the same fraction of their opacity
    expect(half.images).toBe(2)
    const a = half.alphas[0]
    expect(a).toBeGreaterThan(0.05)
    expect(a).toBeLessThan(0.95)
    expect(drawn(chole('calotDissection', 1)).alphas[0]).toBe(1)
    // the later stages keep it (the gallbladder's bed adds its own at liverBed)
    expect(drawn(chole('criticalView', 0)).images).toBe(2)
    expect(drawn(chole('clipping', 0.5)).images).toBe(2)
    expect(drawn(chole('liverBed', 0.2)).images).toBe(4)
    expect(drawn(chole('finalCheck', 0)).images).toBeGreaterThanOrEqual(4)
  })
})

describe('what a stage draws', () => {
  const win = newWindow()
  const draw = (v: EndoView) => {
    const l = logCtx()
    drawStage(l.ctx, W, H, v, windowInto(cameraPose(v, newCameraPose()), win))
    return l
  }

  it('draws nothing for a view without a stage, or for the picture at rest (survey), and never makes a gradient or image data', () => {
    for (let p = 0; p < 3; p++) {
      for (const v of [viewAt(p, null), viewAt(p, 'survey', 1), newEndoView({ proc: p })]) {
        const l = draw(v)
        for (const op of ['drawImage', 'fillRect', 'stroke', 'ellipse', 'fill']) expect(l.count(op), `${PROCS[p]} ${op}`).toBe(0)
        for (const op of ['createLinearGradient', 'createRadialGradient', 'createImageData', 'putImageData', 'getImageData']) expect(l.count(op), op).toBe(0)
      }
    }
  })

  it('puts the clips on one after the other as the clipping step goes on: six steel clips across the duct and the artery', () => {
    const rects = (progress: number): number => draw(viewAt(0, 'clipping', progress)).count('fillRect')
    // (four rectangles a clip: its shadow, body, light and hinge; the cleared patch is an image, not a rectangle)
    expect(rects(0)).toBe(0)
    let prev = 0
    for (let p = 0.1; p <= 1.0001; p += 0.1) {
      const n = rects(Math.min(1, p))
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
    expect(prev).toBe(6 * 4)
    // they stay for the steps after
    expect(draw(viewAt(0, 'dividing', 0)).count('fillRect')).toBe(6 * 4)
    expect(draw(viewAt(0, 'finalCheck', 0)).count('fillRect')).toBe(6 * 4)
    // steel: grey, never the prostate's violet
    const l = draw(viewAt(0, 'clipping', 1))
    expect(l.colours).toContain(STAGE_COLOURS.clip[0].body)
    expect(l.colours).not.toContain(STAGE_COLOURS.clip[1].body)
  })

  it('puts purple clips on the prostate\'s side supports, three each side, left then right, and keeps them', () => {
    const rects = (key: string, progress: number): number => draw(viewAt(2, key, progress)).count('fillRect')
    expect(rects('pedicles', 0)).toBe(0)
    // (five rectangles a polymer clip: the locking tab as well)
    expect(rects('pedicles', 1)).toBe(6 * 5)
    expect(rects('pedicles', 0.3)).toBeGreaterThan(0)
    expect(rects('pedicles', 0.3)).toBeLessThan(6 * 5)
    expect(rects('apex', 0)).toBe(6 * 5)
    expect(rects('finalCheck', 0.5)).toBe(6 * 5)
    expect(draw(viewAt(2, 'pedicles', 1)).colours).toContain(STAGE_COLOURS.clip[1].body)
  })

  it('draws the running stitches as the step goes on: the vaginal top, the stitch round the vein bundle, the two sutures of the join', () => {
    const strokes = (p: number, key: string, progress: number): number => draw(viewAt(p, key, progress)).count('stroke')
    // the stitch's line and its stitches: each is stroked (line dark, line light, stitches); the ring round the cervix from before is there already
    const ring = strokes(1, 'cuffClosure', 0)
    expect(strokes(1, 'cuffClosure', 0.05)).toBe(ring)
    expect(strokes(1, 'cuffClosure', 1)).toBe(ring + 3)
    expect(strokes(2, 'dorsalVein', 0.5)).toBeGreaterThanOrEqual(3)
    expect(strokes(2, 'anastomosis', 0.5)).toBeGreaterThanOrEqual(6)
    expect(strokes(2, 'posteriorRepair', 0.5)).toBeGreaterThanOrEqual(3)
    // each stitch is drawn once the line has reached it: more of the line, more stitches
    const moves = (progress: number): number => draw(viewAt(1, 'cuffClosure', progress)).count('moveTo')
    expect(moves(0.95)).toBeGreaterThan(moves(0.3))
    expect(draw(viewAt(1, 'cuffClosure', 1)).colours).toContain(STAGE_COLOURS.suture)
  })

  it('draws the line round the cervix as the cut goes round it, a full ring after', () => {
    const ring = (key: string, progress: number): string[] => draw(viewAt(1, key, progress)).calls.filter((c) => c.startsWith('ellipse('))
    expect(ring('colpotomy', 0.05)).toHaveLength(0)
    const half = ring('colpotomy', 0.52)
    expect(half).toHaveLength(1)
    const arc = (c: string): number => {
      const a = c.slice(8, -1).split(',').map(Number)
      return a[6] - a[5]
    }
    expect(arc(half[0])).toBeGreaterThan(Math.PI * 0.6)
    expect(arc(half[0])).toBeLessThan(Math.PI * 1.4)
    expect(arc(ring('colpotomy', 1)[0])).toBeCloseTo(2 * Math.PI, 2)
    // the uterus out, it is the edge of the vagina: the ring fades as the delivery's camera settles, and is gone
    const delivery = (mix: number): string[] => {
      const v = viewAt(1, 'delivery', 0.5, { prevStage: stageIndex(1, 'colpotomy'), stageMix: mix })
      return draw(v).calls.filter((c) => c.startsWith('ellipse('))
    }
    expect(arc(delivery(0)[0])).toBeCloseTo(2 * Math.PI, 2)
    expect(delivery(0.5)).toHaveLength(1)
    expect(delivery(1)).toHaveLength(0)
    expect(ring('cuffClosure', 0.5)).toHaveLength(0)
  })

  it('shows the bag with the specimen: the gallbladder\'s (and it stays), the prostate\'s (and it is parked as the repair begins, fading with the camera)', () => {
    const bags = (v: EndoView): number => draw(v).count('drawImage')
    const cBefore = bags(viewAt(0, 'liverBed', 1))
    expect(bags(viewAt(0, 'bagging', 1))).toBe(cBefore + 1)
    expect(bags(viewAt(0, 'finalCheck', 0))).toBeGreaterThan(cBefore)
    const pBefore = bags(viewAt(2, 'apex', 1))
    expect(bags(viewAt(2, 'bagging', 1))).toBe(pBefore + 1)
    const repair = viewAt(2, 'posteriorRepair', 0, { prevStage: stageIndex(2, 'bagging'), stageMix: 0.5 })
    const faded = alphasOf(draw(repair).calls)
    expect(faded.some((a) => a > 0.3 && a < 0.7)).toBe(true)
    // gone once the camera has settled
    expect(bags(viewAt(2, 'posteriorRepair', 0))).toBe(pBefore + 0)
  })

  it('does no work without the baked images: a stage whose patch is not baked yet leaves its tissue as it is', () => {
    const saved = endoPlates.patches.slice()
    for (let i = 0; i < endoPlates.patches.length; i++) endoPlates.patches[i] = null
    try {
      expect(draw(viewAt(0, 'calotDissection', 1)).count('drawImage')).toBe(0)
      // (the cleared patches round the ligaments, the fold and the vessels are decals, not baked pieces of plate: they still show)
      expect(draw(viewAt(1, 'cuffClosure', 1)).count('drawImage')).toBe(STAGE_SETS[1].blobs.length)
    } finally {
      saved.forEach((p, i) => (endoPlates.patches[i] = p))
    }
  })
})

describe('the near-infrared view', () => {
  const win = newWindow()
  const glow = (v: EndoView) => {
    const l = logCtx()
    drawGlow(l.ctx, W, H, v, windowInto(cameraPose(v, newCameraPose()), win))
    return l
  }

  it('darkens the whole picture and lights the dye\'s ducts while the stage glows, and does nothing for any other stage', () => {
    const l = glow(viewAt(0, 'firefly', 1))
    expect(l.calls).toContain(`fillRect(0,0,${W},${H})`)
    expect(l.calls).toContain(`fillStyle=${STAGE_COLOURS.dark}`)
    expect(l.calls).toContain('globalCompositeOperation=lighter')
    const stamps = l.count('drawImage')
    expect(stamps).toBeGreaterThan(30)
    expect(alphasOf(l.calls)[0]).toBeCloseTo(0.8, 9)
    // the overlay view (the pause that proves the structures) is half of it
    const half = glow(viewAt(0, 'criticalView', 1))
    expect(alphasOf(half.calls)[0]).toBeCloseTo(0.4, 9)
    expect(half.count('drawImage')).toBe(stamps)
    // everything else: nothing at all
    for (const key of stageKeys(0).filter((k) => k !== 'firefly' && k !== 'criticalView')) expect(glow(viewAt(0, key, 1)).calls, key).toEqual([])
    for (let p = 1; p < 3; p++) for (const key of stageKeys(p)) expect(glow(viewAt(p, key, 1)).calls, key).toEqual([])
    expect(glow(viewAt(0, null)).calls).toEqual([])
  })

  it('eases in and out with the camera: the glow is the stage\'s, eased from the stage before it', () => {
    const v = viewAt(0, 'firefly', 1)
    v.prevStage = stageIndex(0, 'survey')
    v.stageMix = 0.5
    expect(glowOf(v)).toBeCloseTo(0.5, 9)
    v.stageMix = 1
    expect(glowOf(v)).toBe(1)
    const back = viewAt(0, 'retract', 1)
    back.prevStage = stageIndex(0, 'firefly')
    back.stageMix = 0
    expect(glowOf(back)).toBe(1)
    back.stageMix = 0.75
    expect(glowOf(back)).toBeCloseTo(0.25, 9)
    back.stageMix = 1
    expect(glowOf(back)).toBe(0)
  })
})

describe('the whole picture at each stage', () => {
  const paint = (v: EndoView) => {
    const l = logCtx()
    new EndoPainter(W, H).paint(l.ctx, v)
    return l
  }

  it('is today\'s picture exactly for a view without a stage: the same calls as a view that never heard of stages', () => {
    for (let p = 0; p < 3; p++) {
      const plain = paint(setProcedureLooks(newEndoView({ seed: 7, t: 41.5, proc: p }), p))
      const none = paint(viewAt(p, null, 0.5, { seed: 7, t: 41.5, gain: 1 }))
      expect(none.calls).toEqual(plain.calls)
    }
  })

  it('paints every stage of every procedure at three moments of its step, with no gradient or image data, and the HUD still in the picture', () => {
    for (let p = 0; p < 3; p++) {
      for (const s of STAGE_SETS[p].stages) {
        for (const progress of [0.1, 0.55, 1]) {
          const l = paint(viewAt(p, s.key, progress, { seed: 3, t: 20, gain: 1 }))
          for (const made of ['createLinearGradient', 'createRadialGradient', 'createImageData', 'putImageData', 'getImageData']) expect(l.count(made), `${PROCS[p]} ${s.key} ${made}`).toBe(0)
          expect(l.texts, `${PROCS[p]} ${s.key}`).toContain('Simulated')
          expect(l.count('drawImage')).toBeGreaterThan(20)
        }
      }
    }
  })

  it('never draws a colour that is blood: no tier A or B colour, no red-saturated one, in any stage', () => {
    for (let p = 0; p < 3; p++) {
      for (const s of STAGE_SETS[p].stages) {
        const l = paint(viewAt(p, s.key, 0.8, { seed: 3, t: 20, gain: 1 }))
        for (const c of l.colours) {
          const rgb = rgbOf(c)
          if (rgb === null) continue
          expect(isTierA(rgb[0], rgb[1], rgb[2]) || isTierB(rgb[0], rgb[1], rgb[2]), `${PROCS[p]} ${s.key}: ${c}`).toBe(false)
          expect(rgb[0] > 110 && rgb[1] < rgb[0] * 0.4 && rgb[2] < rgb[0] * 0.4, `${PROCS[p]} ${s.key}: ${c}`).toBe(false)
        }
      }
    }
  })

  it('differs from stage to stage: the camera, the patches and the decals change the picture', () => {
    for (let p = 0; p < 3; p++) {
      const seen = new Set<string>()
      for (const s of STAGE_SETS[p].stages) seen.add(paint(viewAt(p, s.key, 0.6, { seed: 3, t: 20, gain: 1 })).calls.join('|'))
      expect(seen.size, PROCS[p]).toBe(STAGE_SETS[p].stages.length)
    }
  })
})
