/**
 * R4: the cryoablation suite's plan. PURE and SEEDED (no world, no people): `planCryoDay(rng)` draws today's list from CONFIG.cryoSuite and
 * returns, for every case, the tumour, the needle paths, every step length, the recovery time and the seeds the scene paints with. The same
 * seed gives the same plan whatever hour a Jump starts at, so a warm start places every case from `cryoTimeline(plan)`.
 *
 *   list      one case per CONFIG.cryoSuite.listHours, each jittered by +- listJitterMinutes; a case never starts before the previous one's
 *             turnover is over (`nominalIn`)
 *   needles   2..4 (more for a bigger tumour); the paths come in from the patient's left flank (the robot's side) and fan out so that the
 *             union of the needles' ice covers the tumour plus at least MARGIN_MM (`iceCoverageGap` proves it)
 *   steps     uniform draws inside CONFIG.cryoSuite.stepMinutes; the aim step is one draw per needle; the demo scales every step (and the
 *             turnover) by demoScale
 *
 * Nothing here decides anything clinical: every number is a seeded draw for the display.
 */
import { CONFIG } from '../config'
import { timeAtHour } from '../population/schedule'
import type { Rng } from '../rng'

/** The steps a case spends in the suite's rooms, in order ('out' ends when the patient is in a recovery bay). */
export const ROOM_STEPS = ['arrive', 'sedation', 'planningCt', 'planning', 'aim', 'checkCt', 'freeze1', 'thaw', 'freeze2', 'activeThaw', 'needlesOut', 'finalCt', 'dressing', 'out'] as const
export type RoomStep = (typeof ROOM_STEPS)[number]
/** The CT scans: the table goes in, the rotor scans, the table comes out. */
export const SCAN_STEPS: ReadonlySet<RoomStep> = new Set<RoomStep>(['planningCt', 'checkCt', 'finalCt'])

/** The ice covers the tumour plus this much (mm) all round. */
export const MARGIN_MM = 5
/** The band the skin entries keep to (mm from the tumour centre; the scene's robot reaches these from the left flank). */
export const ENTRY_X: readonly [number, number] = [75, 95]
export const ENTRY_Y: readonly [number, number] = [-40, 20]

export interface PlannedNeedle {
  /** Skin entry and tip in the axial planning slice, mm from the tumour centre (+x the patient's left, +y posterior). */
  entry: { x: number; y: number }
  tip: { x: number; y: number }
  /** Offset along the body from the target slice (mm, + toward the head). */
  dz: number
  /** The robot's aiming error once aligned (mm). */
  errorMm: number
  /** This needle's tip runs a few degrees warmer or colder than the console's set point. */
  tipOffsetC: number
}

export interface PlannedCryoCase {
  id: string
  index: number
  demo: boolean
  /** The list's wheels-in: the ward porter rolls the patient out of lift B (sim seconds). */
  plannedIn: number
  /** When the room is free for it (the previous case's turnover over): the warm start places the case from here. */
  nominalIn: number
  tumourMm: number
  needles: PlannedNeedle[]
  /** One needle's ice radius (mm) at the end of the second freeze (the union covers the tumour + MARGIN_MM). */
  needleIceMm: number
  /** The whole ice ball's long axis at full size (mm). */
  iceMm: number
  /** Seconds per step ('aim' is the sum of `aimSeconds`). */
  steps: Record<RoomStep, number>
  aimSeconds: number[]
  turnoverSeconds: number
  pacuSeconds: number
  motionSeed: number
  imageSeed: number
}

export interface CryoTimeline {
  start: Record<RoomStep, number>
  end: Record<RoomStep, number>
  /** The patient is in the recovery bay and the room's part is over (= end.out); the turnover runs from here. */
  roomEnd: number
  turnoverEnd: number
  pacuIn: number
  pacuOut: number
}

const MIN = 60

function stepDraw(rng: Rng, key: keyof typeof CONFIG.cryoSuite.stepMinutes, scale: number): number {
  return rng.between(CONFIG.cryoSuite.stepMinutes[key]) * MIN * scale
}

