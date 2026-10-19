/**
 * The sounds of the robotic operating room on level 2 (R2), as a pure pattern for the device-sound engine (registry.ts, engine.ts): no Web Audio, no
 * React and no sim singleton at import, so it runs (and is tested) in node. `createSurgeryPattern(read)` is the pattern; the live sim is loaded on the first
 * plan (never at import, so tests that read the patterns do not build a hospital) and read afresh on every plan (a Jump swaps it).
 *
 *   arm servos      a soft rising whine with a breath of noise, every 0.45 s on the audio clock for each moving arm (0.02 < engage < 0.98) and for the
 *                   boom and cart while they move, each with its own offset so they never sound in unison; it comes from the cart
 *   wheel hum       a quiet low motor drone while the cart drives in and back (robot phase 'driving' or 'returning')
 *   docking chime   a pleasant two-note chime as the robot becomes 'docked', and one short note as the endoscope arm engages ('docking' begins)
 *   ventilator      a soft breath every 4.8 s while a patient is under (a swell of band-passed noise that rises, then falls, over about 1.7 s)
 *   monitor beeps   a soft 880 Hz blip every 0.92 s from the anaesthesia machine, for the same phases
 *
 * The edges (the chime, the note) are one-shots at the front of the plan window and fire once; the first look at a state (and the first after a Jump swaps
 * the sim) only learns it, so nothing chimes at load. Everything that runs while something happens is periodic on the audio clock (`periodic`: an event's
 * time depends on its index only), so consecutive windows join with no gap and no repeat. A room in the middle of a case sounds at once: the breath, the
 * beeps and the servos of an arm that is mid-travel need no history. All positions are sim coordinates (level 2 is at sim x ~ 97..106), so a listener on
 * level 1 hears nothing by distance, which is the point.
 */
import { SURGERY } from '@/sim/places'
import type { CasePhase, RobotPhase, SurgeryState, Vec3 } from '@/sim/types'
import { blip, periodic, type DeviceEvent, type DevicePattern, type NoiseEvent, type PatternSink, type PlanWindow, type ToneEvent } from './registry'

// ---------------------------------------------------------------------------------------------
// Where the sounds come from
// ---------------------------------------------------------------------------------------------

/** The cart's sounds come from its head, 1.4 m up; the cart moves, so this is read from the state on every plan. */
export const CART_SOUND_Y = 1.4
/** The ventilator breathes at the anaesthesia machine's bellows, the monitor beeps from its screen. */
export const VENTILATOR_AT: Vec3 = { x: SURGERY.anaesthesia.machine.at.x, y: 1.1, z: SURGERY.anaesthesia.machine.at.z }
export const MONITOR_AT: Vec3 = { x: SURGERY.anaesthesia.machine.at.x, y: 1.3, z: SURGERY.anaesthesia.machine.at.z }

// ---------------------------------------------------------------------------------------------
// The sounds
// ---------------------------------------------------------------------------------------------

/** Each moving arm whines this often (audio seconds), at its own offset; the boom and cart are a fifth voice. */
export const SERVO_PERIOD_S = 0.45
export const SERVO_OFFSET_S: readonly number[] = [0, 0.09, 0.18, 0.27]
export const BOOM_SERVO_OFFSET_S = 0.36
/** An arm counts as moving between these (engage 0 is stowed or free, 1 is on its port). */
export const ARM_MOVING_MIN = 0.02
export const ARM_MOVING_MAX = 0.98
/** The boom or the cart counts as moving when it changed this much since the last plan (radians, metres), and keeps whining this long after (audio seconds). */
export const BOOM_STEP = 1e-5
export const CART_STEP = 1e-4
export const BOOM_HOLD_S = 0.2

/** The breath of the ventilator and the beat of the monitor. */
export const BREATH_PERIOD_S = 4.8
export const BREATH_S = 1.7
export const BEEP_PERIOD_S = 0.92
export const BEEP_HZ = 880
export const BEEP_OFFSET_S = 0.46

