/**
 * R3 (endoscope): what one picture shows, as plain numbers: the view model every endoscope painter reads (the shared live texture, the console card, the
 * probe's previews), filled from the sim's `SurgeryState` without allocating.
 *
 *   procedure   the current case's procedure picks the plate (cholecystectomy when there is no case).
 *   looks       each instrument arm's `instrument` through the content's name-to-look map (looks.ts).
 *   withdraw    from the arm's `engage` (the sim withdraws an arm to 0.55 engaged during an instrument exchange, and engages it 0 -> 1 while docking and
 *               1 -> 0 while undocking): 0 the tool is in place, 1 it is all the way back out of the picture. The look changes at the exchange's middle,
 *               when the tool is out of sight.
 *   energy      the pedal: short seeded bursts for a tool that has energy (bipolar or monopolar), only while it is in place and the console is live; one
 *               tool at a time.
 *   camera      arm 2 (the endoscope) moves with the same seeded `tipMotion` as the 3D arm: its yaw and pitch pan the picture, its insertion zooms; the
 *               ventilator's breathing lifts and swells the field slowly.
 */
import type { SurgeryState } from '@/sim/types'
import { h01, motionGain, TIP, tipMotion, type TipMotion } from '../robotPose'
import { PLATE_ASPECT, procIndex } from './anatomy'
import { clamp01, smooth } from './field'
import { ENERGY, LOOKS, lookIndexOf } from './looks'
import { SURGERY_COPY } from '@/content/surgery'

/** The instrument arms, by slot: arm 1 (index 0), arm 3 (index 2), arm 4 (index 3). Arm 2 (index 1) is the camera, never in its own picture. */
export const INSTRUMENT_ARMS: readonly number[] = [0, 2, 3]
export const SLOTS = 3

export interface EndoView {
  /** The case's `motionSeed`. */
  seed: number
  /** Sim seconds. */
  t: number
  /** 0..1: how much the instruments and the camera move (the robot's `motionGain`); still at 0. */
  gain: number
  /** The plate: 0 cholecystectomy, 1 hysterectomy, 2 prostatectomy. */
  proc: number
  /** Per slot: the look index (looks.ts LOOKS) or -1 for none, how far withdrawn 0..1, the energy pedal 0..1. */
  look: number[]
  withdraw: number[]
  energy: number[]
  /** The slot being exchanged, or -1. */
  exchanging: number
}

/** A view of the cholecystectomy's instruments, docked and still: a starting point the painters and tests fill in. */
export function newEndoView(over: Partial<Pick<EndoView, 'seed' | 't' | 'gain' | 'proc'>> = {}): EndoView {
  const v: EndoView = { seed: 7, t: 0, gain: 1, proc: 0, look: [-1, -1, -1], withdraw: [0, 0, 0], energy: [0, 0, 0], exchanging: -1, ...over }
  setProcedureLooks(v, v.proc)
  return v
}

const PROC_KEYS = ['cholecystectomy', 'hysterectomy', 'prostatectomy'] as const

/** Fit the procedure's own instruments (surgery.json) to the slots. */
export function setProcedureLooks(v: EndoView, proc: number): EndoView {
  const names = SURGERY_COPY.procedures[PROC_KEYS[proc] ?? 'cholecystectomy'].instruments
  for (let k = 0; k < SLOTS; k++) v.look[k] = lookIndexOf(names[INSTRUMENT_ARMS[k]] ?? '')
  v.proc = proc
  return v
}

/** How far an arm's tool is withdrawn, from its engagement: in place at 1, out of the picture at 0.55 (the bottom of an exchange) and below. */
export function withdrawOf(engage: number): number {
  return clamp01((1 - engage) / 0.45)
}

/** The energy pedal of slot `k` at `t` (0..1): seeded bursts of about a second every 7 to 13 s. */
export function energyAt(k: number, seed: number, t: number): number {
  const period = 7 + 6 * h01(seed, 60 + k, 1)
  const len = 0.8 + 0.9 * h01(seed, 60 + k, 2)
  const x = (t + period * h01(seed, 60 + k, 3)) % period
  return smooth(0, 0.08, x) * smooth(len, len - 0.08, x)
}

/** Fill `out` from the theatre and the robot at sim time `t`. Allocates nothing. */
export function fillEndoView(s: Readonly<SurgeryState>, t: number, out: EndoView): EndoView {
  const r = s.robot
  out.seed = r.motionSeed
  out.t = t
  out.gain = motionGain(r, t)
  const id = s.theatre.caseId
  if (id !== null) {
    const cases = s.theatre.cases
    for (let i = 0; i < cases.length; i++) {
      if (cases[i].id === id) {
        out.proc = procIndex(cases[i].procedure)
        break
      }
    }
  }
  out.exchanging = -1
  let pedal = false
  for (let k = 0; k < SLOTS; k++) {
    const arm = r.arms[INSTRUMENT_ARMS[k]]
    const look = lookIndexOf(arm.instrument)
    const w = withdrawOf(arm.engage)
    out.look[k] = look
    out.withdraw[k] = w
    if (r.phase === 'docked' && arm.engage < 0.999 && out.exchanging < 0) out.exchanging = k
    let e = 0
    if (!pedal && look >= 0 && LOOKS[look].energy !== ENERGY.none && w < 0.02 && out.gain > 0.85) e = energyAt(k, out.seed, t)
    if (e > 0) pedal = true
    out.energy[k] = e
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The camera
// ---------------------------------------------------------------------------------------------

/** How much of the plate's height the window shows at rest, the pan's reach (of the margin left), the zoom from the insertion, the breathing. */
export const CAMERA = { visible: 0.86, pan: 0.85, zoom: 0.05, breathHz: 0.23, breathZoom: 0.012, breathLift: 0.006 } as const
/** The window's half-height at rest (plate units): one frame unit. */
export const REST_HALF = CAMERA.visible / 2

/** Where the camera looks on the plate: the window's centre and half-height in plate units (the plate is 1 high and 16/9 wide), and the breathing phase. */
export interface CameraPose {
  cx: number
  cy: number
  hh: number
  breath: number
}

const _cm: TipMotion = { insert: 0, pitch: 0, yaw: 0, jaw: 0, roll: 0 }

/** The camera of `v` (arm 2's tip motion, and the breathing). Writes into `out`. */
export function cameraPose(v: EndoView, out: CameraPose): CameraPose {
  tipMotion(1, v.t, v.seed, _cm)
  const g = v.gain
  // arm 2's motion is scaled down to 0.35 of the others' in tipMotion: these divide it back to about -1..1
  const yaw = _cm.yaw / (TIP.yaw * 0.35)
  const pitch = _cm.pitch / (TIP.pitch * 0.35)
  const ins = _cm.insert / (TIP.insert * 0.35)
  const breath = Math.sin(2 * Math.PI * CAMERA.breathHz * v.t)
  const zoom = (1 + ins * CAMERA.zoom * g) * (1 + CAMERA.breathZoom * breath)
  const hh = REST_HALF / zoom
  const hw = hh * PLATE_ASPECT
  out.hh = hh
  out.cx = PLATE_ASPECT / 2 + yaw * g * (PLATE_ASPECT / 2 - hw) * CAMERA.pan
  out.cy = 0.5 + pitch * g * (0.5 - hh) * CAMERA.pan + CAMERA.breathLift * breath
  out.breath = breath
  return out
}
