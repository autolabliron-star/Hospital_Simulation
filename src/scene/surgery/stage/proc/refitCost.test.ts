/**
 * R5 wave 3 (agent J): what the procedure stage costs a frame while the patient moves, on the real crowd (a patient on the CT table, skinned from the model's own pose rows), at the
 * sim speeds 1x, 10x and 30x and paused (P1, P2, P3, P12 c). The stage's work is a job over frames: the whole refit used to be one frame (skin, the fit of the whole field, the build
 * and four full uploads: 2.7 to 3.9 ms on an M4, 6 ms at worst; on a Quest about 9 to 12 of its 13.8 ms) and ran every frame at 30x.
 *
 *   - the stage runs on REAL time: the same turn gives the same refits whatever the sim's speed, paused or not (the sim's speed only decides how soon the script asks for the prep);
 *   - nothing is skinned or fitted while the stage has nothing to show, and the first fit is the only one until the pose moves;
 *   - no frame spends more than FIT_BUDGET units of the fit, and the whole turn is a few dozen refits, one in progress at a time, then ONE at rest (not one per frame through the settle);
 *   - the cost of a frame, measured here, is printed (`--silent=false`) and bounded loosely: the units, not the milliseconds, are the exact pin.
 *
 * Measured on an M4 (this file's own numbers; the same turn through the old code, one frame doing skin + fit + build + four full uploads, was 2.7 to 3.9 ms a refit frame, 6.4 ms
 * at worst, 39 refits at 1x and 184 at 30x, 142 of them in a row). The pins come in two kinds, so that a 2x regression fails and a loaded machine does not:
 *   - what does not depend on the clock (`PINS`): the refits begun, the fit's work UNITS in a refit, the frames of work a refit takes, the longest run of them, the builds and the biggest
 *     stage a build lays out (vertices, triangles): the same in every run on every machine, bounded at the measured numbers with a quarter to spare. (They used to be 5 to 45 refits and a
 *     run of 24 frames against the 7 to 17 measured, and the wall-time bounds below were 1.2 ms at the median and 2.2 at p95 against 0.34 and 0.40.)
 *   - the milliseconds (`PIN_MS`, `PINS.heavy*`): the best of five runs of each number, at about twice the measured; the build is pinned per thousand triangles of the stage.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadPeopleFromDisk, cpuMesh } from '@/scene/actors/crowd/avatars.testkit'
import { buildBodyGeometries } from '@/scene/actors/crowd/geometry'
import { CrowdModel, type FrameInput } from '@/scene/actors/crowd/model'
import { setActiveCrowd } from '@/scene/actors/crowd/runtime'
import { measureLieFit } from '@/scene/actors/crowd/tablePatient'
import { skinSourceOfBody, skinSourceOfProcedural } from '@/scene/actors/crowd/skinSource'
import { levelView } from '@/scene/levels/levelView'
import { CRYO_SUITE } from '@/sim/places'
import type { Entity, PatientPoseView } from '@/sim/types'
import { FIT_BUDGET, FIT_EPS, REST_SPEED, createProcRuntime, keyDelta, poseKeyInto, stageDt, stepProcRuntime, type NeedleEntry, type ProcRuntime } from './runtime'
import { FIT_UNITS_PER_MS } from './field'

const CRYO = CRYO_SUITE.ct.table
const REST: PatientPoseView = { position: 'supine', headTiltDeg: 0, rollDeg: 0, arms: 'out', airway: 'none', awareness: 'asleep', prep: 0, drape: 0, marks: 'none', catheter: false, manipulator: false }
const NEEDLES: NeedleEntry[] = [
  { entry: { x: 40, y: -80 }, dz: -10 },
  { entry: { x: 55, y: -70 }, dz: 25 },
]

function ent(o: Partial<Entity> & { id: string }): Entity {
  return { role: 'patient', outfit: 'gown', name: o.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'lie', emote: 'none', mood: 'neutral', tier: 'near', variant: 3, ...o } as Entity
}
function frame(entities: Map<string, Entity>, t: number): FrameInput {
  return { dt: 1 / 60, time: t, camX: CRYO.out.x - 150, camY: 6.2, camZ: CRYO.out.z + 2, entities, followId: null, selectedId: null, hoverId: null, driven: null }
}
const now = (): number => Number(process.hrtime.bigint()) / 1e6
const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  return s.length === 0 ? 0 : s[s.length >> 1]
}

/**
 * The script's turn (liver: step `turnProne`, then the skin prep over 6 sim seconds, the drape over the next 10, the needles' marks after) as the patient view at sim time `t`: the
 * view is what the sim publishes, so how fast it is reached is the sim's speed: `speed` sim seconds a real second.
 */
