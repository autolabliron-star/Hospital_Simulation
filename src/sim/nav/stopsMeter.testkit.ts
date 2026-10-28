/**
 * Test kit: counts the stops and slow-downs of walking people in a running simulation and says why each happened, so a stop a real person
 * would make (a queue, a person in the way, a door to take turns at, a talk) can be told from one they would not (pivoting at a sharp turn,
 * braking at the end of one leg of a walk only to set off on the next).
 *
 * Only route walking counts: the time a walker has a route (or has just finished one). Scripted glides (sitting down, standing up, onto a
 * trolley) and standing about are not walking. The speed is the body's, smoothed over about 0.1 s (what the eye sees).
 *   stop        on a route, the speed falls under 0.15 m/s from over 0.6 and comes back over 0.6 (or a route ends and the next begins
 *               within 3 s with nothing done in between: a chained stop)
 *   slow-down   on a route, the speed falls under 0.45 m/s from over 0.8 and comes back over 0.8 without stopping
 * Reasons, the first that held at any time during the episode: held (talking to you), door (taking turns at a single-file door), crowd
 * (someone in the way, a queue, the "never touch" veto), chain (the end of one leg and the start of the next), turn (the heading had to swing
 * round before the walker could go on), corner (the speed limit of a sharp corner), end (braking for the end of the route), other.
 * Unintended: chain, turn, corner, other.
 */
import type { Simulation } from '../Simulation'

const SMOOTH = 0.15

interface FollowerView {
  active: boolean
  idx: number
  n: number
  x: number
  z: number
  px: Float64Array
  pz: Float64Array
  corner: Float64Array
  tail: Float64Array
  heading: number
  speed: number
}

interface WalkerView {
  x: number
  z: number
  f?: FollowerView
  vLim?: number
  gate?: number
  aside?: boolean
}

interface Track {
  x: number
  z: number
  v: number
  moving: boolean
  stopped: boolean
  dip: boolean
  /** When each reason (REASONS order) last held, sim seconds. */
  seen: Float64Array
  /** When the episode under way began. */
  since: number
  anim: string
  arrivedAt: number
  arrivedAnim: string
  wasActive: boolean
  pathSpeed: number
  /** Did anything between two legs (a pose other than walking or standing idle). */
  busy: boolean
  /** The end of the route being walked, to see a new route that began in the very step the last one ended. */
  endX: number
  endZ: number
  lastRemaining: number
  goTos: number
}

export const REASONS = ['held', 'door', 'crowd', 'veto', 'chain', 'turn', 'corner', 'end', 'other'] as const
export type Reason = (typeof REASONS)[number]
export const UNINTENDED: readonly Reason[] = ['chain', 'turn', 'corner', 'other']

export interface StopReport {
  /** Minutes of route walking (summed over people). */
  walkingMinutes: number
  stops: Record<Reason, number>
  slowDowns: Record<Reason, number>
  /** Unintended stops and slow-downs per walker-minute. */
  unintendedPerMinute: number
  /** All stops (intended or not) per walker-minute. */
  stopsPerMinute: number
}

/** The first reason that held from a second before the episode began until now ('chain' is decided where a leg starts). */
function reasonOf(q: Track): Reason {
  for (let i = 0; i < REASONS.length; i++) if (REASONS[i] !== 'chain' && q.seen[i] >= q.since - 1) return REASONS[i]
  return 'other'
}

function describe(kind: string, why: string, id: string, t: number, q: Track, f: FollowerView): string {
  const i = Math.min(f.idx, f.n - 1)
  const turnAt = (k: number): string => {
    if (k <= 0 || k >= f.n - 1) return '-'
    const a = Math.atan2(f.px[k] - f.px[k - 1], f.pz[k] - f.pz[k - 1])
    const b = Math.atan2(f.px[k + 1] - f.px[k], f.pz[k + 1] - f.pz[k])
    return (Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 57.3).toFixed(0)
  }
  return `${kind} ${why} ${id} t=${t.toFixed(1)} took ${(t - q.since).toFixed(1)}s at (${q.x.toFixed(1)},${q.z.toFixed(1)}) wp ${f.idx}/${f.n} turns ${turnAt(i - 1)}/${turnAt(i)}/${turnAt(i - 2)}`
}

