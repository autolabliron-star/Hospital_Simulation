/**
 * R5 wave 3 (agent J): the window, the plate under it and the sheet's hang, on the real bodies (P4, P5, P6, P7):
 *
 *   P4  the opaque plate covers the whole window, for every avatar x three sizes x every pose x the drape's progress, and whatever the needles ask for (the window and the plate are
 *       laid out together: window.ts): not one point of the hole lacks plate, so no skin, body or pad ever shows through it. The old placement (the window from the dilated field, the
 *       plate from the skin's own) left up to 8 % of it open on a narrow body; a control here makes the metric see exactly that
 *   P5  one needle geometry for the sim, the arm and the drapes (src/sim/procedure/ctSlice.ts): the sim's planned needles over 40 seeds, STRICT on every avatar at three sizes: every entry is
 *       in the window, every shaft meets the skin inside it, every tip is inside the body, and the entries lie on the fitted skin (within 2 cm for half to two thirds of them, 4 cm for
 *       most: the bodies' own builds differ by +-4 cm and no room geometry knows them). The old fixed mapping (no roll) is the negative control
 *   P6  the plate and the marks follow the five scripts and never appear on the wrong side: shown from the prep to the dressing in the position the prep was done in, gone when the
 *       patient is turned back or the arm comes down
 *   P7  the sheet hangs from beyond the table's edge: no vertex of it is under the pad's top inside the pad's footprint
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCtCradle } from '@/scene/imaging/machines/ct'
import { CRADLE } from '@/scene/imaging/machines/motion'
import { AVATARS, POSE0, type ProcTableId } from '@/scene/actors/crowd/procTable.testkit'
import { Rng } from '@/sim/rng'
import { COMPILED_SCRIPTS, caseSteps, newCursor, patientAt } from '@/sim/procedure'
import { ctSliceInto } from '@/sim/procedure/ctSlice'
import { CRYO_SUITE } from '@/sim/places'
import { planCase } from '@/sim/cryoSuite/plan'
import type { CryoTarget, PatientPoseView, ProcedureId } from '@/sim/types'
import { COUCH_FRAME_HALF, COUCH_PAD_HALF, CT_PAD_HALF, CT_SLAB_HALF, ROOMS, siteOfNeedle, type RoomId } from './config'
import { heightAt } from './field'
import { BODY_MIN, PLATE_EDGE_KEEP, PLATE_MARGIN, SITE_MARGIN_Z, SITES_HALF_X, SITES_HALF_Z, bodyEdge } from './window'
import { ALL_BODIES, OUTFITS, SCALES, partTris, posedPatient, skinOf } from './proc.testkit'
import { distanceToSkin, firstSkinCrossing, roomToPatient } from './needleSkin.testkit'
import { MAX_SITES } from './marks'
import { PROC_PART, newProcMemory, stepProcStage, type ProcIn, type ProcMemory } from './stage'
import { SHEET_STEP } from './sheetGrid'

type Body = (typeof ALL_BODIES)[number]
const WHO: readonly (Body | 'procedural')[] = ['procedural', ...ALL_BODIES]
const name = (w: Body | 'procedural'): string => (w === 'procedural' ? w : w.id)

interface Pose {
  label: string
  room: RoomId
  table: ProcTableId
  target: CryoTarget
  pose: Partial<PatientPoseView>
}
const POSES: readonly Pose[] = [
  { label: 'kidney: on the right side, the left flank up', room: 'cryo', table: 'cryo', target: 'kidney', pose: { position: 'obliqueLeftUp', arms: 'aboveHead' } },
  { label: 'lung: face down', room: 'cryo', table: 'cryo', target: 'lung', pose: { position: 'prone', arms: 'aboveHead' } },
  { label: 'liver: face down', room: 'cryo', table: 'cryo', target: 'liver', pose: { position: 'prone', arms: 'aboveHead' } },
  { label: 'cryo, face up before the turn (the window waits where the back will be)', room: 'cryo', table: 'cryo', target: 'liver', pose: { position: 'supine', arms: 'out' } },
  { label: 'breast: the couch, one arm up', room: 'us', table: 'us', target: 'kidney', pose: { position: 'supine', arms: 'oneUp', rollDeg: -8 } },
]

/** (`dt` is a second: the geometry is laid out again whenever the drape has moved by a step, as it is on a real frame; with no time passing it would only be laid out once.) */
function input(pose: Pose, skin: ReturnType<typeof skinOf> | null, sites: Float64Array, nSites: number, view: Partial<PatientPoseView>): ProcIn {
  return { patient: { ...POSE0, ...pose.pose, ...view }, skin, sites, nSites, rootX: 0, rootY: 0, rootZ: 0, heading: 0, dt: 1, target: pose.target }
}