/** One case from its own rng: the tumour and needles first, then the times (so the geometry never depends on the timing). */
export function planCase(rng: Rng, id: string, index: number, plannedIn: number, demo: boolean): PlannedCryoCase {
  const cfg = CONFIG.cryoSuite
  const scale = demo ? cfg.demoScale : 1
  const geo = rng.fork('geometry')
  const tumourMm = Math.round(geo.between(cfg.tumourMm) * 10) / 10
  const k = (tumourMm - cfg.tumourMm[0]) / (cfg.tumourMm[1] - cfg.tumourMm[0])
  const [nMin, nMax] = cfg.needles
  const n = Math.max(nMin, Math.min(nMax, Math.min(cfg.maxNeedles, Math.round(nMin + k * (nMax - nMin) + geo.range(-0.45, 0.45)))))
  const { needles, needleIceMm } = needlePaths(geo, n, tumourMm)
  const R = tumourMm / 2 + MARGIN_MM
  const iceMm = Math.round(Math.max(cfg.iceMm[0], Math.min(cfg.iceMm[1], 2 * R + geo.range(6, 10))) * 10) / 10
  const tm = rng.fork('times')
  const steps = {} as Record<RoomStep, number>
  const aimSeconds: number[] = []
  for (const s of ROOM_STEPS) {
    if (s === 'aim') {
      for (let i = 0; i < n; i++) aimSeconds.push(stepDraw(tm, 'aimPerNeedle', scale))
      steps.aim = aimSeconds.reduce((a, b) => a + b, 0)
    } else steps[s] = stepDraw(tm, s, scale)
  }
  const turnoverSeconds = tm.between(cfg.turnoverMinutes) * MIN * scale
  const pacuSeconds = tm.between(cfg.pacuMinutes) * MIN
  const seeds = rng.fork('seeds')
  return {
    id,
    index,
    demo,
    plannedIn,
    nominalIn: plannedIn,
    tumourMm,
    needles,
    needleIceMm,
    iceMm,
    steps,
    aimSeconds,
    turnoverSeconds,
    pacuSeconds,
    motionSeed: seeds.int(1, 2 ** 30),
    imageSeed: seeds.int(1, 2 ** 30),
  }
}

/** Today's list. */
export function planCryoDay(rng: Rng): PlannedCryoCase[] {
  const cfg = CONFIG.cryoSuite
  const out: PlannedCryoCase[] = []
  cfg.listHours.forEach((hour, i) => {
    const r = rng.fork(`case${i}`)
    const plannedIn = timeAtHour(hour) + r.range(-cfg.listJitterMinutes, cfg.listJitterMinutes) * MIN
    const p = planCase(r, `cryo-${i + 1}`, i, plannedIn, false)
    const prev = out[out.length - 1]
    if (prev !== undefined) p.nominalIn = Math.max(p.plannedIn, cryoTimeline(prev).turnoverEnd)
    out.push(p)
  })
  return out
}

/** The nominal times of a case's steps from `nominalIn` (what a live run does when nothing physical delays it). */
export function cryoTimeline(p: PlannedCryoCase): CryoTimeline {
  const start = {} as Record<RoomStep, number>
  const end = {} as Record<RoomStep, number>
  let at = p.nominalIn
  for (const s of ROOM_STEPS) {
    start[s] = at
    at += p.steps[s]
    end[s] = at
  }
  const roomEnd = end.out
  return { start, end, roomEnd, turnoverEnd: roomEnd + p.turnoverSeconds, pacuIn: roomEnd, pacuOut: roomEnd + p.pacuSeconds }
}

/** The start of needle `k`'s aim window, seconds into the aim step. */
export function aimOffset(p: PlannedCryoCase, k: number): number {
  let s = 0
  for (let i = 0; i < k; i++) s += p.aimSeconds[i]
  return s
}

// ---------------------------------------------------------------------------------------------------------------------
// The needle paths
// ---------------------------------------------------------------------------------------------------------------------

/** The distance from point p to the segment a-b (3D, mm). */
function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len2 = dx * dx + dy * dy + dz * dz
  let u = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0
  u = u < 0 ? 0 : u > 1 ? 1 : u
  const qx = ax + dx * u - px
  const qy = ay + dy * u - py
  const qz = az + dz * u - pz
  return Math.sqrt(qx * qx + qy * qy + qz * qz)
}

