// R5 (geometry agent): a test kit, not shipped. The needles against the skin as the stage fits it: the exact distance from a point to the skinned triangles, where a needle's shaft first
// meets the skin, and whether a point is inside the body. All in the PATIENT's frame the field uses (x across, h above the pad, z toward the feet); a room point is carried in by
// `roomToPatient`. Nothing here is per frame.
import { CRYO_SUITE } from '@/sim/places'
import type { ProcSkin } from './stage'

const T = CRYO_SUITE.ct.table

/** A CT-room point (sim x, y, z; the table OUT) in the patient's frame: [x across (the patient's left when supine: north), h above the pad, z toward the feet]. */
export function roomToPatient(px: number, py: number, pz: number, out: Float64Array, o = 0): void {
  out[o] = -(pz - T.out.z)
  out[o + 1] = py - T.height
  out[o + 2] = px - T.out.x
}

/** The distance from (x, h, z) to the nearest point of the skin's triangles (Ericson's closest point on a triangle); `Infinity` for an empty skin. */
export function distanceToSkin(skin: Pick<ProcSkin, 'v' | 'index' | 'tris'>, x: number, h: number, z: number): number {
  const v = skin.v
  const ix = skin.index
  let best2 = Infinity
  for (let t = 0; t < skin.tris; t++) {
    const a = ix[t * 3] * 3
    const b = ix[t * 3 + 1] * 3
    const c = ix[t * 3 + 2] * 3
    // (the triangle's box against the best so far)
    const lox = Math.min(v[a], v[b], v[c])
    const hix = Math.max(v[a], v[b], v[c])
    const loy = Math.min(v[a + 1], v[b + 1], v[c + 1])
    const hiy = Math.max(v[a + 1], v[b + 1], v[c + 1])
    const loz = Math.min(v[a + 2], v[b + 2], v[c + 2])
    const hiz = Math.max(v[a + 2], v[b + 2], v[c + 2])
    const bx = x < lox ? lox - x : x > hix ? x - hix : 0
    const by = h < loy ? loy - h : h > hiy ? h - hiy : 0
    const bz = z < loz ? loz - z : z > hiz ? z - hiz : 0
    if (bx * bx + by * by + bz * bz >= best2) continue
    const d2 = pointTriangle2(x, h, z, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2])
    if (d2 < best2) best2 = d2
  }
  return Math.sqrt(best2)
}

/** The squared distance from p to the triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTriangle2(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3)
    const qx = apx - abx * t, qy = apy - aby * t, qz = apz - abz * t
    return qx * qx + qy * qy + qz * qz
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6)
    const qx = apx - acx * t, qy = apy - acy * t, qz = apz - acz * t
    return qx * qx + qy * qy + qz * qz
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6))
    const qx = px - (bx + (cx - bx) * t), qy = py - (by + (cy - by) * t), qz = pz - (bz + (cz - bz) * t)
    return qx * qx + qy * qy + qz * qz
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  const qx = apx - (abx * v + acx * w), qy = apy - (aby * v + acy * w), qz = apz - (abz * v + acz * w)
  return qx * qx + qy * qy + qz * qz
}

/**
 * The first place the segment from (ax, ah, az) to (bx, bh, bz) meets the skin, as a fraction 0..1 of it (Moller-Trumbore on every triangle), or -1 when it never does (it lies wholly
 * outside or wholly inside). The crossing of a needle's shaft: the segment runs from a little outside the entry to the tip.
 */
export function firstSkinCrossing(skin: Pick<ProcSkin, 'v' | 'index' | 'tris'>, ax: number, ah: number, az: number, bx: number, bh: number, bz: number): number {
  const v = skin.v
  const ix = skin.index
  const dx = bx - ax, dy = bh - ah, dz = bz - az
  let best = -1
  for (let t = 0; t < skin.tris; t++) {
    const i0 = ix[t * 3] * 3
    const i1 = ix[t * 3 + 1] * 3
    const i2 = ix[t * 3 + 2] * 3
    const e1x = v[i1] - v[i0], e1y = v[i1 + 1] - v[i0 + 1], e1z = v[i1 + 2] - v[i0 + 2]
    const e2x = v[i2] - v[i0], e2y = v[i2 + 1] - v[i0 + 1], e2z = v[i2 + 2] - v[i0 + 2]
    const px = dy * e2z - dz * e2y
    const py = dz * e2x - dx * e2z
    const pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-14) continue
    const inv = 1 / det
    const sx = ax - v[i0], sy = ah - v[i0 + 1], sz = az - v[i0 + 2]
    const u = (sx * px + sy * py + sz * pz) * inv
    if (u < 0 || u > 1) continue
    const qx = sy * e1z - sz * e1y
    const qy = sz * e1x - sx * e1z
    const qz = sx * e1y - sy * e1x
    const w = (dx * qx + dy * qy + dz * qz) * inv
    if (w < 0 || u + w > 1) continue
    const k = (e2x * qx + e2y * qy + e2z * qz) * inv
    if (k < 0 || k > 1) continue
    if (best < 0 || k < best) best = k
  }
  return best
}

/** How many times the segment meets the skin (a point inside a closed body is at an odd count from outside): used with a point far outside along +h. */
export function skinCrossings(skin: Pick<ProcSkin, 'v' | 'index' | 'tris'>, ax: number, ah: number, az: number, bx: number, bh: number, bz: number): number {
  const v = skin.v
  const ix = skin.index
  const dx = bx - ax, dy = bh - ah, dz = bz - az
  let n = 0
  for (let t = 0; t < skin.tris; t++) {
    const i0 = ix[t * 3] * 3
    const i1 = ix[t * 3 + 1] * 3
    const i2 = ix[t * 3 + 2] * 3
    const e1x = v[i1] - v[i0], e1y = v[i1 + 1] - v[i0 + 1], e1z = v[i1 + 2] - v[i0 + 2]
    const e2x = v[i2] - v[i0], e2y = v[i2 + 1] - v[i0 + 1], e2z = v[i2 + 2] - v[i0 + 2]
    const px = dy * e2z - dz * e2y
    const py = dz * e2x - dx * e2z
    const pz = dx * e2y - dy * e2x
    const det = e1x * px + e1y * py + e1z * pz
    if (Math.abs(det) < 1e-14) continue
    const inv = 1 / det
    const sx = ax - v[i0], sy = ah - v[i0 + 1], sz = az - v[i0 + 2]
    const u = (sx * px + sy * py + sz * pz) * inv
    if (u < 0 || u > 1) continue
    const qx = sy * e1z - sz * e1y
    const qy = sz * e1x - sx * e1z
    const qz = sx * e1y - sy * e1x
    const w = (dx * qx + dy * qy + dz * qz) * inv
    if (w < 0 || u + w > 1) continue
    const k = (e2x * qx + e2y * qy + e2z * qz) * inv
    if (k < 0 || k > 1) continue
    n++
  }
  return n
}
