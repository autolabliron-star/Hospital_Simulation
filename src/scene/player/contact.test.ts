/**
 * Contact: a body that TOUCHES a surface (R from it, give or take float rounding) is free to leave it and to slide along it.
 *
 * The bug this guards: the swept-circle test saw a start on the boundary of the grown shape as "inside" it, took the slab entry with the
 * far face's normal and reported a hit at t = 0 for a motion that was leaving the surface (or running along it), so a body that had
 * pressed against a wall could not back away from it, nor walk away at an angle. Here every real static solid (the walls and fences, the
 * beds and furniture boxes and circles) is touched at 10 points along each face (the perimeter for a circle) from R - 1e-9, R, R + 1e-9
 * and R + 1e-4, and the body is asked to go straight away, along the face (both ways) and 30 degrees into it (both ways), 0.2 m each:
 *   - away and along: the whole 0.2 m (progress >= 0.99);
 *   - 30 degrees into a flat face: it slides, keeping sin 30 = 0.5 of the motion (+-0.02);
 *   - 30 degrees into a round thing: the exact ring-following slide (an ODE reference), +-0.02;
 * and it never ends inside the solid it touched. Cases where another solid is in the way (or the floor ends) are skipped, and counted.
 */
import { describe, expect, it } from 'vitest'
import { boxDistance } from './bodyTestKit'
import { SKIN, inRegion, moveBody, newBodyMove } from './collision'
import { GROUP, KIND_CIRCLE, QUERY_CAPACITY, SOLID_STRIDE, queryStatic, staticSolids } from './solids'
import { BODY } from './tuning'

/** The radius of the body's grown circle in `moveBody` (body radius + skin). */
const R = BODY.radius + SKIN
const STEP = 0.2
const ANGLE = Math.PI / 6
const OFFSETS = [-1e-9, 0, 1e-9, 1e-4] as const
const FACE_POINTS = 10
/** The sampling step along a path when asking "is anything else in the way" (the distance field is 1-Lipschitz). */
const SAMPLE = 0.005

type Move = 'away' | 'along+' | 'along-' | 'into+' | 'into-'
const MOVES: readonly Move[] = ['away', 'along+', 'along-', 'into+', 'into-']

/** Where on which solid, and which way is out. */
interface Touch {
  solid: number
  label: string
  /** The point on the surface, the outward unit normal and the unit tangent there. */
  px: number
  pz: number
  nx: number
  nz: number
  tx: number
  tz: number
  /** A face of a box: the half length of the face and the point's position along it (so a slide can be kept inside the face). Round things: ring is the radius r + R, centred (cx, cz). */
  flat: boolean
  halfLen: number
  along: number
  cx: number
  cz: number
  r: number
}

const _idx = new Int32Array(QUERY_CAPACITY)

/** The distance from (x, z) to the nearest static solid other than `skip`, `Infinity` when none is near. */
function clearanceExcept(x: number, z: number, skip: number): number {
  const s = staticSolids()
  const n = queryStatic(x - 1, x + 1, z - 1, z + 1, _idx)
  let best = Infinity
  for (let k = 0; k < n; k++) {
    const i = _idx[k]
    if (i === skip) continue
    const o = i * SOLID_STRIDE
    const d =
      s.data[o] === KIND_CIRCLE
        ? Math.max(Math.hypot(x - s.data[o + 1], z - s.data[o + 2]) - s.data[o + 5], 0)
        : boxDistance(x, z, s.data[o + 1], s.data[o + 2], s.data[o + 3], s.data[o + 4], s.data[o + 5], s.data[o + 6])
    if (d < best) best = d
  }
  return best
}

/** The distance from (x, z) to solid `i` alone (0 inside it). */
function distanceTo(x: number, z: number, i: number): number {
  const s = staticSolids()
  const o = i * SOLID_STRIDE
  return s.data[o] === KIND_CIRCLE
    ? Math.max(Math.hypot(x - s.data[o + 1], z - s.data[o + 2]) - s.data[o + 5], 0)
    : boxDistance(x, z, s.data[o + 1], s.data[o + 2], s.data[o + 3], s.data[o + 4], s.data[o + 5], s.data[o + 6])
}