/** The (z, x) plane at 5 mm: which cells a set of triangles covers (the centre of the cell inside one). */
class Cover {
  static readonly Z0 = -1.3
  static readonly X0 = -0.7
  static readonly CELL = 0.005
  static readonly NZ = Math.ceil(2.6 / Cover.CELL)
  static readonly NX = Math.ceil(1.4 / Cover.CELL)
  readonly cells = new Uint8Array(Cover.NZ * Cover.NX)
  add(tri: Float32Array): void {
    const { Z0, X0, CELL, NZ, NX } = Cover
    for (let t = 0; t + 8 < tri.length; t += 9) {
      const ax = tri[t], az = tri[t + 2]
      const bx = tri[t + 3], bz = tri[t + 5]
      const cx = tri[t + 6], cz = tri[t + 8]
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(den) < 1e-14) continue
      const i0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - Z0) / CELL))
      const i1 = Math.min(NZ - 1, Math.floor((Math.max(az, bz, cz) - Z0) / CELL))
      const j0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - X0) / CELL))
      const j1 = Math.min(NX - 1, Math.floor((Math.max(ax, bx, cx) - X0) / CELL))
      for (let i = i0; i <= i1; i++) {
        const z = Z0 + (i + 0.5) * CELL
        for (let j = j0; j <= j1; j++) {
          const x = X0 + (j + 0.5) * CELL
          const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den
          const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den
          const l3 = 1 - l1 - l2
          if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) this.cells[i * NX + j] = 1
        }
      }
    }
  }
  at(z: number, x: number): boolean {
    const i = Math.floor((z - Cover.Z0) / Cover.CELL)
    const j = Math.floor((x - Cover.X0) / Cover.CELL)
    return this.cells[i * Cover.NX + j] === 1
  }
}

/** The window's samples (cell centres inside the rectangle, every 5 mm) not covered by the plate, and covered by the sheet; the samples there are. */
function holeMetrics(mem: ProcMemory): { samples: number; noPlate: number; sheetOver: number; at: string } {
  const plate = new Cover()
  plate.add(partTris(mem, PROC_PART.plate))
  const sheet = new Cover()
  sheet.add(partTris(mem, PROC_PART.sheet))
  const w = mem.window
  let samples = 0
  let noPlate = 0
  let sheetOver = 0
  let at = ''
  // (the window's edges are exact now, not on the 5 mm grid: a cell the edge cuts through has its middle on one side or the other, so the samples keep one cell inside it)
  for (let z = w.z0 + Cover.CELL + 0.0025; z < w.z1 - Cover.CELL; z += Cover.CELL) {
    for (let x = w.x0 + Cover.CELL + 0.0025; x < w.x1 - Cover.CELL; x += Cover.CELL) {
      samples++
      if (!plate.at(z, x)) {
        noPlate++
        if (at === '') at = `z ${z.toFixed(3)} x ${x.toFixed(3)}`
      }
      // (the hole is a hole where the sheet has been laid: rows the leading edge has not reached have no sheet to cut)
      if (sheet.at(z, x)) sheetOver++
    }
  }
  return { samples, noPlate, sheetOver, at }
}

/** The needles of a planned case as stage sites (the patient frame), `nSites` of them. */
function sitesOfPlan(target: CryoTarget, seed: number, out: Float64Array): number {
  const plan = planCase(new Rng(seed), `s-${seed}`, 0, 0, false, target)
  let n = 0
  for (const nd of plan.needles) {
    if (n >= MAX_SITES) break
    siteOfNeedle(target, nd, out, n * 2)
    n++
  }
  return n
}

