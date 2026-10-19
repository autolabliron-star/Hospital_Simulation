/**
 * The state-to-pose maths of the robot blood-draw centre: pure functions, no three.js, no DOM. The sim publishes a `DrawStationState` per robot and
 * a `TubePrepState` (phase, scan, needle, cuff, tube fill ...); these turn them into head positions, needle depth, tourniquet size, glow
 * levels, tube-bar heights and the prep gripper's targets. The per-frame ones write into an `out` object or array (nothing is allocated).
 * `rig.ts` calls them every frame; the geometry builders use the same constants through dims.ts.
 */
import { clamp01, lerp, smoothTo, stepToward } from '@/scene/imaging/machines/motion'
import type { DrawPhase, DrawStationState, TubeKind, TubePrepState } from '@/sim/types'
import { PREP_BIN_KIND, PREP_STOPS, TUBE_SLOTS, prepBinLocal } from './dims'

export { clamp01, lerp, smoothTo, stepToward }

/** Ease towards `target` like `smoothTo`, but never faster than `maxSpeed` units per second: a servo cannot teleport (`dt` 0 changes nothing). */
export function slewTo(v: number, target: number, rate: number, maxSpeed: number, dt: number): number {
  const step = (target - v) * (1 - Math.exp(-rate * dt))
  const lim = maxSpeed * dt
  return v + (step > lim ? lim : step < -lim ? -lim : step)
}

/** Smooth 0..1 ramp of `x` between `a` and `b`. */
export function smooth(a: number, b: number, x: number): number {
  const k = clamp01((x - a) / (b - a))
  return k * k * (3 - 2 * k)
}

// ---------------------------------------------------------------------------------------------
// The robot head
// ---------------------------------------------------------------------------------------------

/** The head glides to its target at about this rate (1/s): the scan sweep follows the sim's `scan` within ~0.1 s; at most `HEAD_SPEED` m/s. */
export const HEAD_RATE = 9
export const HEAD_SPEED = 0.45
/** The prep gripper's fastest move (m/s), and its rate. */
export const GRIP_SPEED = 0.55

/** The phases in which the head works over the forearm; in every other one it parks deep in the tunnel, away from the arm. */
export function headWorking(phase: DrawPhase): boolean {
  return phase === 'veinScan' || phase === 'needleIn' || phase === 'filling' || phase === 'needleOut'
}

/** What the sim's `scan` was last time the head was scanning; it holds there while the needle goes in, the tubes fill and the needle comes out. */
export function holdScan(hold: number, phase: DrawPhase, scan: number): number {
  if (phase === 'veinScan') return clamp01(scan)
  if (hold < 0 && headWorking(phase)) return scan > 0.01 ? clamp01(scan) : 0.8
  if (!headWorking(phase) && phase !== 'armMoved' && phase !== 'fallbackToNurse') return -1
  return hold
}

/** The `s` along the forearm the head wants (0 at the wrist, 1 at the crease, `park` when it is not working). */
export function headTargetS(phase: DrawPhase, scan: number, hold: number, park: number): number {
  if (phase === 'veinScan') return clamp01(scan)
  if (headWorking(phase)) return hold < 0 ? 0.8 : hold
  return park
}

/** The needle's advance 0..1: it only shows in the phases that use it (and retracts in the others). */
export function needleTarget(phase: DrawPhase, needle: number): number {
  return phase === 'needleIn' || phase === 'filling' || phase === 'needleOut' ? clamp01(needle) : 0
}

/** The tourniquet ring: 1 = pulled tight round the arm, 0 = open. The sim's `cuff` (0..1) drives it directly. */
export const cuffTarget = (cuff: number): number => clamp01(cuff)

// ---------------------------------------------------------------------------------------------
// Glow: the near-infrared light on the cradle, the scan-light chaser, the status LED bar
// ---------------------------------------------------------------------------------------------

/** The cradle's NIR glow shows while the robot looks for the vein. */
export const nirTarget = (phase: DrawPhase): 0 | 1 => (phase === 'veinScan' ? 1 : 0)
export const NIR_FADE_SECONDS = 0.25
/** Brightness gain of the deep-red glow at level 0..1 and time `t` (it pulses at about 1.6 Hz): above 1 it blooms. */
export function nirGain(level: number, t: number): number {
  return level * (0.7 + 0.5 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.6 * t)))
}