/** Every touch point: 10 along each face of each box (at the middle of ten equal parts of the face), 10 round each circle. */
function touches(): Touch[] {
  const s = staticSolids()
  const out: Touch[] = []
  for (let i = 0; i < s.count; i++) {
    const o = i * SOLID_STRIDE
    const d = s.data
    const cx = d[o + 1]
    const cz = d[o + 2]
    if (d[o] === KIND_CIRCLE) {
      const r = d[o + 5]
      for (let k = 0; k < FACE_POINTS; k++) {
        const a = ((k + 0.37) / FACE_POINTS) * Math.PI * 2
        const nx = Math.cos(a)
        const nz = Math.sin(a)
        out.push({ solid: i, label: `${s.ids[i]} (circle) at ${((a * 180) / Math.PI).toFixed(0)} deg`, px: cx + nx * r, pz: cz + nz * r, nx, nz, tx: -nz, tz: nx, flat: false, halfLen: 0, along: 0, cx, cz, r })
      }
      continue
    }
    const ux = d[o + 3]
    const uz = d[o + 4]
    const vx = -uz
    const vz = ux
    const hu = d[o + 5]
    const hv = d[o + 6]
    // the four faces: normal +-u (the face's length is 2 hv, along v) and +-v (length 2 hu, along u)
    for (const [fnx, fnz, ftx, ftz, off, half, name] of [
      [ux, uz, vx, vz, hu, hv, '+u'],
      [-ux, -uz, vx, vz, hu, hv, '-u'],
      [vx, vz, ux, uz, hv, hu, '+v'],
      [-vx, -vz, ux, uz, hv, hu, '-v'],
    ] as const) {
      for (let k = 0; k < FACE_POINTS; k++) {
        const along = -half + ((k + 0.5) / FACE_POINTS) * 2 * half
        out.push({
          solid: i,
          label: `${s.ids[i]} (box) face ${name} at ${along.toFixed(2)} of +-${half.toFixed(2)}`,
          px: cx + fnx * off + ftx * along,
          pz: cz + fnz * off + ftz * along,
          nx: fnx,
          nz: fnz,
          tx: ftx,
          tz: ftz,
          flat: true,
          halfLen: half,
          along,
          cx,
          cz,
          r: 0,
        })
      }
    }
  }
  return out
}

/** The unit direction of a move. */
function dirOf(t: Touch, m: Move, out: { x: number; z: number }): void {
  const c = Math.cos(ANGLE)
  const sn = Math.sin(ANGLE)
  switch (m) {
    case 'away':
      out.x = t.nx
      out.z = t.nz
      return
    case 'along+':
      out.x = t.tx
      out.z = t.tz
      return
    case 'along-':
      out.x = -t.tx
      out.z = -t.tz
      return
    case 'into+': // 30 degrees off the way into the face, towards +t
      out.x = -t.nx * c + t.tx * sn
      out.z = -t.nz * c + t.tz * sn
      return
    case 'into-':
      out.x = -t.nx * c - t.tx * sn
      out.z = -t.nz * c - t.tz * sn
  }
}

/**
 * The exact slide of a body that starts on the ring (radius `ring`, round the origin) at the outward normal (n0x, n0z), told to go
 * `length` metres along the unit direction (dx, dz): while the direction points into the ring it follows it (the tangential part of
 * the direction), and once it does not it leaves it in a straight line. The share of `length` it ends away from where it began.
 */
function ringProgress(n0x: number, n0z: number, ring: number, dx: number, dz: number, length: number): number {
  const h = 1e-5
  let x = n0x * ring
  let z = n0z * ring
  const x0 = x
  const z0 = z
  let on = true
  for (let u = 0; u < length - 1e-12; u += h) {
    if (on) {
      const len = Math.hypot(x, z)
      const nx = x / len
      const nz = z / len
      const into = dx * nx + dz * nz
      if (into < 0) {
        x += (dx - into * nx) * h
        z += (dz - into * nz) * h
        const l = Math.hypot(x, z)
        x = (x / l) * ring
        z = (z / l) * ring
        continue
      }
      on = false
    }
    x += dx * h
    z += dz * h
  }
  return Math.hypot(x - x0, z - z0) / length
}

const _d = { x: 0, z: 0 }

/**
 * Can this move be judged on the solid alone? Nothing else static within R of the body anywhere on the path it can take (the command
 * line for away and along, the tangent line for a slide: and for a round thing the arc too), and the floor does not end on the way.
 */
function pathIsClear(t: Touch, m: Move): boolean {
  dirOf(t, m, _d)
  const sliding = m === 'into+' || m === 'into-'
  // the line the body can actually travel: the command for away / along, the tangent for a slide
  const lx = sliding ? (m === 'into+' ? t.tx : -t.tx) : _d.x
  const lz = sliding ? (m === 'into+' ? t.tz : -t.tz) : _d.z
  const base = (u: number, off: number): [number, number] => [t.px + t.nx * (R + off) + lx * u, t.pz + t.nz * (R + off) + lz * u]
  for (let u = 0; u <= STEP + 1e-9; u += SAMPLE) {
    const [x, z] = base(u, 0)
    if (!inRegion(x, z)) return false
    if (clearanceExcept(x, z, t.solid) < R - 1e-6) return false
  }
  if (sliding && !t.flat) {
    // the ring itself, as far round as the slide can go (the body can be as near as the ring, 1e-4 closer than the tangent line is not)
    const ring = t.r + R
    const sign = m === 'into+' ? 1 : -1
    const span = STEP / ring
    for (let a = 0; a <= span + 1e-9; a += SAMPLE / ring) {
      const c = Math.cos(a)
      const sn = Math.sin(a) * sign
      // rotate the outward normal by a * sign
      const nx = t.nx * c - t.nz * sn
      const nz = t.nx * sn + t.nz * c
      const x = t.cx + nx * ring
      const z = t.cz + nz * ring
      if (!inRegion(x, z)) return false
      if (clearanceExcept(x, z, t.solid) < R - 1e-6) return false
    }
  }
  return true
}

