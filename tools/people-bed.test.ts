/**
 * Every converted avatar in a bed (W3 wave B follow-up), on the real meshes: each avatar's LOD 0 skinned on the CPU exactly as the avatar vertex shader does,
 * with the rows the crowd's own rig writes for a patient lying in a ward bed, on an ER trolley and on a stretcher. Two things are measured:
 *   - the body rests IN the mattress, the back sunk 1 to 4 cm into its top (the real tops: ward bed 0.49, ER trolley 0.44, stretcher 0.79), not hovering over it;
 *   - the blanket (gear.ts, the prop frame the rig writes for a covered lying patient) stands above every leg, foot and hip vertex, so it hides the shoes and
 *     the trousers: lying flat, reclined with the bed head raised, and at the smallest and the largest person.
 */
import { describe, expect, it } from 'vitest'
import { P, PART_COUNT, LIE, PROP } from '../src/scene/actors/crowd/constants'
import { applyBinds, type AvatarEntry } from '../src/scene/actors/crowd/avatars'
import { cpuMesh, loadBody, readIndex, skinAll, type CpuMesh } from '../src/scene/actors/crowd/avatars.testkit'
import { BLANKET, buildBlanketGeometry } from '../src/scene/actors/crowd/gear'
import { lookFor } from '../src/scene/actors/crowd/outfit'
import { createRig, makeInput, solveRig } from '../src/scene/actors/crowd/rig'
import { BACKREST, MATTRESS, TROLLEY } from '../src/scene/rooms/bedParts'
import { RECLINE_MAX } from '../src/scene/rooms/bedPose'

const index = readIndex()

/** The rows (binds applied) of a covered patient lying on a surface, after 150 still frames, and the rig that solved them. */
function lying(a: AvatarEntry, o: { surface: number; recline?: number; scale?: number }): { rows: Float32Array; lift: number } {
  const look = { ...lookFor({ id: 'bed-fit', role: 'patient', outfit: 'gown', variant: 0 }), scale: o.scale ?? 1, build: 1 }
  const rig = createRig(look, a.body)
  const inp = makeInput()
  inp.posture = 'lie'
  inp.mode = 'lie'
  inp.seatHeight = o.surface
  inp.covered = true
  rig.ctx.recline = o.recline ?? 0
  const rows = new Float32Array(PART_COUNT * 12)
  for (let i = 0; i < 150; i++) {
    inp.time = i / 60
    solveRig(rig, inp, rows, 0)
  }
  expect(rig.propDraw, 'a covered patient carries the blanket').toBe(PROP.blanket)
  applyBinds(rows, 0, a.bindInverse)
  return { rows, lift: rig.lastLift }
}

/** The lowest skinned y of the vertices whose main part is one of `parts`. */
function lowest(m: CpuMesh, skinned: Float32Array, parts: readonly number[]): number {
  let lo = Infinity
  for (let v = 0; v < m.count; v++) if (parts.includes(Math.round(m.joints[v * 4]))) lo = Math.min(lo, skinned[v * 3 + 1])
  return lo
}

// ---------------------------------------------------------------------------------------------
// The blanket as triangles in the person's root frame
// ---------------------------------------------------------------------------------------------

const blanketGeo = buildBlanketGeometry().geometry
const BPOS = blanketGeo.getAttribute('position')
const BIDX = blanketGeo.index!

/** The blanket's triangles through the prop frame in `rows` (a 3x4 matrix row-major, as the shader reads it): nine floats each, x y z for three corners. */
function blanketTriangles(rows: Float32Array): Float32Array {
  const m = P.prop * 12
  const out = new Float32Array(BIDX.count * 3)
  for (let i = 0; i < BIDX.count; i++) {
    const v = BIDX.getX(i)
    const x = BPOS.getX(v)
    const y = BPOS.getY(v)
    const z = BPOS.getZ(v)
    out[i * 3] = rows[m] * x + rows[m + 1] * y + rows[m + 2] * z + rows[m + 3]
    out[i * 3 + 1] = rows[m + 4] * x + rows[m + 5] * y + rows[m + 6] * z + rows[m + 7]
    out[i * 3 + 2] = rows[m + 8] * x + rows[m + 9] * y + rows[m + 10] * z + rows[m + 11]
  }
  return out
}

/** The height of the blanket's upper skin at (x, z): the highest of the triangles above that point that face up; -Infinity where there is none. */
function skinAt(tris: Float32Array, x: number, z: number): number {
  let best = -Infinity
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t]
    const az = tris[t + 2]
    const bx = tris[t + 3]
    const bz = tris[t + 5]
    const cx = tris[t + 6]
    const cz = tris[t + 8]
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(d) < 1e-12) continue
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
    const l3 = 1 - l1 - l2
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
    // the triangle's normal (up is +y): only the skin that faces up is the top of the blanket
    const ux = bx - ax
    const uz = bz - az
    const vx = cx - ax
    const vz = cz - az
    const ny = uz * vx - ux * vz
    if (ny <= 0) continue
    best = Math.max(best, l1 * tris[t + 1] + l2 * tris[t + 4] + l3 * tris[t + 7])
  }
  return best
}