/** The scan-light chaser: 8 glow segments along the tunnel roof. */
export const CHASER_SEGMENTS = 8
/** Segments per second: fast while the head scans, slow while the skin is cleaned. */
export function chaserRate(phase: DrawPhase): number {
  return phase === 'veinScan' ? 12 : phase === 'sanitise' ? 4 : 0
}
/** The lit head of the chase at time `t` (an index 0..7), or -1 when the chaser is not chasing. */
export function chaserIndex(phase: DrawPhase, t: number): number {
  const r = chaserRate(phase)
  if (r === 0) return -1
  const i = Math.floor(Math.abs(t) * r) % CHASER_SEGMENTS
  return i
}
/** Fill `out` (length 8) with the brightness 0..1 of every segment: the head of the chase, a fading trail behind it, a faint glow elsewhere. */
export function chaserLevels(out: Float32Array, phase: DrawPhase, t: number): void {
  const head = chaserIndex(phase, t)
  // a dim steady glow while the robot works the arm in the other phases, nothing at rest
  const base = head >= 0 ? 0.08 : phase === 'idle' || phase === 'calling' || phase === 'reset' ? 0 : 0.22
  for (let k = 0; k < CHASER_SEGMENTS; k++) {
    let v = base
    if (head >= 0) {
      const behind = (head - k + CHASER_SEGMENTS) % CHASER_SEGMENTS
      if (behind === 0) v = 1
      else if (behind === 1) v = 0.55
      else if (behind === 2) v = 0.25
    }
    out[k] = v
  }
}

export type LedLight = DrawStationState['light']
/**
 * The light the sim publishes for each phase (the draw centre's contract: white = free or waiting, teal = working, amber = a person is needed, green =
 * done). The rig shows `station.light` as it comes; this table is the agreed meaning, used by the tests and by anything that must guess a light.
 */
export const PHASE_LIGHT: Record<DrawPhase, LedLight> = {
  idle: 'white',
  calling: 'white',
  cardScan: 'teal',
  armIn: 'teal',
  cuff: 'teal',
  sanitise: 'teal',
  veinScan: 'teal',
  needleIn: 'teal',
  filling: 'teal',
  needleOut: 'teal',
  bandage: 'green',
  release: 'green',
  awaitPorter: 'green',
  armMoved: 'amber',
  fallbackToNurse: 'amber',
  reset: 'white',
}
/** The status bar's colours (sRGB hex): white = free or waiting, teal = working, amber = needs the nurse, green = done. */
export const LED_HEX: Record<LedLight, string> = { white: '#f4f8f8', teal: '#1fb5ad', amber: '#ffb23a', green: '#35e07a' }
/** The brightness gain of the bar: above 1 it blooms; amber pulses when a person is needed. */
export function ledGain(light: LedLight, phase: DrawPhase, t: number): number {
  const base = light === 'white' ? 0.9 : 1.35
  if (light === 'amber' || phase === 'armMoved' || phase === 'fallbackToNurse') return base * (0.65 + 0.35 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.4 * t)))
  return base
}

// ---------------------------------------------------------------------------------------------
// Tube bars
// ---------------------------------------------------------------------------------------------

/** How full each of the five tube bars is (0..1) for a station, written into `out`. Returns how many tubes this draw has (0..5). */
export function tubeFills(out: Float32Array, s: Pick<DrawStationState, 'phase' | 'tubes' | 'tube' | 'tubeFill'>): number {
  const n = Math.min(TUBE_SLOTS.count, s.tubes.length)
  for (let k = 0; k < TUBE_SLOTS.count; k++) out[k] = 0
  const p = s.phase
  if (n === 0) return 0
  if (p === 'needleOut' || p === 'bandage' || p === 'release' || p === 'awaitPorter') {
    for (let k = 0; k < n; k++) out[k] = 1
  } else if (p === 'filling' || p === 'armMoved' || p === 'fallbackToNurse') {
    for (let k = 0; k < n; k++) out[k] = k < s.tube ? 1 : k === s.tube ? clamp01(s.tubeFill) : 0
  }
  return n
}