/** Run `seconds` of the simulation at its fixed step and measure. */
export function measureStops(sim: Simulation, seconds: number, dt: number, log?: string[], callers?: Map<string, string>): StopReport {
  const tracks = new Map<string, Track>()
  const stops = Object.fromEntries(REASONS.map((r) => [r, 0])) as Record<Reason, number>
  const slowDowns = Object.fromEntries(REASONS.map((r) => [r, 0])) as Record<Reason, number>
  let walking = 0
  const steps = Math.round(seconds / dt)
  for (let s = 0; s < steps; s++) {
    if (callers) {
      for (const p of sim.people) {
        const w = p.walker as unknown as { goTo: (to: unknown) => void; __hooked?: boolean }
        if (w.__hooked) continue
        w.__hooked = true
        const orig = w.goTo.bind(w)
        const id = p.entity.id
        w.goTo = (to) => {
          const fr = (new Error().stack ?? '').split('\n').slice(2, 5).map((l) => l.trim().replace(/^at /, '').replace(/ \(.*\/src\//, '@').replace(/:\d+\)$/, '')).join(' < ')
          callers.set(id, `[t=${sim.t.toFixed(1)} remaining=${((p.walker as unknown as WalkerView).f as unknown as { remaining: number }).remaining.toFixed(2)} by ${fr}]`)
          orig(to)
        }
      }
    }
    sim.step(dt)
    for (const p of sim.people) {
      const e = p.entity
      const w = p.walker as unknown as WalkerView
      const f = w.f
      if (!f || e.seated || e.riding || e.anim === 'lie' || e.fade === 0) {
        tracks.delete(e.id)
        continue
      }
      let q = tracks.get(e.id)
      if (!q) {
        q = { x: w.x, z: w.z, v: 0, moving: false, stopped: false, dip: false, seen: new Float64Array(REASONS.length).fill(-1e9), since: 0, anim: e.anim, arrivedAt: -1, arrivedAnim: '', wasActive: f.active, pathSpeed: 0, goTos: 0, busy: false, endX: NaN, endZ: NaN, lastRemaining: 0 }
        tracks.set(e.id, q)
        continue
      }
      const raw = Math.hypot(w.x - q.x, w.z - q.z) / dt
      q.x = w.x
      q.z = w.z
      const active = f.active
      let startedRoute = active && !q.wasActive
      let endedRoute = !active && q.wasActive
      if (active && q.wasActive && (f.px[f.n - 1] !== q.endX || f.pz[f.n - 1] !== q.endZ)) {
        // a new route in the same step: after an arrival (the last one was all but walked) it is the next leg; else a change of plan
        if (q.lastRemaining < 0.05) {
          endedRoute = true
          startedRoute = true
        }
      }
      if (active) {
        q.endX = f.px[f.n - 1]
        q.endZ = f.pz[f.n - 1]
        q.lastRemaining = (f as unknown as { remaining: number }).remaining
      }
      q.wasActive = active
      if (endedRoute) {
        q.arrivedAt = sim.t
        q.arrivedAnim = e.anim
        q.busy = false
      }
      if (!active && e.anim !== 'walk' && e.anim !== 'idle') q.busy = true
      if (startedRoute) {
        // a new leg within 3 s of the last one, with nothing done in between (the same pose all along): a chained leg
        if (q.arrivedAt >= 0 && sim.t - q.arrivedAt < 3 && !q.busy && q.moving) {
          if (q.stopped) {
            stops.chain++
            q.stopped = false
          } else if (q.dip) {
            slowDowns.chain++
            q.dip = false
          }
        }
        // (anything else was a stop at a destination: not counted; either way the walk starts afresh)
        q.moving = false
        q.stopped = false
        q.dip = false
        q.arrivedAt = -1
      }
      if (!active && (q.arrivedAt < 0 || sim.t - q.arrivedAt > 3 || raw > 3)) {
        // not walking a route (standing, a scripted glide): forget the episode
        q.moving = false
        q.stopped = false
        q.dip = false
        q.v = 0
        continue
      }
      q.v += (raw - q.v) * SMOOTH
      const v = q.v
      if (active) {
        walking += dt
        // what is limiting the walker right now
        const i = f.idx
        const dx = f.px[i] - f.x
        const dz = f.pz[i] - f.z
        const d = Math.hypot(dx, dz)
        const vc = f.corner[i]
        const vCorner = Math.sqrt(vc * vc + 2.4 * d)
        const vEnd = Math.sqrt(2.4 * (d + f.tail[i]))
        const held = sim.t < (p as unknown as { holdUntil: number }).holdUntil
        if (held) q.seen[0] = sim.t
        if ((w.gate ?? -1) >= 0 || w.aside) q.seen[1] = sim.t
        if ((w.vLim ?? 1e9) < 0.6) q.seen[2] = sim.t
        else if (q.pathSpeed > 0.3 && f.speed === 0) q.seen[3] = sim.t
        if (vCorner < 0.8) q.seen[6] = sim.t
        if (vEnd < 0.8 && f.n - i <= 1) q.seen[7] = sim.t
        q.pathSpeed = f.speed
      }
      // turning: the follower's own slow-down for a heading error shows as a path speed well under what the limits allow
      if (active && f.speed < 0.45) {
        const i = f.idx
        const err = Math.abs(((Math.atan2(f.px[i] - f.x, f.pz[i] - f.z) - f.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)
        if (err > 0.3) q.seen[5] = sim.t
      }
      if (q.moving) {
        if (!q.stopped && v < 0.15) {
          if (!q.dip) q.since = sim.t
          q.stopped = true
          q.dip = false
        } else if (!q.stopped && !q.dip && v < 0.45) {
          q.dip = true
          q.since = sim.t
        }
        // (recoveries count only on a route: after a route the body may glide onto a seat, which is not walking)
        if (!active) continue
        if (q.stopped && v > 0.6) {
          const why = reasonOf(q)
          stops[why]++
          if (log && why !== 'door') log.push(describe('stop', why, e.id, sim.t, q, f) + ' ' + (callers?.get(e.id) ?? ''))
          q.stopped = false
        } else if (q.dip && v > 0.8) {
          const why = reasonOf(q)
          slowDowns[why]++
          if (log && why !== 'crowd' && why !== 'door') log.push(describe('slow', why, e.id, sim.t, q, f) + ' ' + (callers?.get(e.id) ?? ''))
          q.dip = false
        }
      } else if (active && v > 0.8) {
        q.moving = true
      }
    }
  }
  const minutes = walking / 60
  let unintended = 0
  let all = 0
  for (const r of REASONS) {
    all += stops[r]
    if (UNINTENDED.includes(r)) unintended += stops[r] + slowDowns[r]
  }
  return { walkingMinutes: minutes, stops, slowDowns, unintendedPerMinute: unintended / Math.max(1e-9, minutes), stopsPerMinute: all / Math.max(1e-9, minutes) }
}
