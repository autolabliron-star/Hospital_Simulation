/**
 * W4: the lab's sample track as pure geometry, shared by the sim (puck positions, module stops) and the scene (where pucks and tubes are
 * drawn). Contract glue, owned by the orchestrator. Built once at import; `labTrackPointInto` allocates nothing.
 *
 * The track is one closed loop: the OUTBOUND lane runs along the U on the module (outer) side from its start by the receive station to the end
 * of the east leg, a turntable crosses to the RETURN lane (inner side), which runs back along the U to the start, and a second turntable
 * closes the loop. Pucks only move forward (s grows, wrapping at `LAB_LOOP_LENGTH`). Module stops are on the outbound lane.
 */
import { LAB } from './places'
import type { Vec2 } from './types'

const STEP = 0.05

/** The U's centre line, sampled every STEP (arcs included). */
function centreLine(): Vec2[] {
  const t = LAB.track
  const r = LAB.turnRadius
  const out: Vec2[] = []
  const line = (a: Vec2, b: Vec2) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.max(1, Math.ceil(len / STEP))
    for (let i = 0; i < n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n })
  }
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / STEP))
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      out.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r })
    }
  }
  // west leg, south-west arc (centre (-29.7, 20.7)), south leg, south-east arc (centre (-26.25, 20.7)), east leg
  line(t[0], t[1])
  arc(t[2].x, t[1].z, Math.PI, Math.PI / 2)
  line(t[2], t[3])
  arc(t[3].x, t[4].z, Math.PI / 2, 0)
  line(t[4], t[5])
  out.push({ ...t[5] })
  return out
}

/** The loop's sample points and cumulative lengths. */
function buildLoop(): { x: Float64Array; z: Float64Array; cum: Float64Array; outboundLength: number } {
  const c = centreLine()
  const half = LAB.laneGap / 2
  const outer: Vec2[] = []
  for (let i = 0; i < c.length; i++) {
    const a = c[Math.max(0, i - 1)]
    const b = c[Math.min(c.length - 1, i + 1)]
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
    const dx = (b.x - a.x) / len
    const dz = (b.z - a.z) / len
    // outer side = (-dz, dx) for this U's direction of travel (see the module comment)
    outer.push({ x: c[i].x - dz * half, z: c[i].z + dx * half })
  }
  const inner: Vec2[] = []
  for (let i = c.length - 1; i >= 0; i--) {
    const a = c[Math.max(0, i - 1)]
    const b = c[Math.min(c.length - 1, i + 1)]
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
    const dx = (b.x - a.x) / len
    const dz = (b.z - a.z) / len
    inner.push({ x: c[i].x + dz * half, z: c[i].z - dx * half })
  }
  const pts = [...outer, ...inner, outer[0]]
  const x = new Float64Array(pts.length)
  const z = new Float64Array(pts.length)
  const cum = new Float64Array(pts.length)
  for (let i = 0; i < pts.length; i++) {
    x[i] = pts[i].x
    z[i] = pts[i].z
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1])
  }
  return { x, z, cum, outboundLength: cum[outer.length - 1] }
}

const LOOP = buildLoop()
export const LAB_LOOP_LENGTH: number = LOOP.cum[LOOP.cum.length - 1]
/** Where the outbound lane ends (the far turntable): stops are all before this. */
export const LAB_OUTBOUND_LENGTH: number = LOOP.outboundLength

/** The point `s` metres along the loop (wrapping), on the floor plane; y is LAB.benchY. Writes into `out`. */
export function labTrackPointInto(s: number, out: Vec2): Vec2 {
  const L = LAB_LOOP_LENGTH
  let ss = s % L
  if (ss < 0) ss += L
  const cum = LOOP.cum
  let lo = 0
  let hi = cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= ss) lo = mid
    else hi = mid
  }
  const seg = cum[hi] - cum[lo]
  const t = seg > 1e-9 ? (ss - cum[lo]) / seg : 0
  out.x = LOOP.x[lo] + (LOOP.x[hi] - LOOP.x[lo]) * t
  out.z = LOOP.z[lo] + (LOOP.z[hi] - LOOP.z[lo]) * t
  return out
}

/** The direction of travel at `s` (unit, floor plane). Writes into `out`. */
export function labTrackDirInto(s: number, out: Vec2): Vec2 {
  const ax = labTrackPointInto(s - 0.02, _a).x
  const az = _a.z
  labTrackPointInto(s + 0.02, _b)
  const len = Math.hypot(_b.x - ax, _b.z - az) || 1
  out.x = (_b.x - ax) / len
  out.z = (_b.z - az) / len
  return out
}
const _a: Vec2 = { x: 0, z: 0 }
const _b: Vec2 = { x: 0, z: 0 }

/** The outbound-lane stop of each module (metres along the loop): the point of the outbound lane nearest its `at`. */
export const LAB_STOPS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    LAB.modules.map((m) => {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < LOOP.cum.length && LOOP.cum[i] <= LAB_OUTBOUND_LENGTH; i++) {
        const d = Math.hypot(LOOP.x[i] - m.at.x, LOOP.z[i] - m.at.z)
        if (d < bestD) {
          bestD = d
          best = LOOP.cum[i]
        }
      }
      return [m.id, best]
    }),
  ),
)
