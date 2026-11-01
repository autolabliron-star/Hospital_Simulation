// A test kit, not shipped: building a stage for a patient pose in node, and reading its parts back in the table's own frame.
import type { PortLayout } from '@/sim/places'
import { emptyPatientPose } from '@/sim/procedure/empty'
import type { PatientMarks, PatientPoseView, PatientPosition } from '@/sim/types'
import { CX, CZ, TOP } from './frame'
import { portSitesInto } from './ports'
import { LEG_BINS } from './envelope'
import { ringFrameInto } from './legFrame'
import { fitIndexOf } from './fit'
import { newStageMemory, stepStage, type StageIn, type StageMemory } from './stage'

export interface StageCase {
  mem: StageMemory
  sites: Float64Array
  patient: PatientPoseView
  input: StageIn
}

export interface StageOptions {
  position?: PatientPosition
  layout?: PortLayout
  prep?: number
  drape?: number
  marks?: PatientMarks
  docked?: number
  tilt?: number
  roll?: number
  /** The body the drapes fit (an avatar id with a fit; none: the union of the avatars) and its size. */
  fit?: { id: string; scale: number }
}

/** A stage after one step of a patient in the given state (the layout defaults to the one the position goes with: lithotomy transverse, supine oblique). */
export function stageCase(o: StageOptions = {}): StageCase {
  const patient = emptyPatientPose()
  patient.position = o.position ?? 'supine'
  patient.prep = o.prep ?? 1
  patient.drape = o.drape ?? 1
  patient.marks = o.marks ?? 'none'
  patient.headTiltDeg = o.tilt ?? 0
  patient.rollDeg = o.roll ?? 0
  const sites = new Float64Array(10)
  portSitesInto(o.layout ?? (patient.position === 'lithotomy' ? 'transverse' : 'oblique'), sites)
  const mem = newStageMemory()
  const input: StageIn = { patient, sites, docked: o.docked ?? 0, dt: 1 / 60, fitAvatar: o.fit ? fitIndexOf(o.fit.id) : -1, fitScale: o.fit?.scale ?? 1 }
  stepStage(mem, input)
  return { mem, sites, patient, input }
}

/** The triangles of some parts as nine floats each: x, h, d of the corners, in the LEVEL table's frame (`h` above the pad's top). */
export function partTriangles(mem: StageMemory, parts: readonly number[]): Float32Array {
  const m = mem.mesh
  let n = 0
  for (const p of parts) n += mem.parts[p * 2 + 1] - mem.parts[p * 2]
  const out = new Float32Array(n * 3)
  let o = 0
  for (const p of parts) {
    for (let i = mem.parts[p * 2]; i < mem.parts[p * 2 + 1]; i++) {
      const v = m.idx[i] * 3
      out[o++] = m.pos[v] - CX
      out[o++] = m.pos[v + 1] - TOP
      out[o++] = m.pos[v + 2] - CZ
    }
  }
  return out
}