describe('P4: the plate covers the whole window', () => {
  it('every avatar (the coat and the dress too), three sizes, in a gown and in everyday clothes, every pose, the drape at 25, 50, 75 and 100 % and with no needles, the planned ones, and sites far off the body: no point of the hole has no plate, and the sheet is cut away over the hole', async () => {
    const bad: string[] = []
    let samples = 0
    let cases = 0
    let narrowest = Infinity
    let narrowestAt = ''
    for (const pose of POSES) {
      for (const who of WHO) {
        for (const scale of who === 'procedural' ? [1] : SCALES) {
         for (const outfit of OUTFITS) {
          const tp = await posedPatient(who, pose.table, pose.pose, scale, outfit)
          const skin = skinOf(tp)
          const mem = newProcMemory(pose.room)
          const sites = new Float64Array(MAX_SITES * 2)
          const planned = new Float64Array(MAX_SITES * 2)
          const nPlanned = pose.room === 'cryo' ? sitesOfPlan(pose.target, 5 + cases, planned) : 0
          // sites far off the body, either side, the head end and the foot end (a stand-in for a plan the body does not hold)
          const far = new Float64Array([0.1, 0.5, -0.1, -0.5, -0.45, 0.1, 0.9, -0.1])
          for (const variant of ['none', 'plan', 'far'] as const) {
            const n = variant === 'none' ? 0 : variant === 'plan' ? nPlanned : 4
            sites.set(variant === 'plan' ? planned : far)
            for (const drape of [0.25, 0.5, 0.75, 1]) {
              stepProcStage(mem, input(pose, skin, sites, n, { prep: 1, drape, marks: variant === 'none' ? 'marked' : 'needles' }))
              expect(mem.mesh.overflow).toBe(false)
              const w = mem.window
              const m = holeMetrics(mem)
              cases++
              samples += m.samples
              if (variant !== 'far' && w.open && w.x1 - w.x0 < narrowest) {
                narrowest = w.x1 - w.x0
                narrowestAt = `${pose.label} ${name(who)} x${scale} ${outfit} ${variant} drape ${drape}: window z ${w.z0.toFixed(2)}..${w.z1.toFixed(2)} x ${w.x0.toFixed(3)}..${w.x1.toFixed(3)}`
              }
              const label = `${pose.label} ${name(who)} x${scale} ${outfit} ${variant} drape ${drape}`
              if (!w.open) bad.push(`${label}: no window`)
              if (m.noPlate > 0) bad.push(`${label}: ${m.noPlate} of ${m.samples} samples of the hole (${((100 * m.noPlate) / m.samples).toFixed(1)} %) have no plate, first at ${m.at}`)
              if (m.sheetOver > 0) bad.push(`${label}: the sheet covers ${m.sheetOver} samples of the hole`)
            }
          }
         }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
    // the controls: a real number of cases and samples were measured, and the windows (of the real plans and the default) are wide enough to be a window (five columns at the least:
    // the 'far' sites spread over the whole body are only there to stress the cover)
    expect(cases).toBeGreaterThan(3000)
    expect(samples).toBeGreaterThan(2e6)
    expect(narrowest, narrowestAt).toBeGreaterThan(0.12)
  }, 900000)

  it('the metric sees an open hole: a plate pulled 3 cm in at one side leaves a measurable share of the window bare (a negative control)', async () => {
    const pose = POSES[1]
    const tp = await posedPatient(AVATARS[3], pose.table, pose.pose)
    const mem = newProcMemory('cryo')
    stepProcStage(mem, input(pose, skinOf(tp), new Float64Array(MAX_SITES * 2), 0, { prep: 1, drape: 1, marks: 'none' }))
    const ok = holeMetrics(mem)
    expect(ok.noPlate).toBe(0)
    // pull the plate's outer columns (x above the window's middle) in by 3 cm
    const m = mem.mesh
    const w = mem.window
    const mid = (w.x0 + w.x1) / 2
    const a = mem.parts[PROC_PART.plate * 2]
    const b = mem.parts[PROC_PART.plate * 2 + 1]
    const seen = new Set<number>()
    for (let i = a; i < b; i++) seen.add(m.idx[i])
    for (const v of seen) if (m.pos[v * 3] > mid) m.pos[v * 3] = Math.max(mid, m.pos[v * 3] - 0.06)
    const bad = holeMetrics(mem)
    expect(bad.noPlate / bad.samples).toBeGreaterThan(0.05)
  })

  it('the plate\'s margin is the 3 cm it always was where the body allows, and the window stays 5 mm inside the plate\'s own limit where it does not (the construction\'s numbers)', async () => {
    expect(PLATE_MARGIN).toBeCloseTo(0.03, 9)
    expect(PLATE_EDGE_KEEP).toBeCloseTo(0.012, 9)
    const pose = POSES[0]
    const tp = await posedPatient(AVATARS[3], pose.table, pose.pose)
    const mem = newProcMemory('cryo')
    stepProcStage(mem, input(pose, skinOf(tp), new Float64Array(MAX_SITES * 2), 0, { prep: 1, drape: 1, marks: 'none' }))
    const w = mem.window
    for (let r = 0; r < w.rows; r++) {
      const z = w.pz0 + ((w.pz1 - w.pz0) * r) / (w.rows - 1)
      // the plate's row: the window and the margin, kept inside the body's limit
      const xa = mem.plate.xlo[r]
      const xb = mem.plate.xhi[r]
      expect(xa, `row ${r}`).toBeLessThanOrEqual(w.x0 + 1e-6)
      expect(xb, `row ${r}`).toBeGreaterThanOrEqual(w.x1 - 1e-6)
      if (z >= w.z0 && z <= w.z1) {
        expect(xa, `row ${r} z ${z.toFixed(3)}`).toBeLessThanOrEqual(w.x0 - 0.0049 + 0.0002 + (w.eLo[r] > w.x0 - PLATE_MARGIN ? PLATE_MARGIN : 0))
      }
    }
  })
})

describe('P5: the window is placed round the needles the sim plans', () => {
  /** The sim's planned needles of a seed, as the stage's sites (the patient frame) and as 3D points (the patient frame: x across, h above the pad, z toward the feet). */
  const planOf = (target: CryoTarget, seed: number): { entry: Float64Array[]; tip: Float64Array[]; n: number } => {
    const plan = planCase(new Rng(seed), `s-${seed}`, 0, 0, false, target)
    const entry: Float64Array[] = []
    const tip: Float64Array[] = []
    const v = { x: 0, y: 0, z: 0 }
    for (const nd of plan.needles.slice(0, MAX_SITES)) {
      const e = new Float64Array(3)
      const t = new Float64Array(3)
      ctSliceInto(target, 0, nd.entry.x, nd.entry.y, nd.dz, v)
      roomToPatient(v.x, v.y, v.z, e)
      ctSliceInto(target, 0, nd.tip.x, nd.tip.y, nd.dz, v)
      roomToPatient(v.x, v.y, v.z, t)
      entry.push(e)
      tip.push(t)
    }
    return { entry, tip, n: entry.length }
  }

  /** What each target measured on the avatars (the stage's real bodies). */
  interface Measured {
    /** Entries (avatars only), those within 2 cm of the fitted skin, the largest distance (m), and the entries inside the window. */
    entries: number
    within2: number
    within4: number
    worst: number
    inWindow: number
    /** Shafts: those that meet the skin, those that do so inside the window, and the tips inside the body. */
    crossing: number
    crossInWindow: number
    tipsIn: number
    /** The bodies (an avatar at a size): their count, those with every entry within 2 cm of the body's own mean offset (the spread of the plan), and the spread (m) of the worst. */
    bodies: number
    flat: number
    spread: number
    /** The spread of the bodies' own mean offsets (m): the builds and the sizes, what no room geometry can know. */
    sdOfBodies: number
    /** The procedural body (a fallback: it lies lower, a hand's breadth under the avatars), its entries within the window. */
    proceduralEntries: number
    proceduralInWindow: number
    proceduralMean: number
  }
  const measured: Record<string, Measured> = {}

  /** Whether the stage's field stands over `h` at (z, x): the body is under the point (a tip inside it). */
  const under = (g: Float32Array, z: number, x: number, h: number): boolean => heightAt(g, z, x) - h > 0.005

  for (const pose of POSES.slice(0, 3)) {
    it(`${pose.label}: the sim's planned needles over 40 seeds (every avatar, three sizes): every entry is in the window, on the fitted skin, every shaft meets the skin inside the window, every tip is inside the body`, async () => {
      const bad: string[] = []
      const m: Measured = { entries: 0, within2: 0, within4: 0, worst: 0, inWindow: 0, crossing: 0, crossInWindow: 0, tipsIn: 0, bodies: 0, flat: 0, spread: 0, sdOfBodies: 0, proceduralEntries: 0, proceduralInWindow: 0, proceduralMean: 0 }
      const raw = new Float64Array(MAX_SITES * 2)
      const means: number[] = []
      let proceduralSum = 0
      for (const who of WHO) {
        for (const scale of who === 'procedural' ? [1] : SCALES) {
          const tp = await posedPatient(who, pose.table, pose.pose, scale)
          const skin = skinOf(tp)
          const mem = newProcMemory('cryo')
          const signed: number[] = []
          for (let seed = 1; seed <= 40; seed++) {
            const pl = planOf(pose.target, seed)
            const n = sitesOfPlan(pose.target, seed, raw)
            expect(n).toBe(pl.n)
            stepProcStage(mem, input(pose, skin, raw, n, { prep: 1, drape: 1, marks: 'needles' }))
            const w = mem.window
            const label = `${name(who)} x${scale} seed ${seed}`
            if (!w.open) bad.push(`${label}: no window`)
            const plate = new Cover()
            plate.add(partTris(mem, PROC_PART.plate))
            for (let i = 0; i < n; i++) {
              const e = pl.entry[i]
              const t = pl.tip[i]
              // (the drapes' site IS the sim's entry: patient frame z, x)
              expect(raw[i * 2], label).toBeCloseTo(e[2], 9)
              expect(raw[i * 2 + 1], label).toBeCloseTo(e[0], 9)
              const inside = e[2] >= w.z0 && e[2] <= w.z1 && e[0] >= w.x0 && e[0] <= w.x1
              // the nick: on the plate, in the window
              const nz = mem.plate.drawn[i * 2]
              const nx = mem.plate.drawn[i * 2 + 1]
              if (!plate.at(nz, nx)) bad.push(`${label} needle ${i}: the nick (${nz.toFixed(3)}, ${nx.toFixed(3)}) is off the plate`)
              if (who === 'procedural') {
                m.proceduralEntries++
                if (inside) m.proceduralInWindow++
                proceduralSum += distanceToSkin(skin, e[0], e[1], e[2])
                continue
              }
              m.entries++
              if (inside) m.inWindow++
              else bad.push(`${label} needle ${i}: the entry (z ${e[2].toFixed(3)}, x ${e[0].toFixed(3)}) is outside the window (z ${w.z0.toFixed(3)}..${w.z1.toFixed(3)}, x ${w.x0.toFixed(3)}..${w.x1.toFixed(3)})`)
              // the entry on the skin
              const d = distanceToSkin(skin, e[0], e[1], e[2])
              if (d <= 0.02) m.within2++
              if (d <= 0.04) m.within4++
              if (d > m.worst) m.worst = d
              // the shaft: from 12 cm outside the entry, along the path, to the tip
              const L = Math.hypot(t[0] - e[0], t[1] - e[1], t[2] - e[2])
              const ux = (t[0] - e[0]) / L
              const uy = (t[1] - e[1]) / L
              const uz = (t[2] - e[2]) / L
              const back = 0.12
              const sx = e[0] - ux * back
              const sh = e[1] - uy * back
              const sz = e[2] - uz * back
              const k = firstSkinCrossing(skin, sx, sh, sz, t[0], t[1], t[2])
              if (k >= 0) {
                m.crossing++
                const cx = sx + (t[0] - sx) * k
                const cz = sz + (t[2] - sz) * k
                if (cz >= w.z0 && cz <= w.z1 && cx >= w.x0 && cx <= w.x1) m.crossInWindow++
                else bad.push(`${label} needle ${i}: the shaft meets the skin at (z ${cz.toFixed(3)}, x ${cx.toFixed(3)}), outside the window`)
                // the offset of the entry from the skin along the path, with its sign (the entry in the air: +): the path's own distance to where it meets the skin
                signed.push(k * (L + back) - back > 0 ? d : -d)
              } else bad.push(`${label} needle ${i}: the shaft never meets the skin`)
              if (under(mem.field.h, t[2], t[0], t[1])) m.tipsIn++
              else bad.push(`${label} needle ${i}: the tip (z ${t[2].toFixed(3)}, x ${t[0].toFixed(3)}, h ${t[1].toFixed(3)}) is not inside the body`)
            }
          }
          if (who !== 'procedural' && signed.length > 0) {
            // the plan's spread on this body: how far its entries are from the body's own mean offset (the builds and the sizes are the bodies', not the plan's)
            const mean = signed.reduce((a, b) => a + b, 0) / signed.length
            let sp = 0
            for (const v of signed) sp = Math.max(sp, Math.abs(v - mean))
            means.push(mean)
            m.bodies++
            if (sp <= 0.02) m.flat++
            if (sp > m.spread) m.spread = sp
          }
        }
      }
      const avg = means.reduce((a, b) => a + b, 0) / means.length
      m.sdOfBodies = Math.sqrt(means.reduce((a, b) => a + (b - avg) * (b - avg), 0) / means.length)
      m.proceduralMean = proceduralSum / Math.max(1, m.proceduralEntries)
      measured[pose.target] = m
      console.log(
        `P5 ${pose.target}: ${m.entries} entries on ${m.bodies} bodies: ${m.within2} within 2 cm of the skin (${((100 * m.within2) / m.entries).toFixed(1)} %), ${m.within4} within 4 cm, the worst ${(m.worst * 100).toFixed(1)} cm; ${m.inWindow} in the window; ` +
          `${m.crossing} shafts meet the skin (${m.crossInWindow} inside the window), ${m.tipsIn} tips inside the body; ${m.flat} of ${m.bodies} bodies have all their entries within 2 cm of their own mean (the worst spread ${(m.spread * 100).toFixed(1)} cm); ` +
          `the bodies' own offsets differ by ${(m.sdOfBodies * 100).toFixed(1)} cm (sd); the procedural body: ${m.proceduralInWindow} of ${m.proceduralEntries} entries in the window, ${(m.proceduralMean * 100).toFixed(1)} cm from its skin`,
      )
      expect(bad.slice(0, 10)).toEqual([])
      // STRICT, on every avatar at every size: every entry in the window, every shaft meeting the skin inside it, every tip inside the body (`bad` is empty: the three counts below are all of them)
      expect(m.entries).toBeGreaterThan(40 * 2 * 42 * 0.9)
      expect(m.inWindow).toBe(m.entries)
      expect(m.crossing).toBe(m.entries)
      expect(m.crossInWindow).toBe(m.entries)
      expect(m.tipsIn).toBe(m.entries)
      // the plan is the same on every body: on each of the 42 bodies the entries lie within 2 cm of one another's offset from the skin (the geometry is consistent: the worst spread is
      // 1.1 cm), whatever the body's own offset is
      expect(m.flat).toBe(m.bodies)
      expect(m.bodies).toBe(AVATARS.length * SCALES.length)
      expect(m.spread).toBeLessThan(0.02)
      // on the fitted skin: the room's geometry is fixed and the bodies are not (the avatars' builds and the three sizes put their skins up to 4 cm either way of the nominal one: sd 2 to
      // 3 cm), so no fixed geometry has every entry within 2 cm of every body. What it can do, and the old one (a fixed mapping with no roll: 0 %, see the control) could not:
      const need = THRESH[pose.target]
      expect(m.within2 / m.entries, `${pose.target}: within 2 cm`).toBeGreaterThan(need.within2)
      expect(m.within4 / m.entries, `${pose.target}: within 4 cm`).toBeGreaterThan(need.within4)
      expect(m.worst, `${pose.target}: the worst entry`).toBeLessThan(0.085)
      expect(m.sdOfBodies).toBeLessThan(0.035)
    }, 1800000)
  }

  /** What each target keeps to (a margin under what was measured: kidney 50.5 / 84.0 %, lung 70.0 / 91.0 %, liver 57.7 / 83.4 %): the share of entries within 2 cm and within 4 cm of the skin. */
  const THRESH: Record<CryoTarget, { within2: number; within4: number }> = { kidney: { within2: 0.45, within4: 0.78 }, lung: { within2: 0.62, within4: 0.86 }, liver: { within2: 0.5, within4: 0.78 } }

  it('a negative control: the old fixed mapping (no roll: x = left, y = down, the tumour 0.10 m over the pad, the kidney\'s bands for the prone targets) misses the skin the way the verifier saw: the kidney\'s entries hang in the air, none in the window', async () => {
    // the kidney's plan is the one the old mapping was written for (x toward the robot, y down): the entry at tumour + (-dz, -y, -x), the tumour 0.10 m over the pad and 0.10 m north of the centre line
    const T = CRYO_SUITE.ct.table
    let n = 0
    let within2 = 0
    let inWindow = 0
    let sum = 0
    const raw = new Float64Array(MAX_SITES * 2)
    const e = new Float64Array(3)
    for (const who of [AVATARS[0], AVATARS[3], AVATARS[8]]) {
      const pose = POSES[0]
      const tp = await posedPatient(who, pose.table, pose.pose)
      const skin = skinOf(tp)
      const mem = newProcMemory('cryo')
      for (let seed = 1; seed <= 20; seed++) {
        const plan = planCase(new Rng(seed), `s-${seed}`, 0, 0, false, 'kidney')
        let k = 0
        for (const nd of plan.needles.slice(0, MAX_SITES)) {
          roomToPatient(T.out.x - 0.25 - nd.dz * 0.001, T.height + 0.1 - nd.entry.y * 0.001, T.out.z - 0.1 - nd.entry.x * 0.001, e)
          raw[k * 2] = e[2]
          raw[k * 2 + 1] = e[0]
          k++
          const d = distanceToSkin(skin, e[0], e[1], e[2])
          n++
          sum += d
          if (d <= 0.02) within2++
        }
        stepProcStage(mem, input(pose, skin, raw, k, { prep: 1, drape: 1, marks: 'needles' }))
        for (let i = 0; i < k; i++) {
          if (raw[i * 2] >= mem.window.z0 && raw[i * 2] <= mem.window.z1 && raw[i * 2 + 1] >= mem.window.x0 && raw[i * 2 + 1] <= mem.window.x1) inWindow++
        }
      }
    }
    expect(n).toBeGreaterThan(100)
    // (the metric sees it: with the roll applied the same bodies have half of them within 2 cm and all in the window)
    expect(within2 / n).toBeLessThan(0.15)
    expect(sum / n).toBeGreaterThan(0.05)
    expect(inWindow / n).toBeLessThan(0.1)
  }, 600000)

  it('entries the body holds are in the window: sites at the middle of what the body allows, along the window\'s rows, in every pose (every avatar, three sizes; the strict form of P5)', async () => {
    const bad: string[] = []
    let n = 0
    const sites = new Float64Array(MAX_SITES * 2)
    for (const pose of POSES.slice(0, 3)) {
      for (const who of WHO) {
        for (const scale of who === 'procedural' ? [1] : SCALES) {
          const tp = await posedPatient(who, pose.table, pose.pose, scale)
          const skin = skinOf(tp)
          const mem = newProcMemory('cryo')
          stepProcStage(mem, input(pose, skin, sites, 0, { prep: 1, drape: 1, marks: 'none' }))
          for (const dz of [-0.06, 0, 0.06, 0.12]) {
            // (three sites round a point on the plan's own axes along the table: the target's z and the body's middle across what it holds there)
            const z0 = mem.window.z0 + 0.1 + dz
            const e = { lo: -bodyEdge(mem.field.h, z0, -1, BODY_MIN), hi: bodyEdge(mem.field.h, z0, 1, BODY_MIN) }
            const mid = (e.lo + e.hi) / 2
            for (let i = 0; i < 3; i++) {
              sites[i * 2] = z0 + 0.01 * (i - 1)
              sites[i * 2 + 1] = mid + 0.015 * (i - 1)
            }
            stepProcStage(mem, input(pose, skin, sites, 3, { prep: 1, drape: 1, marks: 'needles' }))
            const w = mem.window
            for (let i = 0; i < 3; i++) {
              n++
              const z = sites[i * 2]
              const x = sites[i * 2 + 1]
              if (z < w.z0 || z > w.z1 || x < w.x0 || x > w.x1) bad.push(`${pose.label} ${name(who)} x${scale} dz ${dz}: the site (${z.toFixed(3)}, ${x.toFixed(3)}) is outside the window (${w.z0.toFixed(2)}..${w.z1.toFixed(2)}, ${w.x0.toFixed(2)}..${w.x1.toFixed(2)})`)
              const nz = mem.plate.drawn[i * 2]
              const nx = mem.plate.drawn[i * 2 + 1]
              if (Math.hypot(nz - z, nx - x) > 0.0155 * Math.SQRT2 + 1e-6) bad.push(`${pose.label} ${name(who)} x${scale}: the nick is ${(Math.hypot(nz - z, nx - x) * 100).toFixed(1)} cm from its site`)
            }
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
    expect(n).toBeGreaterThan(1000)
  }, 900000)

  it('the window is placed again only when what it is placed from changes: the rebuilds while the drape eases reuse the placement (a fit that comes in, the needles moving, the position or the target place it again)', async () => {
    const pose = POSES[1]
    const tp = await posedPatient(AVATARS[3], pose.table, pose.pose)
    const skin = skinOf(tp)
    const mem = newProcMemory('cryo')
    const sites = new Float64Array(MAX_SITES * 2)
    const n = sitesOfPlan(pose.target, 3, sites)
    // the drape eases over many rebuilds (a second apart: each is due), the window is placed once
    for (const drape of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1]) stepProcStage(mem, input(pose, skin, sites, n, { prep: 1, drape, marks: 'needles' }))
    expect(mem.builds).toBeGreaterThanOrEqual(6)
    expect(mem.placements).toBe(1)
    // a needle moves: placed again, once
    sites[0] += 0.03
    stepProcStage(mem, input(pose, skin, sites, n, { prep: 1, drape: 1, marks: 'needles' }))
    expect(mem.placements).toBe(2)
    // a new fit (the body moved): placed again
    stepProcStage(mem, input(pose, { ...skin, version: 2 }, sites, n, { prep: 1, drape: 1, marks: 'needles' }))
    stepProcStage(mem, input(pose, { ...skin, version: 2 }, sites, n, { prep: 1, drape: 1, marks: 'needles' }))
    expect(mem.placements).toBe(3)
  })

  it('before any needle is planned the window waits at the target field; with needles it is round them, never smaller than the default, with the margin the sites ask for', async () => {
    const pose = POSES[1]
    const tp = await posedPatient(AVATARS[3], pose.table, pose.pose)
    const skin = skinOf(tp)
    const none = newProcMemory('cryo')
    stepProcStage(none, input(pose, skin, new Float64Array(MAX_SITES * 2), 0, { prep: 1, drape: 1, marks: 'none' }))
    const sites = new Float64Array(MAX_SITES * 2)
    const n = sitesOfPlan(pose.target, 3, sites)
    expect(n).toBeGreaterThan(0)
    const some = newProcMemory('cryo')
    stepProcStage(some, input(pose, skin, sites, n, { prep: 1, drape: 1, marks: 'none' }))
    let zlo = Infinity
    let zhi = -Infinity
    for (let i = 0; i < n; i++) {
      zlo = Math.min(zlo, sites[i * 2])
      zhi = Math.max(zhi, sites[i * 2])
    }
    // (the window holds the sites' span and their margin along the table, to the sheet's 4 cm rows)
    // (unless the sheet begins first: the window is never above the sheet's first row)
    expect(some.window.z0 <= zlo - SITE_MARGIN_Z + SHEET_STEP / 2 + 1e-6 || some.window.r0 === 1).toBe(true)
    expect(some.window.z1).toBeGreaterThanOrEqual(zhi + SITE_MARGIN_Z - SHEET_STEP / 2 - 1e-6)
    // a window that holds the sites is no taller than the default one, and at least 24 cm tall
    expect(some.window.z1 - some.window.z0).toBeLessThanOrEqual(none.window.z1 - none.window.z0 + 1e-6)
    expect(some.window.z1 - some.window.z0).toBeGreaterThanOrEqual(0.2 - 1e-6)
    expect(SITES_HALF_X).toBeGreaterThanOrEqual(0.075)
    expect(SITES_HALF_Z).toBeGreaterThanOrEqual(0.12)
    // a needle appearing moves the window's build (a discrete rebuild), nothing else
    expect(none.builds).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// P6: the five scripts
// ---------------------------------------------------------------------------------------------

const SCRIPTS: readonly { id: ProcedureId; table: ProcTableId; room: RoomId; target: CryoTarget }[] = [
  { id: 'cryo-kidney', table: 'cryo', room: 'cryo', target: 'kidney' },
  { id: 'cryo-lung', table: 'cryo', room: 'cryo', target: 'lung' },
  { id: 'cryo-liver', table: 'cryo', room: 'cryo', target: 'liver' },
  { id: 'us-breastCancer', table: 'us', room: 'us', target: 'kidney' },
  { id: 'us-fibroadenoma', table: 'us', room: 'us', target: 'kidney' },
]

describe('P6: the plate and the marks follow the five scripts, never on the wrong side', () => {
  for (const sc of SCRIPTS) {
    it(`${sc.id}: through every step (the start, the middle and the end of each), the stage is shown from the prep in the position it was done in and shows nothing when the patient has moved from it`, async () => {
      const compiled = COMPILED_SCRIPTS[sc.id]!
      const cs = caseSteps(compiled, 'watch', null, 2)
      const cursor = newCursor()
      const view: PatientPoseView = { ...POSE0 }
      const sites = new Float64Array(MAX_SITES * 2)
      let nSites = 0
      if (sc.room === 'cryo') nSites = sitesOfPlan(sc.target, 11, sites)
      const skins = new Map<string, ReturnType<typeof skinOf>>()
      const bodyFor = async (p: PatientPoseView): Promise<ReturnType<typeof skinOf>> => {
        const key = `${p.position}/${p.arms}/${p.rollDeg}`
        let s = skins.get(key)
        if (!s) {
          const tp = await posedPatient(AVATARS[3], sc.table, { position: p.position, arms: p.arms, rollDeg: p.rollDeg })
          s = skinOf(tp, skins.size + 1)
          skins.set(key, s)
        }
        return s
      }
      const mem = newProcMemory(sc.room)
      let latched: { position: string; arms: string } | null = null
      let shownSteps = 0
      let hiddenAway = 0
      let dressedShown = false
      const log: string[] = []
      for (let i = 0; i < compiled.n; i++) {
        for (const progress of [0, 0.5, 1]) {
          cursor.index = i
          cursor.progress = progress
          patientAt(cs, cursor, view)
          const prepOn = view.prep > 0.004 || view.marks !== 'none'
          if (!prepOn) latched = null
          else if (latched === null) latched = { position: view.position, arms: view.arms }
          const away = latched !== null && (view.position !== latched.position || view.arms !== latched.arms)
          stepProcStage(mem, input({ label: '', room: sc.room, table: sc.table, target: sc.target, pose: {} }, await bodyFor(view), sites, nSites, view))
          const label = `${sc.id} step ${i} (${compiled.script.steps[i].id}) at ${progress}: ${view.position}/${view.arms} prep ${view.prep.toFixed(2)} drape ${view.drape.toFixed(2)} marks ${view.marks}`
          if (away) {
            // the gown is back over the site and the dressing under it: nothing is laid across the front or over the lowered arm
            expect(mem.mesh.ni, label).toBe(0)
            expect(mem.wants, label).toBe(false)
            hiddenAway++
          } else if (prepOn) {
            // the plate, in the position it was done in: its window's middle lies on the skin of this body (the plate stands on it, within the plate's own lift and tent)
            expect(mem.parts[PROC_PART.plate * 2 + 1] - mem.parts[PROC_PART.plate * 2], label).toBeGreaterThan(0)
            expect(mem.bPosition, label).toBe(latched!.position)
            shownSteps++
            if (view.marks === 'dressed') dressedShown = true
          } else {
            expect(mem.mesh.ni, label).toBe(0)
          }
          if (log.length < 400) log.push(label + (away ? ' -> away' : prepOn ? ' -> shown' : ' -> nothing'))
        }
      }
      // the controls: the script has steps with the plate shown, and (for every script) a step where the patient is away from where it was prepped
      expect(shownSteps).toBeGreaterThan(10)
      expect(hiddenAway, 'the patient is turned back or the arm comes down after the procedure').toBeGreaterThan(0)
      // the dressings are on the plate before she moves (the stage does not drop the plate when the drape comes off)
      expect(dressedShown).toBe(true)
      // the case is over: the view is cleared (the sim empties it), the stage is empty and the latch is gone
      stepProcStage(mem, input({ label: '', room: sc.room, table: sc.table, target: sc.target, pose: {} }, await bodyFor(POSE0), sites, nSites, POSE0))
      expect(mem.mesh.ni).toBe(0)
      expect(mem.latched).toBe(false)
    }, 600000)
  }

  it('the position it was done in is kept: back in that position the stage comes back; a new case with another position latches that one', async () => {
    const pose = POSES[1]
    const sites = new Float64Array(MAX_SITES * 2)
    const prone = skinOf(await posedPatient(AVATARS[3], 'cryo', pose.pose), 1)
    const supine = skinOf(await posedPatient(AVATARS[3], 'cryo', { position: 'supine', arms: 'out' }), 2)
    const oblique = skinOf(await posedPatient(AVATARS[3], 'cryo', POSES[0].pose), 3)
    const mem = newProcMemory('cryo')
    const at = (skin: ReturnType<typeof skinOf>, v: Partial<PatientPoseView>): void => stepProcStage(mem, input(pose, skin, sites, 0, v))
    at(prone, { position: 'prone', arms: 'aboveHead', prep: 1, drape: 0, marks: 'marked' })
    expect(mem.mesh.ni).toBeGreaterThan(0)
    at(supine, { position: 'supine', arms: 'out', prep: 1, drape: 0, marks: 'dressed' })
    expect(mem.mesh.ni).toBe(0)
    expect(mem.away).toBe(true)
    at(prone, { position: 'prone', arms: 'aboveHead', prep: 1, drape: 0, marks: 'dressed' })
    expect(mem.mesh.ni).toBeGreaterThan(0)
    // the case is over, a new one starts on the side
    at(supine, { position: 'supine', arms: 'out', prep: 0, drape: 0, marks: 'none' })
    expect(mem.mesh.ni).toBe(0)
    expect(mem.latched).toBe(false)
    at(oblique, { position: 'obliqueLeftUp', arms: 'aboveHead', prep: 1, drape: 0, marks: 'marked' })
    expect(mem.lPosition).toBe('obliqueLeftUp')
    expect(mem.mesh.ni).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// P7: the hang
// ---------------------------------------------------------------------------------------------

describe('P7: the sheet hangs from beyond the table\'s edge', () => {
  it('the widths are the table\'s own: the CT cradle (ct.ts buildCtCradle: a slab 0.46 wide, the pad 3 cm in) and the couch (tools/arch/zones/imaging.py: a pad 0.68 on a frame 0.70)', () => {
    expect(CRADLE.width).toBeCloseTo(2 * CT_SLAB_HALF, 9)
    const g = buildCtCradle()
    g.computeBoundingBox()
    const pos = g.getAttribute('position')
    let slab = 0
    let pad = 0
    const top = g.boundingBox!.max.y
    for (let i = 0; i < pos.count; i++) {
      slab = Math.max(slab, Math.abs(pos.getZ(i)))
      if (pos.getY(i) > top - 1e-6) pad = Math.max(pad, Math.abs(pos.getZ(i)))
    }
    expect(slab).toBeCloseTo(CT_SLAB_HALF, 6)
    // (the pad's top is rounded at its edge: its flat top ends a little short of its widest)
    expect(pad).toBeLessThanOrEqual(CT_PAD_HALF + 1e-6)
    expect(pad).toBeGreaterThan(CT_PAD_HALF - 0.02)
    const src = readFileSync(join(process.cwd(), 'tools/arch/zones/imaging.py'), 'utf8')
    const pad2 = /rbox\('VinylGrey', 0, 0\.57, -0\.275, ([0-9.]+)/.exec(src)
    const frame = /rbox\('PowderWhite', 0, 0\.5, 0\.0, ([0-9.]+), 0\.07, 1\.9/.exec(src)
    expect(pad2).not.toBeNull()
    expect(frame).not.toBeNull()
    expect(parseFloat(pad2![1]) / 2).toBeCloseTo(COUCH_PAD_HALF, 9)
    expect(parseFloat(frame![1]) / 2).toBeCloseTo(COUCH_FRAME_HALF, 9)
    expect(ROOMS.cryo.hangFrom).toBeGreaterThan(CT_SLAB_HALF)
    expect(ROOMS.us.hangFrom).toBeGreaterThan(COUCH_FRAME_HALF)
    expect(ROOMS.cryo.hangFrom).toBeLessThan(ROOMS.cryo.sideMax)
    expect(ROOMS.us.hangFrom).toBeLessThan(ROOMS.us.sideMax)
  })

  it('no vertex of the sheet is under the pad\'s top inside the pad\'s footprint, and the hang falls only beyond the table\'s edge: every avatar, three sizes, every pose, the drape in full', async () => {
    const bad: string[] = []
    let hung = 0
    let lowest = 0
    for (const pose of POSES) {
      const cfg = ROOMS[pose.room]
      for (const who of WHO) {
        for (const scale of who === 'procedural' ? [1] : SCALES) {
          const tp = await posedPatient(who, pose.table, pose.pose, scale)
          const mem = newProcMemory(pose.room)
          stepProcStage(mem, input(pose, skinOf(tp), new Float64Array(MAX_SITES * 2), 0, { prep: 1, drape: 1, marks: 'none' }))
          const a = mem.parts[PROC_PART.sheet * 2]
          const b = mem.parts[PROC_PART.sheet * 2 + 1]
          const m = mem.mesh
          const seen = new Set<number>()
          for (let i = a; i < b; i++) seen.add(m.idx[i])
          for (const v of seen) {
            const x = Math.abs(m.pos[v * 3])
            const h = m.pos[v * 3 + 1]
            lowest = Math.min(lowest, h)
            if (h < -1e-6) hung++
            if (x <= cfg.padHalf && h < 0) bad.push(`${pose.label} ${name(who)} x${scale}: a sheet vertex at x ${x.toFixed(3)} is ${(-h * 100).toFixed(1)} cm under the pad's top`)
            // the hang falls only from the edge of the table
            if (h < -0.005 && x < cfg.hangFrom - 1e-6) bad.push(`${pose.label} ${name(who)} x${scale}: the sheet is ${(-h * 100).toFixed(1)} cm under the pad at x ${x.toFixed(3)}, inside the table's edge (${cfg.hangFrom})`)
          }
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
    // the controls: the hang does fall (over the table's edge), well under the pad's top
    expect(hung).toBeGreaterThan(1000)
    expect(lowest).toBeLessThan(-0.04)
  }, 900000)
})