/** One servo burst of an arm (index 0..3) or the boom (index 4): a sawtooth that glides up 180..420 Hz and a thin band of noise that rises with it. */
export function servoWhine(t: number, index: number, at: Vec3 | null = null): DeviceEvent[] {
  const i = Math.max(0, Math.min(4, Math.floor(index)))
  const tone: ToneEvent = { kind: 'tone', t, f0: 180 + 15 * i, f1: i === 4 ? 300 : 360 + 20 * i, dur: 0.3, peak: 0.05, wave: 'sawtooth', attack: 0.06, at }
  const hiss: NoiseEvent = { kind: 'noise', t, f0: 900 + 60 * i, f1: 1700 + 60 * i, q: 1.1, dur: 0.26, peak: 0.035, attack: 0.05, at }
  return [tone, hiss]
}

/** The robot has docked: two soft rising notes (E5, B5). */
export function dockedChime(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [blip(t, 659.3, 0.34, 0.14, at, 'sine'), blip(t + 0.14, 987.8, 0.55, 0.14, at, 'sine')]
}

/** The endoscope arm has engaged: one short note (C5). */
export function endoscopeNote(t: number, at: Vec3 | null = null): DeviceEvent[] {
  return [blip(t, 523.3, 0.28, 0.12, at, 'triangle')]
}

/** One breath of the ventilator: a band of noise that swells up in pitch and level for about 0.85 s, then falls away for the same. */
export function ventilatorBreath(t: number, at: Vec3 | null = VENTILATOR_AT): DeviceEvent[] {
  const half = BREATH_S / 2
  return [
    { kind: 'noise', t, f0: 320, f1: 820, q: 0.6, dur: half + 0.03, peak: 0.1, attack: half - 0.05, at },
    { kind: 'noise', t: t + half, f0: 820, f1: 340, q: 0.6, dur: half, peak: 0.09, attack: 0.03, at },
  ]
}

/** One beep of the patient monitor: 880 Hz for 60 ms. */
export function monitorBeep(t: number, at: Vec3 | null = MONITOR_AT): DeviceEvent {
  return blip(t, BEEP_HZ, 0.06, 0.09, at, 'sine')
}

export const SURGERY_SOUNDS = { servoWhine, dockedChime, endoscopeNote, ventilatorBreath, monitorBeep } as const

// ---------------------------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------------------------

/** The theatre phases with a patient under: the ventilator breathes and the monitor beeps (not while idle, in turnover, or before induction). */
export const UNDER_PHASES: ReadonlySet<CasePhase | 'idle' | 'turnover'> = new Set<CasePhase | 'idle' | 'turnover'>(['induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence'])

/** The robot phases in which the cart drives on its wheels. */
export const DRIVING_PHASES: ReadonlySet<RobotPhase> = new Set<RobotPhase>(['driving', 'returning'])

/** A phase change counts as an edge only while it is this fresh (sim seconds), so a plan that resumes after a long silence does not chime for old news. */
export const EDGE_FRESH_S = 6

/** What the pattern remembers of the last plan: the state it saw, the robot's phase, and the boom and cart poses to tell movement from rest. */
export interface SurgeryMemory {
  src: SurgeryState | null
  phase: RobotPhase
  yaw: number
  height: number
  extend: number
  cx: number
  cz: number
  /** The audio time until which the boom and cart count as moving. */
  boomUntil: number
}

export function newSurgeryMemory(): SurgeryMemory {
  return { src: null, phase: 'stowed', yaw: 0, height: 0, extend: 0, cx: 0, cz: 0, boomUntil: Number.NEGATIVE_INFINITY }
}