/** The vertex range [first, last] of a part (by its indices); null when it has none. */
export function partVertexRange(mem: StageMemory, part: number): [number, number] | null {
  let lo = Infinity
  let hi = -1
  for (let i = mem.parts[part * 2]; i < mem.parts[part * 2 + 1]; i++) {
    const v = mem.mesh.idx[i]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return hi < 0 ? null : [lo, hi]
}

/** A vertex of the mesh in the table's frame (x, h, d). */
export function vertexOf(mem: StageMemory, v: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  out[0] = mem.mesh.pos[v * 3] - CX
  out[1] = mem.mesh.pos[v * 3 + 1] - TOP
  out[2] = mem.mesh.pos[v * 3 + 2] - CZ
  return out
}

/** The faces of a part as [centroid x, h, d] and the unit normal (x, h, d), by their winding. */
export function faces(c: StageCase, part: number): { c: [number, number, number]; n: [number, number, number] }[] {
  const t = partTriangles(c.mem, [part])
  const out: { c: [number, number, number]; n: [number, number, number] }[] = []
  for (let i = 0; i < t.length; i += 9) {
    const ux = t[i + 3] - t[i], uh = t[i + 4] - t[i + 1], ud = t[i + 5] - t[i + 2]
    const vx = t[i + 6] - t[i], vh = t[i + 7] - t[i + 1], vd = t[i + 8] - t[i + 2]
    let nx = uh * vd - ud * vh, nh = ud * vx - ux * vd, nd = ux * vh - uh * vx
    const l = Math.hypot(nx, nh, nd)
    if (l < 1e-12) continue
    nx /= l; nh /= l; nd /= l
    out.push({ c: [(t[i] + t[i + 3] + t[i + 6]) / 3, (t[i + 1] + t[i + 4] + t[i + 7]) / 3, (t[i + 2] + t[i + 5] + t[i + 8]) / 3], n: [nx, nh, nd] })
  }
  return out
}

/** The left sleeve's ring polygon at table-frame d (the part's rings, blended between two), as 16 (x, h) points. */
export function ringAt(c: StageCase, part: number, d: number): [number, number][] | null {
  const r = partVertexRange(c.mem, part)
  if (r === null) return null
  const rings = (r[1] - r[0] + 1 - 2) / LEG_BINS
  let k = 0
  for (; k < rings - 1; k++) {
    const a = vertexOf(c.mem, r[0] + (k + 1) * LEG_BINS)
    if (a[2] > d) break
  }
  if (k >= rings - 1) k = rings - 2
  const dA = vertexOf(c.mem, r[0] + k * LEG_BINS)[2]
  const dB = vertexOf(c.mem, r[0] + (k + 1) * LEG_BINS)[2]
  if (d < dA - 1e-9 || d > dB + 1e-9) return null
  const t = dB > dA ? (d - dA) / (dB - dA) : 0
  const out: [number, number][] = []
  for (let j = 0; j < LEG_BINS; j++) {
    const a = vertexOf(c.mem, r[0] + k * LEG_BINS + j)
    const b = vertexOf(c.mem, r[0] + (k + 1) * LEG_BINS + j)
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}

/** How far inside the polygon (x, h) is: positive inside, negative outside, in metres (distance to the nearest edge). */
export function insideBy(poly: [number, number][], x: number, h: number): number {
  let inside = false
  let nearest = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, hi] = poly[i]
    const [xj, hj] = poly[j]
    if (hi > h !== hj > h && x < ((xj - xi) * (h - hi)) / (hj - hi) + xi) inside = !inside
    const ex = xj - xi
    const eh = hj - hi
    const l2 = ex * ex + eh * eh
    let t = l2 > 0 ? ((x - xi) * ex + (h - hi) * eh) / l2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    nearest = Math.min(nearest, Math.hypot(x - (xi + ex * t), h - (hi + eh * t)))
  }
  return inside ? nearest : -nearest
}

/** A sleeve's rings from the built mesh: per ring its middle (x, h, d, the mean of its vertices) and its LEG_BINS vertices (x, h, d each). Null for a part with none. */
export function sleeveRings(c: StageCase, part: number): { n: number; centre: Float64Array; verts: Float64Array } | null {
  const r = partVertexRange(c.mem, part)
  if (r === null) return null
  const n = (r[1] - r[0] + 1 - 2) / LEG_BINS
  const centre = new Float64Array(n * 3)
  const verts = new Float64Array(n * LEG_BINS * 3)
  const p: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < LEG_BINS; k++) {
      vertexOf(c.mem, r[0] + i * LEG_BINS + k, p)
      for (let q = 0; q < 3; q++) {
        verts[(i * LEG_BINS + k) * 3 + q] = p[q]
        centre[i * 3 + q] += p[q] / LEG_BINS
      }
    }
  }
  return { n, centre, verts }
}

/**
 * How far inside a sleeve the point (`d`, `x`, `h`) of the table frame is, in metres: positive inside (the distance to the nearest edge of the ring there, in the ring's own
 * plane), negative outside, null where the sleeve does not reach. The ring there is the two either side blended; its plane is perpendicular to the sleeve's axis (the rings of a
 * known patient: `perpendicular`) or the plane of constant d (the union of the avatars).
 */
