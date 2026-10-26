/**
 * R4: the sounds of the CT cryoablation suite on level 2, as a pure pattern for the device-sound engine (registry.ts, engine.ts): no Web Audio, no React
 * and no sim singleton at import (the live sim is loaded on the first plan, and read afresh on every plan: a Jump swaps it).
 *
 *   CT whir         the rotor's whine while the CT scans, its pitch and level the imaging CT's (src/audio/patterns.ts ctPitchHz, ctGain), from the gantry
 *   servo chirps    short rising chirps every 0.5 s while the needle-guidance robot deploys, aims or retracts, from its arm's mount
 *   argon hiss      a soft, steady band of noise in 0.6 s puffs while the argon runs (the freezes), from the console
 *   freeze beep     two short beeps as a freeze starts (an edge: the first look at a state, and the first after a Jump, only learn it)
 *
 * Everything that runs while something happens is periodic on the audio clock, so consecutive windows join with no gap and no repeat. All positions are
 * sim coordinates (level 2's strip), so a listener on level 1 hears nothing by distance.
 */
import { CRYO_SUITE } from '@/sim/places'
import type { CryoStep, CryoSuiteState, Vec3 } from '@/sim/types'
import { ctGain, ctPitchHz } from '../patterns'
import { blip, periodic, type DeviceEvent, type DevicePattern, type NoiseEvent, type PatternSink, type PlanWindow, type ToneEvent } from './registry'

export const GANTRY_AT: Vec3 = { x: CRYO_SUITE.ct.machine.x, y: 1.0, z: CRYO_SUITE.ct.machine.z }
export const ROBOT_AT: Vec3 = { x: CRYO_SUITE.robot.mount.x, y: CRYO_SUITE.robot.mount.y + 0.4, z: CRYO_SUITE.robot.mount.z }
export const CONSOLE_AT: Vec3 = { x: CRYO_SUITE.console.at.at.x, y: 1.0, z: CRYO_SUITE.console.at.at.z }

export const SERVO_PERIOD_S = 0.5
export const HISS_PERIOD_S = 0.6
/** The CT whir's level at full speed (a little under the imaging CT's: the suite is quieter around it). */
export const WHIR_LEVEL = 0.07
/** A step change counts as an edge only while it is this fresh (sim seconds). */
export const EDGE_FRESH_S = 6

const FREEZES: ReadonlySet<CryoStep> = new Set<CryoStep>(['freeze1', 'freeze2'])

/** One servo chirp of the arm: a quick rising sawtooth and a breath of noise. */
export function servoChirp(t: number, at: Vec3 | null = ROBOT_AT): DeviceEvent[] {
  const tone: ToneEvent = { kind: 'tone', t, f0: 240, f1: 520, dur: 0.16, peak: 0.04, wave: 'sawtooth', attack: 0.03, at }
  const hiss: NoiseEvent = { kind: 'noise', t, f0: 1400, f1: 2200, q: 1.3, dur: 0.14, peak: 0.025, attack: 0.03, at }
  return [tone, hiss]
}

/** One puff of the argon's hiss: wide, high noise that overlaps the next (so the run sounds continuous). */
export function argonHiss(t: number, at: Vec3 | null = CONSOLE_AT): NoiseEvent {
  return { kind: 'noise', t, f0: 5200, f1: 4800, q: 0.5, dur: HISS_PERIOD_S + 0.12, peak: 0.035, attack: 0.08, at }
}

/** A freeze starts: two short beeps (A5, A5). */
export function freezeBeep(t: number, at: Vec3 | null = CONSOLE_AT): DeviceEvent[] {
  return [blip(t, 880, 0.09, 0.11, at, 'sine'), blip(t + 0.16, 880, 0.09, 0.11, at, 'sine')]
}

export const CRYO_SOUNDS = { servoChirp, argonHiss, freezeBeep } as const

export interface CryoMemory {
  src: CryoSuiteState | null
  step: CryoStep
}

export const newCryoMemory = (): CryoMemory => ({ src: null, step: 'idle' })

function emit(out: PatternSink, events: readonly DeviceEvent[]): void {
  for (let i = 0; i < events.length; i++) out.event(events[i])
}

/** Plan the window `w` from the suite's state, remembering what was seen in `mem`. */
export function planCryo(st: CryoSuiteState, mem: CryoMemory, w: PlanWindow, out: PatternSink): void {
  const known = mem.src === st
  if (known && st.step !== mem.step && FREEZES.has(st.step) && w.simTime - st.stepSince <= EDGE_FRESH_S) emit(out, freezeBeep(w.from))

  const running = w.simSpeed > 0
  if (running && st.rotor > 0.01) out.drone({ id: 'cryo:ct', voice: 'whine', hz: ctPitchHz(st.rotor), level: WHIR_LEVEL * ctGain(st.rotor), at: GANTRY_AT })
  const p = st.robot.phase
  if (running && (p === 'deploying' || p === 'aiming' || p === 'retracting')) periodic(w.from, w.to, SERVO_PERIOD_S, 0.07, (t) => emit(out, servoChirp(t)))
  if (st.argon) periodic(w.from, w.to, HISS_PERIOD_S, 0, (t) => out.event(argonHiss(t)))

  mem.src = st
  mem.step = st.step
}

/** A device pattern that reads the suite's state through `read` (null before the sim has one). */
export function createCryoPattern(read: () => CryoSuiteState | null): DevicePattern {
  const mem = newCryoMemory()
  return {
    id: 'cryoSuite',
    plan(w, out) {
      const st = read()
      if (st) planCryo(st, mem, w, out)
    },
  }
}

let live: typeof import('@/sim') | null = null
let loading = false
function liveCryo(): CryoSuiteState | null {
  if (live) return live.sim.cryoSuite.state
  if (!loading) {
    loading = true
    void import('@/sim').then((m) => {
      live = m
    })
  }
  return null
}

/** What `DeviceSounds.tsx` registers from this file (every `*Patterns.ts` that exports it). */
export const devicePatterns: DevicePattern[] = [createCryoPattern(liveCryo)]