/** Plan the window `w` from the surgery state, remembering what was seen in `mem`. */
export function planSurgery(st: SurgeryState, mem: SurgeryMemory, w: PlanWindow, out: PatternSink): void {
  const robot = st.robot
  const cart: Vec3 = { x: robot.cart.x, y: CART_SOUND_Y, z: robot.cart.z }
  const known = mem.src === st

  // ----- edges: the robot docks, the endoscope arm engages -----
  if (known && robot.phase !== mem.phase && w.simTime - robot.phaseSince <= EDGE_FRESH_S) {
    if (robot.phase === 'docked') for (const e of dockedChime(w.from, cart)) out.event(e)
    else if (robot.phase === 'docking') for (const e of endoscopeNote(w.from, cart)) out.event(e)
  }

  // ----- the servos: an arm mid-travel, or the boom and cart moving -----
  const moving = w.simSpeed > 0
  const boomMoved = known && (Math.abs(robot.boomYaw - mem.yaw) > BOOM_STEP || Math.abs(robot.boomHeight - mem.height) > BOOM_STEP || Math.abs(robot.boomExtend - mem.extend) > BOOM_STEP || Math.abs(robot.cart.x - mem.cx) > CART_STEP || Math.abs(robot.cart.z - mem.cz) > CART_STEP)
  if (boomMoved && moving) mem.boomUntil = w.to + BOOM_HOLD_S
  if (moving) {
    for (let i = 0; i < robot.arms.length && i < SERVO_OFFSET_S.length; i++) {
      const e = robot.arms[i].engage
      if (e > ARM_MOVING_MIN && e < ARM_MOVING_MAX) periodic(w.from, w.to, SERVO_PERIOD_S, SERVO_OFFSET_S[i], (t) => emit(out, servoWhine(t, i, cart)))
    }
    if (w.from < mem.boomUntil) periodic(w.from, Math.min(w.to, mem.boomUntil), SERVO_PERIOD_S, BOOM_SERVO_OFFSET_S, (t) => emit(out, servoWhine(t, 4, cart)))
  }

  // ----- the wheel motors -----
  if (moving && DRIVING_PHASES.has(robot.phase)) out.drone({ id: 'surgery:wheels', voice: 'hum', hz: 74, level: 0.05, at: cart })

  // ----- the patient under: the ventilator and the monitor -----
  if (UNDER_PHASES.has(st.theatre.phase)) {
    periodic(w.from, w.to, BREATH_PERIOD_S, 0, (t) => emit(out, ventilatorBreath(t)))
    periodic(w.from, w.to, BEEP_PERIOD_S, BEEP_OFFSET_S, (t) => out.event(monitorBeep(t)))
  }

  // ----- remember -----
  mem.src = st
  mem.phase = robot.phase
  mem.yaw = robot.boomYaw
  mem.height = robot.boomHeight
  mem.extend = robot.boomExtend
  mem.cx = robot.cart.x
  mem.cz = robot.cart.z
}

function emit(out: PatternSink, events: readonly DeviceEvent[]): void {
  for (let i = 0; i < events.length; i++) out.event(events[i])
}

// ---------------------------------------------------------------------------------------------
// The pattern the engine registers
// ---------------------------------------------------------------------------------------------

/** A device pattern that reads the surgery state through `read` (null before the sim has one). */
export function createSurgeryPattern(read: () => SurgeryState | null): DevicePattern {
  const mem = newSurgeryMemory()
  return {
    id: 'surgery',
    plan(w, out) {
      const st = read()
      if (st) planSurgery(st, mem, w, out)
    },
  }
}

// The live surgery state: the sim is loaded on the first plan (never at import), and read afresh on every plan (a Jump swaps it).
let live: typeof import('@/sim') | null = null
let loading = false
function liveSurgery(): SurgeryState | null {
  if (live) return live.sim.surgery.state
  if (!loading) {
    loading = true
    void import('@/sim').then((m) => {
      live = m
    })
  }
  return null
}

/** What `DeviceSounds.tsx` registers from this file (every `*Patterns.ts` that exports it). */
export const devicePatterns: DevicePattern[] = [createSurgeryPattern(liveSurgery)]