/** Parts that make the legs, the feet and the hips of a lying body. */
const COVERED_PARTS: readonly number[] = [P.pelvis, P.thighL, P.thighR, P.shinL, P.shinR, P.footL, P.footR]
/** The hip line: the blanket must cover the pelvis from here to the feet (the belly and chest above it may rise out of the blanket's rounded top). */
const HIPS_Z = -0.06

/** How much lower than the blanket's skin the highest uncovered point is, and the smallest margin; `worst` names the vertex. */
function coverage(m: CpuMesh, skinned: Float32Array, tris: Float32Array): { margin: number; outside: number; worst: string } {
  let margin = Infinity
  let outside = 0
  let worst = ''
  for (let v = 0; v < m.count; v++) {
    const part = Math.round(m.joints[v * 4])
    if (!COVERED_PARTS.includes(part)) continue
    const x = skinned[v * 3]
    const y = skinned[v * 3 + 1]
    const z = skinned[v * 3 + 2]
    if (part === P.pelvis && z < HIPS_Z) continue
    const top = skinAt(tris, x, z)
    if (top === -Infinity) {
      outside++
      worst = `part ${part} at x ${x.toFixed(2)} z ${z.toFixed(2)} is outside the blanket's footprint`
      continue
    }
    if (top - y < margin) {
      margin = top - y
      worst = `part ${part} at x ${x.toFixed(2)} z ${z.toFixed(2)}: skin ${top.toFixed(3)} vertex ${y.toFixed(3)}`
    }
  }
  return { margin, outside, worst }
}

const SURFACES = [
  ['ward bed', MATTRESS.top],
  ['ER trolley', TROLLEY.top],
  ['stretcher', LIE.stretcher],
] as const

describe('the real mattress tops', () => {
  it('are the heights the beds are built to, and the crowd lies on them', () => {
    expect(LIE.bed).toBe(MATTRESS.top)
    expect(LIE.trolley).toBe(TROLLEY.top)
    expect(MATTRESS.top).toBeCloseTo(0.49, 9)
    expect(TROLLEY.top).toBeCloseTo(0.44, 9)
    expect(LIE.stretcher).toBeCloseTo(0.79, 9)
  })
})

describe('every avatar lying in a bed, on a trolley and on a stretcher, skinned as the shader does', () => {
  for (const a of index.avatars) {
    it(`${a.id}: the back rests 1 to 4 cm in the mattress; the blanket stands above every leg, foot and hip vertex, flat and reclined, at every size`, async () => {
      const m = cpuMesh(await loadBody(a, 0))
      // the back sunk into the mattress: on all three real surfaces, at the nominal size
      for (const [name, surface] of SURFACES) {
        const { rows } = lying(a, { surface })
        const sink = surface - lowest(m, skinAll(m, rows), [P.pelvis, P.chest])
        expect(sink, `${name}: back into the mattress`).toBeGreaterThan(0.01)
        expect(sink, `${name}: back into the mattress`).toBeLessThan(0.04)
      }
      // at the smallest and the largest person the back stays in the mattress (the body scales, the mattress does not)
      for (const scale of [0.94, 1.06]) {
        const { rows } = lying(a, { surface: MATTRESS.top, scale })
        const sink = MATTRESS.top - lowest(m, skinAll(m, rows), [P.pelvis, P.chest])
        expect(sink, `size ${scale}: back into the mattress`).toBeGreaterThan(0.002)
        expect(sink, `size ${scale}: back into the mattress`).toBeLessThan(0.055)
      }
      // the blanket over the legs, the feet and the hips: flat, with the bed head raised, and at the smallest and largest size
      let tightest = Infinity
      for (const recline of [0, 1]) {
        for (const scale of [0.94, 1, 1.06]) {
          for (const surface of [MATTRESS.top, LIE.stretcher]) {
            const { rows } = lying(a, { surface, recline, scale })
            const c = coverage(m, skinAll(m, rows), blanketTriangles(rows))
            expect(c.outside, `recline ${recline} size ${scale} surface ${surface}: ${c.worst}`).toBe(0)
            expect(c.margin, `recline ${recline} size ${scale} surface ${surface}: ${c.worst}`).toBeGreaterThan(0)
            tightest = Math.min(tightest, c.margin)
          }
        }
      }
      // the soft top is a little above the legs, not a tent: at the tightest point still within 12 cm
      expect(tightest, `${a.id} tightest margin`).toBeLessThan(0.12)
    })
  }
})