/** A tube bar's colour: its cap colour from the content (a lookup, no allocation). Set by the rig when the kind of a slot changes. */
export function slotKind(s: Pick<DrawStationState, 'tubes'>, k: number): TubeKind | null {
  return k < s.tubes.length ? s.tubes[k] : null
}

// ---------------------------------------------------------------------------------------------
// The prep machine's gripper
// ---------------------------------------------------------------------------------------------

export interface GripTarget {
  /** Where the fingers are: machine frame (lx across, lz depth) and height. */
  lx: number
  lz: number
  y: number
  /** 1 = open, 0 = closed on a tube. */
  open: number
  /** A tube is in the fingers, and it is spinning in the wrap station. */
  held: boolean
  spin: boolean
  /** The label is on the tube (after the printer). */
  label: boolean
  /** The label printer is working (its strip glows). */
  printing: boolean
}

export function newGripTarget(): GripTarget {
  return { lx: 0, lz: 0, y: PREP_STOPS.yHome, open: 1, held: false, spin: false, label: false, printing: false }
}

/**
 * Where the gripper wants to be, from the prep state: idle: home; picking: over the bin and down to grab, then lifted and on its way to the
 * printer; labelling: at the printer (the strip glows), then in the wrap station (the held tube spins); output: carrying to the tray outlet and
 * letting go. The rig chases the target smoothly, so a state that jumps ahead still looks like one move.
 */
export function gripTargetInto(out: GripTarget, prep: Pick<TubePrepState, 'phase' | 'bin' | 'held' | 'progress'>): GripTarget {
  const S = PREP_STOPS
  const p = clamp01(prep.progress)
  const holding = prep.held !== null
  out.held = holding
  out.spin = false
  out.label = false
  out.printing = false
  out.open = 1
  out.lx = S.home.lx
  out.lz = S.home.lz
  out.y = S.yHome
  if (prep.phase === 'picking') {
    const bin = prep.bin >= 0 ? prepBinLocal(Math.min(PREP_BIN_KIND.length - 1, prep.bin)) : S.home
    if (!holding) {
      out.lx = bin.lx
      out.lz = bin.lz
      out.y = lerp(S.yCarry, S.yPick, smooth(0, 0.7, p))
      out.open = p < 0.75 ? 1 : 0
    } else {
      const k = smooth(0.15, 1, p)
      out.lx = lerp(bin.lx, S.printer.lx, k)
      out.lz = lerp(bin.lz, S.printer.lz, k)
      out.y = S.yCarry
      out.open = 0
    }
  } else if (prep.phase === 'labelling') {
    const printing = p < 0.5
    out.lx = printing ? S.printer.lx : S.wrap.lx
    out.lz = printing ? S.printer.lz : S.wrap.lz
    out.y = S.yCarry - 0.015
    out.open = holding ? 0 : 1
    out.printing = printing
    out.spin = !printing && holding
    out.label = !printing
  } else if (prep.phase === 'output') {
    const k = smooth(0, 0.7, p)
    out.lx = lerp(S.wrap.lx, S.drop.lx, k)
    out.lz = lerp(S.wrap.lz, S.drop.lz, k)
    out.y = lerp(S.yCarry, S.yDrop, smooth(0.5, 0.8, p))
    out.open = holding && p < 0.85 ? 0 : 1
    out.label = holding
  }
  return out
}

/** The held tube spins at this speed (rad/s) in the wrap station. */
export const SPIN_RATE = 7

/** The label printer's glow gain: busy while printing, a faint standby glow otherwise. */
export function labelGain(printing: boolean, t: number): number {
  return printing ? 1.2 + 0.5 * Math.sin(t * 38) : 0.25
}

/** How many labelled trays show in the output rack (the contract keeps the tickets, the rack shows up to `PREP_STOPS.trays`). */
export function visibleTrays(rack: readonly string[]): number {
  return Math.min(PREP_STOPS.trays, rack.length)
}

// ---------------------------------------------------------------------------------------------
// Flashes (check-in ticket slot, send station inlet)
// ---------------------------------------------------------------------------------------------

/** A flash level that decays from 1 to 0 over `seconds`. */
export function decayFlash(level: number, dt: number, seconds: number): number {
  return level > 0 ? Math.max(0, level - dt / seconds) : 0
}