function viewAt(view: PatientPoseView, simT: number): void {
  view.position = 'prone'
  view.arms = 'aboveHead'
  const ramp = (a: number, b: number): number => (simT <= a ? 0 : simT >= b ? 1 : (simT - a) / (b - a))
  view.prep = ramp(4, 10)
  view.drape = ramp(10, 20)
  view.marks = simT >= 20 ? 'needles' : simT >= 4 ? 'marked' : 'none'
}

interface Run {
  heavy: number[]
  all: number[]
  fits: number
  begun: number
  skinnings: number
  builds: number
  maxSlice: number
  byKind: Record<string, number[]>
  maxConsecutiveHeavy: number
  firstWanted: number
  jobsBeforeWanted: number
  skinsAtRest: number
  /** The fit's work units over the whole turn (the sum of every slice: it does not depend on the clock), and the biggest stage a build laid out (vertices, triangles). */
  units: number
  maxVerts: number
  maxTris: number
  rt: ProcRuntime
}

const quantile = (a: readonly number[], q: number): number => {
  if (a.length === 0) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}
interface KindStats {
  median: number
  p95: number
  worst: number
}
interface Stats {
  heavyMedian: number
  heavyP95: number
  heavyWorst: number
  kinds: Record<'slice' | 'build' | 'skin', KindStats>
}
const KIND_NAMES = ['slice', 'build', 'skin'] as const
/** The wall-time numbers of a run. */
function statsOf(r: Run): Stats {
  const kinds = {} as Stats['kinds']
  for (const k of KIND_NAMES) {
    const v = r.byKind[k] ?? []
    kinds[k] = { median: median(v), p95: quantile(v, 0.95), worst: Math.max(0, ...v) }
  }
  return { heavyMedian: median(r.heavy), heavyP95: quantile(r.heavy, 0.95), heavyWorst: Math.max(0, ...r.heavy), kinds }
}
/** Keep, of each wall-time number, the smaller of the two runs' (the quietest the machine was). */
function keepBest(into: Stats, other: Stats): void {
  into.heavyMedian = Math.min(into.heavyMedian, other.heavyMedian)
  into.heavyP95 = Math.min(into.heavyP95, other.heavyP95)
  into.heavyWorst = Math.min(into.heavyWorst, other.heavyWorst)
  for (const k of KIND_NAMES) {
    into.kinds[k].median = Math.min(into.kinds[k].median, other.kinds[k].median)
    into.kinds[k].p95 = Math.min(into.kinds[k].p95, other.kinds[k].p95)
    into.kinds[k].worst = Math.min(into.kinds[k].worst, other.kinds[k].worst)
  }
}

/**
 * What the turn costs that does not depend on the clock, per sim speed (1x, 10x, 30x, paused): the measured counts (every run, every machine) with a quarter to spare. The refits
 * begun (low, high), the fit's work units in a refit, the frames of work in a refit, the longest run of frames of work, the builds, the biggest stage (vertices, triangles).
 */