describe('the reclined torso rides on the backrest', () => {
  it('keeps every avatar\'s chest on the slab (at most 5.5 cm in it, at most 3.5 cm over it), lifts the hips by at most the limit and leaves the feet where they were', async () => {
    const phi = RECLINE_MAX
    // the backrest's top plane in (z toward the feet, y up): through the hinge, tilted so that the head end rises
    const hingeZ = BACKREST.hingeDv
    const n = [Math.sin(phi), Math.cos(phi)]
    const e = MATTRESS.top - BACKREST.hingeY
    for (const a of index.avatars) {
      const m = cpuMesh(await loadBody(a, 0))
      const flat = lying(a, { surface: MATTRESS.top })
      const { rows, lift } = lying(a, { surface: MATTRESS.top, recline: 1 })
      expect(flat.lift, a.id).toBe(0)
      expect(lift, a.id).toBeGreaterThan(0.02)
      expect(lift, a.id).toBeLessThanOrEqual(0.045 + 1e-9)
      const skinned = skinAll(m, rows)
      const skinnedFlat = skinAll(m, flat.rows)
      // the pelvis rides up by the lift, the feet stay planted: the legs slope up to the hips, under the blanket
      expect(lowest(m, skinned, [P.pelvis]) - lowest(m, skinnedFlat, [P.pelvis]), `${a.id} hips`).toBeGreaterThan(lift - 0.012)
      expect(lowest(m, skinned, [P.pelvis]) - lowest(m, skinnedFlat, [P.pelvis]), `${a.id} hips`).toBeLessThan(lift + 0.012)
      expect(Math.abs(lowest(m, skinned, [P.footL, P.footR]) - lowest(m, skinnedFlat, [P.footL, P.footR])), `${a.id} heels`).toBeLessThan(0.006)
      // the lowest signed distance of the chest's vertices behind the hinge from the slab's top plane (negative: inside the slab); the chest's back is a few
      // cm higher than the buttocks the fit rests on the mattress, so it lies within a couple of cm of the slab either way
      let lowD = Infinity
      for (let v = 0; v < m.count; v++) {
        if (Math.round(m.joints[v * 4]) !== P.chest) continue
        const z = skinned[v * 3 + 2]
        if (z > hingeZ - 0.2) continue
        const d = n[0] * (z - hingeZ) + n[1] * (skinned[v * 3 + 1] - BACKREST.hingeY) - e
        lowD = Math.min(lowD, d)
      }
      expect(-lowD, `${a.id} chest in the slab`).toBeLessThan(0.055)
      expect(-lowD, `${a.id} chest not hovering over the slab`).toBeGreaterThan(-0.035)
    }
  })
})

describe('the blanket', () => {
  it('is one geometry of about 300 triangles with its normals up, inside the bed, from the chest to the feet', () => {
    expect(BIDX.count / 3).toBeLessThanOrEqual(320)
    expect(BIDX.count / 3).toBeGreaterThan(150)
    const nrm = blanketGeo.getAttribute('normal')
    let up = 0
    let total = 0
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < BPOS.count; i++) {
      expect(Number.isFinite(BPOS.getX(i) + BPOS.getY(i) + BPOS.getZ(i) + nrm.getX(i) + nrm.getY(i) + nrm.getZ(i))).toBe(true)
      minX = Math.min(minX, BPOS.getX(i))
      maxX = Math.max(maxX, BPOS.getX(i))
      minZ = Math.min(minZ, BPOS.getZ(i))
      maxZ = Math.max(maxZ, BPOS.getZ(i))
      maxY = Math.max(maxY, BPOS.getY(i))
      if (BPOS.getY(i) > 0.15) {
        total++
        if (nrm.getY(i) > 0) up++
      }
    }
    expect(up / total, 'the top of the blanket faces up').toBeGreaterThan(0.99)
    expect(minX).toBeGreaterThanOrEqual(-BLANKET.halfWidth - 1e-6)
    expect(maxX).toBeLessThanOrEqual(BLANKET.halfWidth + 1e-6)
    expect(minZ).toBeCloseTo(BLANKET.zHead, 6)
    expect(maxZ).toBeCloseTo(BLANKET.zFoot, 6)
    // narrower than the ward mattress, so the blanket never hangs over a bed; the stretcher's rails are at 0.37 m
    expect(BLANKET.halfWidth).toBeLessThan(MATTRESS.w / 2)
    expect(maxY).toBeLessThan(0.5)
    // it stays clear of the foot board (0.96 + 0.02 m from the hips)
    expect(BLANKET.zFoot).toBeLessThan(MATTRESS.l / 2 + 0.05)
  })
})
