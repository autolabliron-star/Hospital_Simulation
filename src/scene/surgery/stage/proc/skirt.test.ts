/**
 * R5 wave 3 (agent J): the hole's SKIRT (P4, seen obliquely). The plate covers the window in plan (window.test.ts), but the sheet stands 3 to 5 cm over the plate at the hole's edge (it is
 * laid over the highest skin round, a centimetre and a half off it), and where the plate is limited by the body's edge it reaches only about a centimetre past the hole: a line of
 * sight through the hole at more than 14 to 20 degrees from vertical, toward that edge, missed the plate and met the body or the gown under the sheet (5 to 16 % of the edge's points
 * had a critical angle under 35 degrees). The cloth now drops from the hole's edge to the plate all round (sheet.ts `buildSkirt`).
 *
 * The test is the sight line itself: from points of the body's top near the window, rays go up at every azimuth and at slants to 70 degrees from vertical; a ray that meets nothing (not
 * the sheet, its skirt, the plate, nor the body itself) is a line of sight to the bare body from outside. There are none; with the skirt left out there are (the negative control: the
 * metric sees what the skirt is for).
 */
import { describe, expect, it } from 'vitest'
import { AVATARS, POSE0 } from '@/scene/actors/crowd/procTable.testkit'
import { Rng } from '@/sim/rng'
import { planCase } from '@/sim/cryoSuite/plan'
import type { CryoTarget, PatientPoseView } from '@/sim/types'
import { ROOMS, siteOfNeedle, type RoomId } from './config'
import { MAX_SITES } from './marks'
import { exactTop, partTris, posedPatient, skinOf } from './proc.testkit'
import { PROC_PART, newProcMemory, stepProcStage, type ProcMemory } from './stage'

interface Case {
  label: string
  room: RoomId
  table: 'cryo' | 'us'
  target: CryoTarget
  pose: Partial<PatientPoseView>
}
const CASES: readonly Case[] = [
  { label: 'kidney (on the side)', room: 'cryo', table: 'cryo', target: 'kidney', pose: { position: 'obliqueLeftUp', arms: 'aboveHead' } },
  { label: 'lung (face down)', room: 'cryo', table: 'cryo', target: 'lung', pose: { position: 'prone', arms: 'aboveHead' } },
  { label: 'liver (face down)', room: 'cryo', table: 'cryo', target: 'liver', pose: { position: 'prone', arms: 'aboveHead' } },
  { label: 'breast (couch)', room: 'us', table: 'us', target: 'kidney', pose: { position: 'supine', arms: 'oneUp', rollDeg: -8 } },
]
const WHO = ['procedural', AVATARS[0], AVATARS[3], AVATARS[8], AVATARS[12]] as const

/** Moeller-Trumbore over triangles (x, h, z corners, nine floats each): whether the segment from `o` along `d` (not normalised) up to parameter 1 meets any. */
function blocked(tris: Float32Array, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2]
    const e1x = tris[t + 3] - ax, e1y = tris[t + 4] - ay, e1z = tris[t + 5] - az
    const e2x = tris[t + 6] - ax, e2y = tris[t + 7] - ay, e2z = tris[t + 8] - az
    const px = dy * e2z - dz * e2y
    const py = dz * e2x - dx * e2z
    const pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (det > -1e-12 && det < 1e-12) continue
    const inv = 1 / det
    const sx = ox - ax, sy = oy - ay, sz = oz - az
    const u = (sx * px + sy * py + sz * pz) * inv
    if (u < 0 || u > 1) continue
    const qx = sy * e1z - sz * e1y
    const qy = sz * e1x - sx * e1z
    const qz = sx * e1y - sy * e1x
    const v = (dx * qx + dy * qy + dz * qz) * inv
    if (v < 0 || u + v > 1) continue
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv
    if (tt > 1e-6 && tt < 1) return true
  }
  return false
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(a.length + b.length)
  o.set(a)
  o.set(b, a.length)
  return o
}

/** The sheet's cloth, its skirt, the plate and the body as triangles, the window, and random points of the body's top round the window (z, x, h), seeded. */
async function scene(c: Case, who: (typeof WHO)[number], scale: number, seed: number, skirt: boolean) {
  const tp = await posedPatient(who, c.table, c.pose, scale)
  const skin = skinOf(tp)
  const mem: ProcMemory = newProcMemory(c.room)
  const sites = new Float64Array(MAX_SITES * 2)
  let n = 0
  if (c.room === 'cryo') {
    const plan = planCase(new Rng(seed), `s-${seed}`, 0, 0, false, c.target)
    for (const nd of plan.needles) {
      if (n >= MAX_SITES) break
      siteOfNeedle(c.target, nd, sites, n * 2)
      n++
    }
  }
  stepProcStage(mem, { patient: { ...POSE0, ...c.pose, prep: 1, drape: 1, marks: 'needles' }, skin, sites, nSites: n, rootX: 0, rootY: 0, rootZ: 0, heading: 0, dt: 1, target: c.target })
  let stage = concat(partTris(mem, PROC_PART.sheet), partTris(mem, PROC_PART.plate))
  if (skirt) stage = concat(stage, partTris(mem, PROC_PART.skirt))
  const body = tp.skin()
  const bt = new Float32Array(body.index.length * 3)
  for (let i = 0; i < body.index.length; i++) {
    bt[i * 3] = body.v[body.index[i] * 3]
    bt[i * 3 + 1] = body.v[body.index[i] * 3 + 1]
    bt[i * 3 + 2] = body.v[body.index[i] * 3 + 2]
  }
  return { mem, stage, bt, tris: concat(stage, bt), plate: partTris(mem, PROC_PART.plate), skirtTris: partTris(mem, PROC_PART.skirt) }
}

