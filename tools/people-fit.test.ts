/**
 * The fit of every converted avatar (W3 wave B), on the real meshes: each avatar's LOD 0 skinned on the CPU exactly as the avatar vertex shader does,
 * with the rows the crowd's own rig writes for it (its BodyDims, its bind frames) standing, walking, seated on a 0.45 m chair, lying on a 0.62 m
 * mattress and reclined in a raised bed.
 */
import { describe, expect, it } from 'vitest'
import { P, STAND_CROWN } from '../src/scene/actors/crowd/constants'
import { type AvatarEntry } from '../src/scene/actors/crowd/avatars'
import { cpuMesh, loadBody, readIndex, skinAll, type CpuMesh } from '../src/scene/actors/crowd/avatars.testkit'
import { FIT_BED, FIT_SEAT, avatarRows, transformBy, type V3 } from './people-lib'

const index = readIndex()

/** The lowest and highest skinned y of the vertices whose main part passes `parts` (all when absent), and that pass `keep` (skinned x, z). */
function extent(m: CpuMesh, skinned: Float32Array, parts?: readonly number[], keep: (x: number, z: number, bindY: number) => boolean = () => true): { lo: number; hi: number } {
  let lo = Infinity
  let hi = -Infinity
  for (let v = 0; v < m.count; v++) {
    if (parts && !parts.includes(Math.round(m.joints[v * 4]))) continue
    if (!keep(skinned[v * 3], skinned[v * 3 + 2], m.pos[v * 3 + 1])) continue
    lo = Math.min(lo, skinned[v * 3 + 1])
    hi = Math.max(hi, skinned[v * 3 + 1])
  }
  return { lo, hi }
}

/** The joint of each part in the avatar's bind pose: the translation of B_p (from B_p^-1 = [R^T | -R^T t]). */
function bindJoint(a: AvatarEntry, part: number): V3 {
  const b = a.bindInverse
  const o = part * 12
  // t = -R * t' where R^T is the 3x3 of B^-1 and t' its translation
  const tx = b[o + 3]
  const ty = b[o + 7]
  const tz = b[o + 11]
  return [-(b[o] * tx + b[o + 4] * ty + b[o + 8] * tz), -(b[o + 1] * tx + b[o + 5] * ty + b[o + 9] * tz), -(b[o + 2] * tx + b[o + 6] * ty + b[o + 10] * tz)]
}

const PAIRS: [number, number][] = [
  [P.pelvis, P.chest],
  [P.chest, P.head],
  [P.chest, P.armL],
  [P.chest, P.armR],
  [P.armL, P.foreL],
  [P.armR, P.foreR],
  [P.foreL, P.handL],
  [P.foreR, P.handR],
  [P.pelvis, P.thighL],
  [P.pelvis, P.thighR],
  [P.thighL, P.shinL],
  [P.thighR, P.shinR],
  [P.shinL, P.footL],
  [P.shinR, P.footR],
]

describe('every avatar, posed by the crowd rig and skinned as the shader does', () => {
  for (const a of index.avatars) {
    it(`${a.id}: stands on the floor as tall as fitted, walks above it, sits on its thighs, lies 1 to 4 cm into the mattress, joints whole`, async () => {
      const m = cpuMesh(await loadBody(a, 0))
      // standing: the soles on the floor (within 2 cm), the crown within 2 cm of the fitted STAND_CROWN
      const stand = skinAll(m, avatarRows(a.body, a.bindInverse, 'stand'))
      const all = extent(m, stand)
      expect(Math.abs(all.lo), 'feet on the floor').toBeLessThan(0.02)
      const head = extent(m, stand, [P.head])
      expect(Math.abs(head.hi - STAND_CROWN), 'crown').toBeLessThan(0.02)
      // walking: a stride (the feet lift) never takes the body through the floor
      for (const frames of [70, 85, 100]) {
        const walk = skinAll(m, avatarRows(a.body, a.bindInverse, 'stand', { speed: 1.3, frames }))
        expect(extent(m, walk).lo, `walking, frame ${frames}`).toBeGreaterThan(-0.02)
      }
      // seated on a 0.45 m chair: the buttocks and thighs over the seat rest on it (within 2.5 cm), nothing sinks through
      const sit = skinAll(m, avatarRows(a.body, a.bindInverse, 'sit'))
      const hipY = bindJoint(a, P.thighL)[1]
      const seat = extent(m, sit, [P.pelvis, P.thighL, P.thighR], (x, z, y) => y >= hipY - 0.16 && Math.abs(x) < 0.2 && Math.abs(z) < 0.2)
      expect(seat.lo, 'thighs on the seat').toBeGreaterThan(FIT_SEAT - 0.025)
      expect(seat.lo, 'thighs on the seat').toBeLessThan(FIT_SEAT + 0.01)
      // lying on a 0.62 m mattress: the back 1 to 4 cm into it, the heels resting on it (not hovering, not sunk)
      const lie = skinAll(m, avatarRows(a.body, a.bindInverse, 'lie'))
      const back = extent(m, lie, [P.pelvis, P.chest])
      expect(FIT_BED - back.lo, 'back into the mattress').toBeGreaterThan(0.01)
      expect(FIT_BED - back.lo, 'back into the mattress').toBeLessThan(0.04)
      const heels = extent(m, lie, [P.footL, P.footR])
      expect(Math.abs(heels.lo - (FIT_BED - 0.01)), 'heels on the mattress').toBeLessThan(0.03)
      // reclined (the bed head raised): the hips ride up a little with the backrest (the rig lifts the whole body so the torso keeps its back in the slab, see
      // rig.ts, never more than 11 cm and never down), the head comes up
      const rec = skinAll(m, avatarRows(a.body, a.bindInverse, 'lie', { recline: 1 }))
      const rise = extent(m, rec, [P.pelvis]).lo - extent(m, lie, [P.pelvis]).lo
      expect(rise, 'reclined hips ride up with the backrest').toBeGreaterThanOrEqual(-0.005)
      expect(rise, 'reclined hips ride up with the backrest').toBeLessThan(0.11)
      expect(extent(m, rec, [P.head]).hi, 'reclined head').toBeGreaterThan(extent(m, lie, [P.head]).hi + 0.2)
      // every joint lands at the same point through its parent's frame and its own, in every pose: nothing tears at the skinning seams
      for (const rows of [avatarRows(a.body, a.bindInverse, 'stand', { speed: 1.3, frames: 85 }), avatarRows(a.body, a.bindInverse, 'sit'), avatarRows(a.body, a.bindInverse, 'lie', { recline: 0.6 })]) {
        for (const [parent, child] of PAIRS) {
          const j = bindJoint(a, child)
          const pa = transformBy(rows, parent, j)
          const pb = transformBy(rows, child, j)
          expect(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]), `${a.id} joint ${parent}-${child}`).toBeLessThan(1e-3)
        }
      }
    })
  }
})