export function insideSleeve(c: StageCase, part: number, d: number, x: number, h: number, perpendicular: boolean): number | null {
  const R = sleeveRings(c, part)
  if (R === null) return null
  const { n, centre, verts } = R
  // each ring's plane: through its middle, perpendicular to the axis there (the two neighbours' direction), or constant d
  const tx = new Float64Array(n)
  const th = new Float64Array(n)
  const td = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    if (!perpendicular) {
      td[k] = 1
      continue
    }
    const a = Math.max(0, k - 1)
    const b = Math.min(n - 1, k + 1)
    let ex = centre[b * 3] - centre[a * 3]
    let eh = centre[b * 3 + 1] - centre[a * 3 + 1]
    let ed = centre[b * 3 + 2] - centre[a * 3 + 2]
    const l = Math.hypot(ex, eh, ed)
    ex /= l
    eh /= l
    ed /= l
    tx[k] = ex
    th[k] = eh
    td[k] = ed
  }
  const sd = (k: number): number => (x - centre[k * 3]) * tx[k] + (h - centre[k * 3 + 1]) * th[k] + (d - centre[k * 3 + 2]) * td[k]
  for (let k = 0; k < n - 1; k++) {
    const s0 = sd(k)
    const s1 = sd(k + 1)
    if (!(s0 >= 0 && s1 < 0)) continue
    const t = s0 / (s0 - s1)
    const cx = centre[k * 3] + (centre[(k + 1) * 3] - centre[k * 3]) * t
    const ch = centre[k * 3 + 1] + (centre[(k + 1) * 3 + 1] - centre[k * 3 + 1]) * t
    const cd = centre[k * 3 + 2] + (centre[(k + 1) * 3 + 2] - centre[k * 3 + 2]) * t
    let ax = tx[k] + (tx[k + 1] - tx[k]) * t
    let ah = th[k] + (th[k + 1] - th[k]) * t
    let ad = td[k] + (td[k + 1] - td[k]) * t
    const al = Math.hypot(ax, ah, ad)
    ax /= al
    ah /= al
    ad /= al
    const fr = new Float64Array(6)
    ringFrameInto(ax, ah, ad, fr)
    const poly: [number, number][] = []
    for (let b = 0; b < LEG_BINS; b++) {
      const o0 = (k * LEG_BINS + b) * 3
      const o1 = ((k + 1) * LEG_BINS + b) * 3
      const vx = verts[o0] + (verts[o1] - verts[o0]) * t - cx
      const vh = verts[o0 + 1] + (verts[o1 + 1] - verts[o0 + 1]) * t - ch
      const vd = verts[o0 + 2] + (verts[o1 + 2] - verts[o0 + 2]) * t - cd
      poly.push([vx * fr[0] + vh * fr[1] + vd * fr[2], vx * fr[3] + vh * fr[4] + vd * fr[5]])
    }
    const qx = x - cx
    const qh = h - ch
    const qd = d - cd
    return insideBy(poly, qx * fr[0] + qh * fr[1] + qd * fr[2], qx * fr[3] + qh * fr[4] + qd * fr[5])
  }
  // past the last ring's plane but within the closed end (2.5 cm): judged against the last ring
  const s = sd(n - 1)
  if (n > 1 && s >= 0 && s <= 0.025) {
    const poly: [number, number][] = []
    const fr = new Float64Array(6)
    ringFrameInto(tx[n - 1], th[n - 1], td[n - 1], fr)
    for (let b = 0; b < LEG_BINS; b++) {
      const o = ((n - 1) * LEG_BINS + b) * 3
      const vx = verts[o] - centre[(n - 1) * 3]
      const vh = verts[o + 1] - centre[(n - 1) * 3 + 1]
      const vd = verts[o + 2] - centre[(n - 1) * 3 + 2]
      poly.push([vx * fr[0] + vh * fr[1] + vd * fr[2], vx * fr[3] + vh * fr[4] + vd * fr[5]])
    }
    const qx = x - centre[(n - 1) * 3]
    const qh = h - centre[(n - 1) * 3 + 1]
    const qd = d - centre[(n - 1) * 3 + 2]
    return insideBy(poly, qx * fr[0] + qh * fr[1] + qd * fr[2], qx * fr[3] + qh * fr[4] + qd * fr[5])
  }
  return null
}

/** The height of the highest face of nine-float triangles (x, h, d corners) over (`d`, `x`) exactly (no raster cell): -Infinity where none lies over it. */
export function exactTop(tri: ArrayLike<number>, d: number, x: number): number {
  let best = -Infinity
  for (let t = 0; t + 8 < tri.length; t += 9) {
    const ax = tri[t], ah = tri[t + 1], ad = tri[t + 2]
    const bx = tri[t + 3], bh = tri[t + 4], bd = tri[t + 5]
    const cx = tri[t + 6], ch = tri[t + 7], cd = tri[t + 8]
    const den = (bd - cd) * (ax - cx) + (cx - bx) * (ad - cd)
    if (Math.abs(den) < 1e-14) continue
    const l1 = ((bd - cd) * (x - cx) + (cx - bx) * (d - cd)) / den
    const l2 = ((cd - ad) * (x - cx) + (ax - cx) * (d - cd)) / den
    const l3 = 1 - l1 - l2
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
    best = Math.max(best, l1 * ah + l2 * bh + l3 * ch)
  }
  return best
}