const PINS: Record<number, { begun: [number, number]; unitsPerRefit: number; framesPerRefit: number; consecutive: number; builds: number; verts: number; tris: number; heavyMedian: number; heavyP95: number; buildPerKtri: number }> = {
  // measured: 5 refits, 352 888 units a refit, 10.0 frames of work a refit, a run of 7, 20 builds, a stage of 791 vertices and 1 240 triangles
  1: { begun: [4, 6], unitsPerRefit: 470_000, framesPerRefit: 12.5, consecutive: 9, builds: 25, verts: 990, tris: 1550, heavyMedian: 0.27, heavyP95: 0.7, buildPerKtri: 0.115 },
  // measured: 26 refits, 369 241 units, 7.4 frames, a run of 17, 30 builds, 2 414 vertices and 4 190 triangles
  10: { begun: [21, 32], unitsPerRefit: 470_000, framesPerRefit: 9.5, consecutive: 21, builds: 38, verts: 3020, tris: 5240, heavyMedian: 0.6, heavyP95: 0.7, buildPerKtri: 0.133 },
  // measured: 28 refits, 371 299 units, 7.4 frames, a run of 17, 30 builds, 2 376 vertices and 4 164 triangles
  30: { begun: [22, 35], unitsPerRefit: 470_000, framesPerRefit: 9.5, consecutive: 21, builds: 38, verts: 3000, tris: 5200, heavyMedian: 0.6, heavyP95: 0.7, buildPerKtri: 0.133 },
  // measured: 29 refits, 372 458 units, 7.3 frames, a run of 8, 29 builds, 496 vertices and 846 triangles (the sheet is not drawn yet: the drape has not begun)
  0: { begun: [23, 36], unitsPerRefit: 470_000, framesPerRefit: 9.5, consecutive: 10, builds: 36, verts: 620, tris: 1060, heavyMedian: 0.6, heavyP95: 0.7, buildPerKtri: 0.155 },
}
/**
 * The wall-time bounds (ms) on the best of five runs, about 1.8 times what an M4 measures (a slice of the fit 0.34 median 0.40 p95, a skinning 0.04, the worst frame 0.43) so that a
 * slice or a skin twice as slow fails and a busy laptop does not; and, in `PINS`, the build per thousand triangles of the stage (0.064, 0.074, 0.074 and 0.086 ms measured at the four
 * speeds, 0.31 ms for a stage of 4 200 triangles): the build is the other heavy job.
 */
const PIN_MS = { slice: 0.6, skin: 0.075, worst: 0.8 }

