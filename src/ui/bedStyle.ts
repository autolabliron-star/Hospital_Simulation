/**
 * How a bed state looks on the HUD and on the command wall (the colours of the L1 brief's table): occupied white, discharge
 * signed and leaving soft blue, needs cleaning and cleaning amber, ready green, reserved teal. `leaving` and `cleaning`
 * are the "in progress" states (the door tiles pulse them; the wall, which redraws only on change, stripes them).
 * Pure data: no React, no canvas.
 */
import { STATUS } from '@/scene/materials'
import type { BedState } from '@/sim/types'

export const BED_COLOR: Readonly<Record<BedState, string>> = {
  occupied: '#f2f5f5',
  dischargeSigned: '#9ccaf2',
  leaving: '#9ccaf2',
  needsCleaning: STATUS.amber,
  cleaning: STATUS.amber,
  ready: STATUS.green,
  reserved: STATUS.teal,
}

/** Text colour that reads on the tile of that state. */
export const BED_INK: Readonly<Record<BedState, string>> = {
  occupied: '#13201f',
  dischargeSigned: '#0f2740',
  leaving: '#0f2740',
  needsCleaning: '#3a2200',
  cleaning: '#3a2200',
  ready: '#06301a',
  reserved: '#ffffff',
}

export function isInProgress(state: BedState): boolean {
  return state === 'leaving' || state === 'cleaning'
}

/** A patient still has this bed: lying in it, signed off, or on the way out. */
export function isBedTaken(state: BedState): boolean {
  return state === 'occupied' || state === 'dischargeSigned' || state === 'leaving'
}