/** The body's top (upward-facing triangles) round the window: `count` random points, area-agnostic (a triangle at random, a point in it). */
function pointsNearWindow(bt: Float32Array, mem: ProcMemory, cfgZ0: number, cfgZ1: number, count: number, rng: Rng, ring = false): [number, number, number][] {
  const w = mem.window
  const near: number[] = []
  // (the whole of the body's top within 12 cm of the window, or only the ring that is the hole's own edge: 5 cm outside it to 3 cm inside, where the sight lines that slip under it start)
  const reach = ring ? 0.05 : 0.12
  for (let t = 0; t + 8 < bt.length; t += 9) {
    const cz = (bt[t + 2] + bt[t + 5] + bt[t + 8]) / 3
    const cx = (bt[t] + bt[t + 3] + bt[t + 6]) / 3
    if (cz < Math.max(w.z0 - reach, cfgZ0 + 0.06) || cz > Math.min(w.z1 + reach, cfgZ1 - 0.06) || cx < w.x0 - reach || cx > w.x1 + reach) continue
    if (ring && cz > w.z0 + 0.03 && cz < w.z1 - 0.03 && cx > w.x0 + 0.03 && cx < w.x1 - 0.03) continue
    // facing up: the normal's h component
    const e1x = bt[t + 3] - bt[t], e1z = bt[t + 5] - bt[t + 2]
    const e2x = bt[t + 6] - bt[t], e2z = bt[t + 8] - bt[t + 2]
    const ny = e1z * e2x - e1x * e2z
    if (ny > 0) near.push(t)
  }
  const out: [number, number, number][] = []
  if (near.length === 0) return out
  for (let k = 0; k < count; k++) {
    const t = near[Math.floor(rng.float() * near.length)]
    let a = rng.float()
    let b = rng.float()
    if (a + b > 1) {
      a = 1 - a
      b = 1 - b
    }
    const c = 1 - a - b
    out.push([c * bt[t + 2] + a * bt[t + 5] + b * bt[t + 8], c * bt[t] + a * bt[t + 3] + b * bt[t + 6], c * bt[t + 1] + a * bt[t + 4] + b * bt[t + 7]])
  }
  return out
}

/**
 * The lines of sight into the hole's volume from outside: rays from points of the body's top near the window, up at 8 azimuths and slants of 20, 40, 60 and 70 degrees, 1.2 m long, that
 * meet nothing (not the sheet, its skirt, the plate, nor the body itself) and pass over the window above the plate: out through the hole from under the sheet's edge, which is what the
 * skirt is for. (A ray that gets out under the sheet's open head end or foot end does not pass over the window: that is the sheet's length, not its window.)
 */
function leaks(tris: Float32Array, plate: Float32Array, w: ProcMemory['window'], pts: [number, number, number][]): { rays: number; seen: number; at: string } {
  let rays = 0
  let seen = 0
  let at = ''
  for (const [z, x, h] of pts) {
    for (let az = 0; az < 8; az++) {
      for (const deg of [20, 40, 60, 70]) {
        const s = Math.sin((deg * Math.PI) / 180)
        const cs = Math.cos((deg * Math.PI) / 180)
        const dx = 1.2 * s * Math.cos((az * Math.PI) / 4)
        const dz = 1.2 * s * Math.sin((az * Math.PI) / 4)
        const dh = 1.2 * cs
        rays++
        // (from a hair over the point, straight up, so the triangle it lies on is not what it meets)
        if (blocked(tris, x, h + 0.003, z, dx, dh, dz)) continue
        // over the window above the plate?
        let through = false
        for (let k = 1; k <= 48 && !through; k++) {
          const t = k / 48
          const pz = z + dz * t
          const px = x + dx * t
          if (pz < w.z0 || pz > w.z1 || px < w.x0 || px > w.x1) continue
          const top = exactTop(plate, pz, px)
          if (top !== -Infinity && h + 0.003 + dh * t > top) through = true
        }
        if (through) {
          seen++
          if (at === '') at = `point z ${z.toFixed(3)} x ${x.toFixed(3)} h ${h.toFixed(3)}, azimuth ${az * 45}, ${deg} degrees from vertical`
        }
      }
    }
  }
  return { rays, seen, at }
}