describe('the refit cost of the procedure stage', () => {
  let people: Awaited<ReturnType<typeof loadPeopleFromDisk>>
  let warmed = false
  const shownBefore = { shown: levelView.shown, overview: levelView.overview }
  beforeAll(async () => {
    people = await loadPeopleFromDisk()
  })
  afterEach(() => {
    setActiveCrowd(null)
    levelView.shown = shownBefore.shown
    levelView.overview = shownBefore.overview
  })

  /**
   * The script's turn on the CT table, `seconds` of real time at `speed`x (0: paused: the sim's view stays where the pause left it, the real clock runs on). The stage's view is
   * what the sim publishes at that sim time (`viewAt`); the body rolls on real time.
   */
  function turn(speed: number, seconds = 12): Run {
    levelView.shown = 2
    levelView.overview = false
    const m = new CrowdModel()
    m.proceduralSkin = skinSourceOfProcedural(buildBodyGeometries().high)
    m.setAvatars(
      people.avatars.map((a) => a.entry),
      [],
      [],
      [],
      people.avatars.map((a) => {
        const c = cpuMesh(a.lods[0])
        return measureLieFit(c.pos, c.joints, c.weights, c.count, a.entry.bindInverse)
      }),
      people.avatars.map((a) => skinSourceOfBody(a.lods[0])),
    )
    setActiveCrowd(m)
    // the entity's own pose is what the body follows: it turns at once (the sim's step has begun); the stage's view is what the sim has reached by now
    const entityView: PatientPoseView = { ...REST }
    const view: PatientPoseView = { ...REST }
    const e = ent({ id: 'pat', seated: { seatId: 'scanTable:cryo', pose: 'lie' }, position: { x: CRYO.out.x, y: 0, z: CRYO.out.z }, heading: CRYO.heading, patientPose: entityView })
    const es = new Map([['pat', e]])
    for (let i = 0; i < 300; i++) m.update(frame(es, i / 60))
    const rt = createProcRuntime('cryo')
    for (let i = 0; i < 30; i++) stepProcRuntime(rt, view, NEEDLES, stageDt(1 / 60), 'liver')
    entityView.position = 'prone'
    entityView.arms = 'aboveHead'
    const f0 = rt.mem.field.fits
    const b0 = rt.mem.fitsBegun
    const s0 = rt.skinnings
    const bl0 = rt.mem.builds
    const heavy: number[] = []
    const all: number[] = []
    const byKind: Record<string, number[]> = {}
    let consecutive = 0
    let maxConsecutive = 0
    let maxSlice = 0
    let firstWanted = -1
    let jobsBeforeWanted = 0
    let skinsAtRest = 0
    let units = 0
    let maxVerts = 0
    let maxTris = 0
    const frames = Math.round(seconds * 60)
    let simT = 0
    for (let i = 0; i < frames; i++) {
      m.update(frame(es, 5 + i / 60))
      // (paused: the view is where the pause left it, the body goes on rolling toward its pose)
      if (speed > 0) simT += speed / 60
      else simT = 4.5
      viewAt(view, simT)
      const fb = rt.mem.field.fits
      const sb = rt.skinnings
      const bb = rt.mem.builds
      const wb = rt.mem.field.work
      const t0 = now()
      stepProcRuntime(rt, view, NEEDLES, stageDt(1 / 60), 'liver')
      const ms = now() - t0
      all.push(ms)
      if (rt.mem.wants && firstWanted < 0) firstWanted = i
      const kind = rt.mem.builds !== bb ? 'build' : rt.skinnings !== sb ? 'skin' : rt.mem.field.work !== wb || rt.mem.field.fits !== fb ? 'slice' : 'idle'
      if (kind !== 'idle') {
        ;(byKind[kind] ??= []).push(ms)
        heavy.push(ms)
        consecutive++
        if (consecutive > maxConsecutive) maxConsecutive = consecutive
        if (!rt.mem.wants) jobsBeforeWanted++
      } else consecutive = 0
      if (kind === 'slice') {
        units += rt.mem.field.slice
        if (rt.mem.field.slice > maxSlice) maxSlice = rt.mem.field.slice
      }
      if (kind === 'build') {
        if (rt.mem.mesh.nv > maxVerts) maxVerts = rt.mem.mesh.nv
        if (rt.mem.mesh.ni / 3 > maxTris) maxTris = rt.mem.mesh.ni / 3
      }
      if (rt.skinnings !== sb && rt.speed < REST_SPEED) skinsAtRest++
    }
    return { heavy, all, fits: rt.mem.field.fits - f0, begun: rt.mem.fitsBegun - b0, skinnings: rt.skinnings - s0, builds: rt.mem.builds - bl0, maxSlice, byKind, maxConsecutiveHeavy: maxConsecutive, firstWanted, jobsBeforeWanted, skinsAtRest, units, maxVerts, maxTris, rt }
  }

  const runs = new Map<number, Run>()
  /** Runs of a turn the wall-time numbers are the best of (the counts and the work units are the same in each; a loaded machine only adds to the milliseconds). */
  const BEST_OF = 5
  for (const speed of [1, 10, 30, 0]) {
    const label = speed === 0 ? 'a paused sim' : `${speed}x`
    it(`the turn at ${label}: a refit is a few frames of at most FIT_BUDGET units, one job at a time; once more at rest; its work, its builds and the cost of a frame are pinned`, () => {
      if (!warmed) {
        turn(30, 6)
        warmed = true
      }
      // (the turn BEST_OF times: the same counts and units each time, and the best of each wall-time number kept)
      let r = turn(speed)
      const best: Stats = statsOf(r)
      for (let k = 1; k < BEST_OF; k++) {
        const again = turn(speed)
        expect(again.begun, 'the same turn gives the same refits').toBe(r.begun)
        expect(again.builds).toBe(r.builds)
        expect(again.units, 'the same turn does the same work').toBe(r.units)
        expect(again.maxConsecutiveHeavy).toBe(r.maxConsecutiveHeavy)
        expect(again.maxTris).toBe(r.maxTris)
        keepBest(best, statsOf(again))
        if (median(again.heavy) < median(r.heavy)) r = again
      }
      runs.set(speed, r)
      const heavyFrames = r.heavy.length
      console.log(
        `REFIT ${label}: fits ${r.fits} (begun ${r.begun}), skinnings ${r.skinnings}, builds ${r.builds}, wanted from frame ${r.firstWanted}, jobs before it ${r.jobsBeforeWanted}, ` +
          `heavy frames ${heavyFrames} (${(heavyFrames / r.begun).toFixed(2)} a refit), units ${r.units} (${Math.round(r.units / r.begun)} a refit), stage ${r.maxVerts} vertices ${r.maxTris} triangles, ` +
          `best of ${BEST_OF}: heavy-frame median ${best.heavyMedian.toFixed(3)} p95 ${best.heavyP95.toFixed(3)} worst ${best.heavyWorst.toFixed(3)} ms, all-frame median ${median(r.all).toFixed(4)} ms, ` +
          `longest run of heavy frames ${r.maxConsecutiveHeavy}, biggest slice ${r.maxSlice} units (budget ${FIT_BUDGET} = ${(FIT_BUDGET / FIT_UNITS_PER_MS).toFixed(2)} ms); ` +
          Object.entries(best.kinds)
            .map(([k, v]) => `${k} x${r.byKind[k].length} median ${v.median.toFixed(3)} p95 ${v.p95.toFixed(3)} worst ${v.worst.toFixed(3)}`)
            .join(', '),
      )
      // the work is time-sliced: no slice is more than the budget and one triangle's worth over it
      expect(r.maxSlice).toBeGreaterThan(FIT_BUDGET * 0.5)
      expect(r.maxSlice).toBeLessThanOrEqual(FIT_BUDGET * 1.1)
      // ---- what does not depend on the clock: the counts and the work units of the turn (the same in every run, on every machine). The bounds are the measured numbers with a quarter to spare:
      // a regression of 2x in any of them (twice the refits, twice the work in a fit, twice the builds, a stage twice the size) fails
      const pin = PINS[speed]
      // a few dozen refits, not one a frame (it was 184 at 30x, 142 of them in a row, and 39 at 1x)
      expect(r.begun).toBeGreaterThanOrEqual(pin.begun[0])
      expect(r.begun).toBeLessThanOrEqual(pin.begun[1])
      expect(r.fits).toBeGreaterThanOrEqual(r.begun - 1)
      expect(r.skinnings, 'one skinning a refit').toBeLessThanOrEqual(r.begun + 1)
      // the fit's own work: the units a refit takes (the raster and the two blurs of the body's field: a slower algorithm shows here whatever the machine does)
      expect(r.units / r.begun, 'work units in a refit').toBeLessThanOrEqual(pin.unitsPerRefit)
      expect(r.units / r.begun, 'work units in a refit').toBeGreaterThanOrEqual(pin.unitsPerRefit * 0.6)
      // the frames of work a refit takes: its slices, its build and its skin
      expect(heavyFrames / r.begun, 'heavy frames in a refit').toBeLessThanOrEqual(pin.framesPerRefit)
      // (a job at a time: the longest run of frames with work is a fit's slices, its build, the next skin, two or three refits' worth one right after another while the body is moving
      // fastest, not the whole turn. It was loosened from 14 to 24; it is 7 to 17)
      expect(r.maxConsecutiveHeavy).toBeLessThanOrEqual(pin.consecutive)
      // the builds: a few dozen (the sheet's geometry is laid out again when the drape has moved by a step, and when the fit comes in), and the biggest stage a build lays out
      expect(r.builds, 'builds in the turn').toBeLessThanOrEqual(pin.builds)
      expect(r.maxVerts, 'vertices of the biggest stage').toBeLessThanOrEqual(pin.verts)
      expect(r.maxTris, 'triangles of the biggest stage').toBeLessThanOrEqual(pin.tris)
      expect(r.maxTris, 'the stage has a plate and a sheet').toBeGreaterThan(pin.tris * 0.5)
      // one more skin at rest, not one per frame through the settle tail
      expect(r.skinsAtRest).toBeLessThanOrEqual(1)
      // at rest the last skin is the resting pose's and nothing is left running
      const slot = r.rt.slot!
      poseKeyInto(slot, r.rt.key)
      expect(keyDelta(r.rt.key, r.rt.keyFit)).toBeLessThanOrEqual(FIT_EPS + 1e-9)
      expect(r.rt.mem.field.busy).toBe(false)
      // ---- the wall-clock cost of a frame, the best of BEST_OF runs of each number (a loaded machine inflates a run, hardly ever all five): the bounds are about twice what the M4 measures
      // (printed above), so a slice or a build that has become twice as slow fails and a busy laptop does not. The old one-frame refit was 2.7 ms at the median, 3.9 to 6.4 at the worst.
      expect(best.heavyMedian, 'heavy-frame median (ms)').toBeLessThan(pin.heavyMedian)
      expect(best.heavyP95, 'heavy-frame p95 (ms)').toBeLessThan(pin.heavyP95)
      expect(best.kinds.slice.median, 'a slice of the fit, median (ms)').toBeLessThan(PIN_MS.slice)
      expect(best.kinds.slice.p95, 'a slice of the fit, p95 (ms)').toBeLessThan(PIN_MS.slice * 1.2)
      expect(best.kinds.build.median / (r.maxTris / 1000), 'a build per thousand triangles of the stage, median (ms)').toBeLessThan(pin.buildPerKtri)
      expect(best.kinds.build.p95 / (r.maxTris / 1000), 'a build per thousand triangles of the stage, p95 (ms)').toBeLessThan(pin.buildPerKtri * 1.6)
      expect(best.kinds.skin.median, 'a skinning, median (ms)').toBeLessThan(PIN_MS.skin)
      expect(best.heavyWorst, 'the worst frame (ms)').toBeLessThan(PIN_MS.worst)
    }, 120000)
  }

  it('the sim\'s speed does not change the refits: the same turn through the same body gives the same count at 10x, 30x and paused (within a few, the script reaching the prep at different moments), and the script\'s own turn at 1x fits nothing until the prep starts (P3) and then far less', () => {
    const one = runs.get(1)!
    const ten = runs.get(10)!
    const thirty = runs.get(30)!
    const paused = runs.get(0)!
    expect(one && ten && thirty && paused).toBeTruthy()
    // the stage is wanted from frame 7 (30x), 24 (10x), 0 (paused) and only at 4 sim seconds at 1x, when the body has all but turned: P3
    expect(one.firstWanted).toBeGreaterThan(200)
    expect(one.jobsBeforeWanted, 'no skin, fit or build before the stage has something to show').toBe(0)
    expect(one.begun).toBeLessThan(thirty.begun)
    for (const r of [ten, thirty, paused]) expect(Math.abs(r.begun - thirty.begun), 'refits at 10x, 30x and paused are the same turn').toBeLessThanOrEqual(6)
    // (it was 184 at 30x against 39 at 1x)
    expect(thirty.begun).toBeLessThan(0.3 * 184)
  })
})
