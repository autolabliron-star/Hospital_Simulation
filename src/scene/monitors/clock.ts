/**
 * R3 live patient monitors: the display clock. A monitor's traces move in REAL time (a heart beats about once a second whatever the sim's speed),
 * so they run on their own clock: it advances with the frame's real `dt` and stands still while the sim is paused (the picture freezes, like a
 * monitor's freeze key). The slow numbers (the phase of a case, the NIBP schedule, the settling in recovery) follow the SIM clock instead.
 *
 * One clock is shared by every monitor: the frame callback advances it, the pump (hub.ts) reads it.
 */
import { hourAt } from '@/sim/population/schedule'

/** A frame longer than this (a hitch, a hidden tab coming back) advances the traces by this much only. */
export const MAX_STEP = 0.1

export class DisplayClock {
  /** Seconds of display time since the monitors were created. */
  t = 0

  /** Advance by a frame's real `dt` (clamped), unless paused. Returns the new time. Allocation-free. */
  advance(dt: number, paused: boolean): number {
    if (!paused && dt > 0) this.t += dt < MAX_STEP ? dt : MAX_STEP
    return this.t
  }
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

/** `HH:MM` of a sim time (the monitor's header clock shows the hospital's time). */
export function clockText(simT: number): string {
  const h = hourAt(simT)
  const hh = Math.floor(h) % 24
  const mm = Math.floor((h - Math.floor(h)) * 60 + 1e-6) % 60
  return `${pad2(hh)}:${pad2(mm)}`
}