describe('the skirt closes the hole to a line of sight (P4, seen obliquely)', () => {
  it('from the body\'s top round the window nothing is seen from outside at any slant to 70 degrees: every case, five bodies, with the planned needles', async () => {
    const bad: string[] = []
    let rays = 0
    for (const c of CASES) {
      const rng = new Rng(77)
      const cfg = ROOMS[c.room]
      for (const who of WHO) {
        const name = who === 'procedural' ? who : who.id
        const sc = await scene(c, who, 1, 5 + CASES.indexOf(c), true)
        const pts = pointsNearWindow(sc.bt, sc.mem, cfg.sheetZ0, cfg.sheetZ1, 80, rng).concat(pointsNearWindow(sc.bt, sc.mem, cfg.sheetZ0, cfg.sheetZ1, 120, rng, true))
        expect(pts.length, `${c.label} ${name}: points of the body's top near the window`).toBeGreaterThan(100)
        const r = leaks(sc.tris, sc.plate, sc.mem.window, pts)
        rays += r.rays
        if (r.seen > 0) bad.push(`${c.label} ${name}: ${r.seen} of ${r.rays} lines of sight pass out through the hole from under the sheet, first ${r.at}`)
        // the skirt is there: a wall all round the hole, its feet on the plate, its tops on the sheet's edge
        expect(sc.skirtTris.length / 9, `${c.label} ${name}: skirt triangles`).toBeGreaterThan(40)
      }
    }
    expect(bad.slice(0, 8)).toEqual([])
    expect(rays).toBeGreaterThan(CASES.length * WHO.length * 150 * 30)
  }, 900000)

  it('the metric sees the leak the skirt closes: with the skirt left out, the same lines of sight pass out through the hole in every case (a negative control)', async () => {
    let seenTotal = 0
    let casesSeen = 0
    for (const c of CASES) {
      const rng = new Rng(77)
      const cfg = ROOMS[c.room]
      let caseSeen = 0
      for (const who of WHO) {
        const sc = await scene(c, who, 1, 5 + CASES.indexOf(c), false)
        const pts = pointsNearWindow(sc.bt, sc.mem, cfg.sheetZ0, cfg.sheetZ1, 80, rng).concat(pointsNearWindow(sc.bt, sc.mem, cfg.sheetZ0, cfg.sheetZ1, 120, rng, true))
        caseSeen += leaks(sc.tris, sc.plate, sc.mem.window, pts).seen
      }
      seenTotal += caseSeen
      console.log(`SKIRT control ${c.label}: ${caseSeen} lines of sight out through the hole with no skirt`)
      if (caseSeen > 0) casesSeen++
    }
    expect(seenTotal).toBeGreaterThan(0)
    expect(casesSeen, 'every case leaks without its skirt').toBe(CASES.length)
  }, 900000)

  it('the skirt is a wall of the sheet\'s own cloth: vertical, its face toward the window\'s inside, its foot on the plate (a few millimetres in it) and its top on the sheet\'s edge', async () => {
    for (const c of CASES) {
      const sc = await scene(c, AVATARS[3], 1, 7, true)
      const w = sc.mem.window
      const m = sc.mem.mesh
      const a = sc.mem.parts[PROC_PART.skirt * 2]
      const b = sc.mem.parts[PROC_PART.skirt * 2 + 1]
      expect(b - a, c.label).toBeGreaterThan(120)
      const cz = (w.z0 + w.z1) / 2
      const cx = (w.x0 + w.x1) / 2
      let inward = 0
      let tris = 0
      for (let i = a; i < b; i += 3) {
        const v0 = m.idx[i] * 3
        const v1 = m.idx[i + 1] * 3
        const v2 = m.idx[i + 2] * 3
        // the face (the mesh's own normals at its vertices, which `finishNormals` made): horizontal, toward the window's middle
        const nx = (m.nrm[v0] + m.nrm[v1] + m.nrm[v2]) / 3
        const ny = (m.nrm[v0 + 1] + m.nrm[v1 + 1] + m.nrm[v2 + 1]) / 3
        const nz = (m.nrm[v0 + 2] + m.nrm[v1 + 2] + m.nrm[v2 + 2]) / 3
        const px = (m.pos[v0] + m.pos[v1] + m.pos[v2]) / 3
        const pz = (m.pos[v0 + 2] + m.pos[v1 + 2] + m.pos[v2 + 2]) / 3
        tris++
        expect(Math.abs(ny), `${c.label}: the wall is vertical`).toBeLessThan(0.5)
        if (nx * (cx - px) + nz * (cz - pz) > 0) inward++
        // on the hole's edge (the wall stands on the rectangle's outline, to the exact edges)
        const onEdge = Math.abs(px - w.x0) < 0.03 || Math.abs(px - w.x1) < 0.03 || Math.abs(pz - w.z0) < 0.03 || Math.abs(pz - w.z1) < 0.03
        expect(onEdge, `${c.label}: a skirt triangle at z ${pz.toFixed(3)} x ${px.toFixed(3)} is off the window's outline`).toBe(true)
      }
      expect(inward / tris, `${c.label}: the share of the skirt that faces the window`).toBeGreaterThan(0.95)
    }
  })
})