describe('contact: a body touching a surface can always leave it and slide along it', () => {
  it('every static solid, 10 points a face, at R - 1e-9, R, R + 1e-9 and R + 1e-4: straight away and along are free, 30 degrees into it slides', () => {
    const all = touches()
    const s = staticSolids()
    const out = newBodyMove()
    const counts: Record<Move, { ran: number; skipped: number }> = { away: { ran: 0, skipped: 0 }, 'along+': { ran: 0, skipped: 0 }, 'along-': { ran: 0, skipped: 0 }, 'into+': { ran: 0, skipped: 0 }, 'into-': { ran: 0, skipped: 0 } }
    const fails: string[] = []
    const failKinds = new Map<string, number>()
    const fail = (kind: string, text: string): void => {
      fails.push(text)
      failKinds.set(kind, (failKinds.get(kind) ?? 0) + 1)
    }
    let walls = 0
    let furniture = 0
    let worstFree = 1
    let worstSlide = 0
    let spotsSkipped = 0

    for (const t of all) {
      // the spot itself must be somewhere you can stand (inside the floor, and clear of every OTHER solid)
      const sx = t.px + t.nx * R
      const sz = t.pz + t.nz * R
      if (!inRegion(sx, sz) || clearanceExcept(sx, sz, t.solid) < R - 1e-6) {
        spotsSkipped++
        for (const m of MOVES) counts[m].skipped++
        continue
      }
      for (const m of MOVES) {
        const sliding = m === 'into+' || m === 'into-'
        let skip = !pathIsClear(t, m)
        // a slide on a flat face must stay on the face: past its end the body goes round the rounded corner, which is another (longer) slide
        if (!skip && sliding && t.flat) {
          const travel = STEP * Math.sin(ANGLE) + 0.005
          const end = m === 'into+' ? t.along + travel : t.along - travel
          if (end > t.halfLen || end < -t.halfLen) skip = true
        }
        if (skip) {
          counts[m].skipped++
          continue
        }
        counts[m].ran++
        dirOf(t, m, _d)
        const dx = _d.x * STEP
        const dz = _d.z * STEP
        const want = sliding ? (t.flat ? Math.sin(ANGLE) : ringProgress(t.nx, t.nz, t.r + R, _d.x, _d.z, STEP)) : 1
        for (const off of OFFSETS) {
          const x = t.px + t.nx * (R + off)
          const z = t.pz + t.nz * (R + off)
          moveBody(x, z, dx, dz, out)
          const progress = Math.min(1, Math.hypot(out.x - x, out.z - z) / STEP)
          const gap = distanceTo(out.x, out.z, t.solid)
          const tag = `${t.label}, ${m}, start R${off === 0 ? '' : off > 0 ? '+' : '-'}${off === 0 ? '' : Math.abs(off).toExponential(0)}`
          if (sliding) {
            worstSlide = Math.max(worstSlide, Math.abs(progress - want))
            if (Math.abs(progress - want) > 0.02) fail(`${m} R${off}`, `${tag}: progress ${progress.toFixed(4)}, expected ${want.toFixed(4)} +- 0.02`)
          } else {
            worstFree = Math.min(worstFree, progress)
            if (progress < 0.99) fail(`${m} R${off}`, `${tag}: progress ${progress.toFixed(4)}, expected >= 0.99`)
          }
          // never ends inside the solid it touched (the start may be a hair inside, by 1e-9)
          if (gap < R - 1e-8) fail(`${m} inside`, `${tag}: ends ${gap.toFixed(9)} from the surface, inside R = ${R}`)
          if (s.group[t.solid] === GROUP.wall) walls++
          else furniture++
        }
      }
    }

    const lines = MOVES.map((m) => `${m}: ${counts[m].ran} touch points ran (x ${OFFSETS.length} start distances), ${counts[m].skipped} skipped`)
    // eslint-disable-next-line no-console
    console.log(
      `contact: ${s.count} static solids, ${all.length} touch points (${spotsSkipped} unstandable); ${lines.join('; ')}; ${walls} wall and ${furniture} furniture moves; worst free progress ${worstFree.toFixed(5)}, worst slide deviation ${worstSlide.toFixed(5)}`,
    )
    if (fails.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`contact failures by kind: ${[...failKinds.entries()].map(([k, n]) => `${k}: ${n}`).join(', ')}`)
    }
    expect(fails.slice(0, 12), `${fails.length} failures`).toEqual([])
    // the real building was covered, on every kind of move, on walls and on furniture
    for (const m of MOVES) expect(counts[m].ran, m).toBeGreaterThan(500)
    expect(walls).toBeGreaterThan(5000)
    expect(furniture).toBeGreaterThan(5000)
  })

  it('the reference slide on a ring agrees with the flat-face answer in the limit (a large ring is a flat wall: 0.5 at 30 degrees)', () => {
    expect(ringProgress(0, 1, 1000, Math.sin(ANGLE), -Math.cos(ANGLE), STEP)).toBeCloseTo(0.5, 3)
    // a body that points along the tangent leaves the ring at once
    expect(ringProgress(0, 1, 0.5, 1, 0, STEP)).toBeCloseTo(1, 9)
  })
})
