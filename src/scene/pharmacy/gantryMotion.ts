/**
 * What the picker's hand and the dock's transfer tray should be doing, as pure functions of the sim's gantry state and
 * its timer. The carriage position (x, y) comes from the sim's interpolated `renderX` / `renderY`; this adds the part the
 * sim does not model: the arm reaching into a bin or out to the tray, the fingers closing on a pack, and the tray carrying
 * the pack across the gap into the docked pod's side hatch.
 *
 *   toBin    arm retracted, fingers open
 *   picking  arm reaches to the bin (first 40%), fingers close (about 40 to 55%), arm retracts with the pack (60 to 100%)
 *   toPort   the carriage rises to the top port (`PHARMACY.dockPortY`); arm retracted, pack held
 *   dropping the arm pushes the pack onto the tray's back end (0 to 26%), the fingers open (the pack is released at 28%) and
 *            the arm retracts (44 to 72%); the tray slides out through the port carrying the pack (30 to 64%), the pack
 *            slides off its front into the pod's hatch (70 to 91%), and the tray slides back (91 to 100%, then on into
 *            the next state: the tray is not part of the carriage, so it may finish after the state has changed)
 *
 * The values are smooth in time and continuous across state changes (every state starts and ends with the arm
 * retracted), so the renderer only has to filter them lightly to hide the 60 Hz stepping. The tray's displayed
 * extension is a speed-limited follower of its target (`followTray`).
 */
import { CONFIG } from '@/sim/config'
import type { GantryState } from '@/sim/types'
import { MV, PACK, TRAY, TRAY_TRAVEL } from './layout'

export interface HandTargets {
  /** Arm extension in metres (0 = retracted). */
  reach: number
  /** 0 = open, 1 = closed on a pack. */
  grip: number
  /** Whether the hand holds the pack. */
  holding: boolean
  /** The pack left the hand and lies on the tray, until it has gone into the pod. */
  onTray: boolean
  /** Wanted tray extension: 0 = stowed behind the glass, 1 = poking into the hatch. */
  tray: number
  /** 0..1 progress of the pack sliding off the tray's front into the pod. */
  enter: number
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/** Fraction of a timed state that has elapsed, from the sim's remaining timer. */
export function progress(timer: number, duration: number): number {
  return duration > 0 ? Math.max(0, Math.min(1, 1 - timer / duration)) : 1
}

/** The pack is let go when the fingers are about half open; the arm retracts only after they are fully open. */
export const RELEASE = 0.28
/** Phases of `dropping` (fractions of its duration). */
export const DROP = {
  armOut: [0, 0.26],
  armBack: [0.44, 0.72],
  trayOut: [0.3, 0.64],
  enter: [0.7, 0.91],
  trayBack: [0.91, 1],
} as const

export function handTargets(state: GantryState, timer: number, out: HandTargets): HandTargets {
  out.reach = 0
  out.grip = 0
  out.holding = false
  out.onTray = false
  out.tray = 0
  out.enter = 0
  switch (state) {
    case 'picking': {
      const k = progress(timer, CONFIG.pharmacy.pickSeconds)
      out.reach = MV.reachBin * (smoothstep(0, 0.4, k) - smoothstep(0.6, 1, k))
      out.grip = smoothstep(0.38, 0.55, k)
      out.holding = k >= 0.5
      break
    }
    case 'toPort':
      out.grip = 1
      out.holding = true
      break
    case 'dropping': {
      const k = progress(timer, CONFIG.pharmacy.dropSeconds)
      out.reach = MV.reachTray * (smoothstep(DROP.armOut[0], DROP.armOut[1], k) - smoothstep(DROP.armBack[0], DROP.armBack[1], k))
      out.grip = 1 - smoothstep(RELEASE - 0.06, RELEASE + 0.1, k)
      out.holding = k < RELEASE
      out.enter = smoothstep(DROP.enter[0], DROP.enter[1], k)
      out.onTray = k >= RELEASE && out.enter < 1
      out.tray = smoothstep(DROP.trayOut[0], DROP.trayOut[1], k) - smoothstep(DROP.trayBack[0], DROP.trayBack[1], k)
      break
    }
    default:
      break
  }
  return out
}

/** Filter rate (per second of sim time) that rounds the tray's motion; the speed limit does the rest. */
const TRAY_RATE = 35

/**
 * One step of the displayed tray extension (0..1) towards its target: a first-order follower (so the 60 Hz stepping of the
 * timer is rounded off) whose speed never exceeds `TRAY.maxSpeed` (a plate that retracts after the state has ended just
 * keeps going at that speed). Snaps shut when it is a hair from stowed.
 */
export function followTray(current: number, target: number, simDt: number): number {
  const rate = 1 - Math.exp(-simDt * TRAY_RATE)
  const limit = (TRAY.maxSpeed / TRAY_TRAVEL) * simDt
  const next = current + Math.max(-limit, Math.min(limit, (target - current) * rate))
  return target === 0 && next < 0.002 ? 0 : next
}

export interface PackPose {
  /** Distance out from the island centre line, and height. */
  out: number
  y: number
  /** 1 = full size; shrinks away only at the very end, once the pack is inside the pod (its body hides it from outside). */
  scale: number
}

/** Where the pack is while it lies on the tray (`ext` = the tray's displayed extension) and slides off into the pod (`enter`). */
export function trayPackPose(ext: number, enter: number, out: PackPose): PackPose {
  out.out = TRAY.stowedBack + TRAY.packAt + ext * TRAY_TRAVEL + enter * TRAY.enter
  out.scale = 1 - smoothstep(0.9, 1, enter)
  // it stands on the plate (5 mm above the plate's top, like the held pack under the palm)
  out.y = TRAY.topY + 0.005 + (PACK.y * out.scale) / 2
  return out
}