/** The largest distance from any sampled point of the sphere of radius `radius` (step `h` mm, grid offset `off`) to its nearest needle. */
export function coverRadius(needles: readonly PlannedNeedle[], radius: number, h = 1, off = 0): number {
  let worst = 0
  const n = Math.ceil(radius / h) + 1
  for (let i = -n; i <= n; i++) {
    const x = i * h + off
    for (let j = -n; j <= n; j++) {
      const y = j * h + off
      for (let l = -n; l <= n; l++) {
        const z = l * h + off
        if (x * x + y * y + z * z > radius * radius) continue
        let best = Infinity
        for (const nd of needles) {
          const d = segDist(x, y, z, nd.entry.x, nd.entry.y, nd.dz, nd.tip.x, nd.tip.y, nd.dz)
          if (d < best) best = d
        }
        if (best > worst) worst = best
      }
    }
  }
  return worst
}

/**
 * How far (mm) the needles' ice falls short of covering the tumour plus MARGIN_MM at full size: 0 when it covers (the test samples on a grid
 * offset from the plan's).
 */
export function iceCoverageGap(p: PlannedCryoCase, h = 1, off = 0.5): number {
  return Math.max(0, coverRadius(p.needles, p.tumourMm / 2 + MARGIN_MM, h, off) - p.needleIceMm)
}

/**
 * n paths from the left flank: a common direction `u` (entry to tip) seeded between left-lateral and 12 degrees anterior of it, the tips on a small ring
 * round the tumour's centre in the plane across `u` (its two axes: across the slice, and along the body as dz), pushed a little past the
 * centre, and the entries spread wider on the skin (the paths fan). The needle's ice radius is what covers the tumour plus the margin, sampled
 * on a 1.5 mm grid, plus the grid's own error.
 */
function needlePaths(rng: Rng, n: number, tumourMm: number): { needles: PlannedNeedle[]; needleIceMm: number } {
  const cfg = CONFIG.cryoSuite
  const R = tumourMm / 2 + MARGIN_MM
  // (the scene's robot reaches entries about x +75..+95, y -40..+20: from the left flank, never up near the table top)
  const theta = rng.range(-12, 0) * (Math.PI / 180)
  // from the tumour toward the skin entry (left, a little anterior), and the across-slice axis
  const ox = Math.cos(theta)
  const oy = Math.sin(theta)
  const vx = -oy
  const vy = ox
  const ring = R * (n === 2 ? 0.35 : n === 3 ? 0.45 : 0.5) * rng.range(0.9, 1.1)
  const phase = rng.range(0, Math.PI / n)
  const advance = R * 0.45
  const needles: PlannedNeedle[] = []
  for (let i = 0; i < n; i++) {
    const a = phase + (i * 2 * Math.PI) / n
    const across = Math.cos(a) * ring
    const dz = Math.round(Math.sin(a) * ring * 10) / 10
    const tx = -ox * advance + vx * across
    const ty = -oy * advance + vy * across
    // the entries fan wider on the skin than the tips, at a seeded depth that lands them in the robot's band
    const spread = 0.4
    const want = rng.range(ENTRY_X[0] + 4, ENTRY_X[1] - 4)
    const depth = (want - tx - vx * across * spread) / ox
    const ex = Math.max(ENTRY_X[0], Math.min(ENTRY_X[1], tx + ox * depth + vx * across * spread))
    const ey = Math.max(ENTRY_Y[0], Math.min(ENTRY_Y[1], ty + oy * depth + vy * across * spread))
    needles.push({
      entry: { x: Math.round(ex * 10) / 10, y: Math.round(ey * 10) / 10 },
      tip: { x: Math.round(tx * 10) / 10, y: Math.round(ty * 10) / 10 },
      dz,
      errorMm: Math.round(rng.between(cfg.aimErrorMm) * 10) / 10,
      tipOffsetC: Math.round(rng.range(-6, 6)),
    })
  }
  // (sampled over a sphere one step bigger, so every point of the real one is within h*sqrt(3)/2 of a sample; then the step on top)
  const needleIceMm = Math.ceil((coverRadius(needles, R + 1.5, 1.5, 0) + 1.5) * 10) / 10
  return { needles, needleIceMm }
}
