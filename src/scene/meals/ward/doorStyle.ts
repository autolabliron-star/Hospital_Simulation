/** How a door tile shows a bed's state (docs/L1-LIVING-DAY.md, "Bed flow"): a colour, how hard it glows, and whether it pulses. */
import { Color } from 'three'
import { BED_STATES, type BedState } from '@/sim/types'
import { TILE_COLORS } from '../palette'

export interface DoorStyle {
  color: string
  /** Multiplier pushed above 1 so a lit tile blooms a little, like the status lights; white stays calm. */
  gain: number
  pulse: boolean
}

export const DOOR_STYLE: Record<BedState, DoorStyle> = {
  occupied: { color: TILE_COLORS.white, gain: 0.85, pulse: false },
  dischargeSigned: { color: TILE_COLORS.softBlue, gain: 1.25, pulse: false },
  leaving: { color: TILE_COLORS.softBlue, gain: 1.25, pulse: true },
  needsCleaning: { color: TILE_COLORS.amber, gain: 1.45, pulse: false },
  cleaning: { color: TILE_COLORS.amber, gain: 1.45, pulse: true },
  ready: { color: TILE_COLORS.green, gain: 1.45, pulse: false },
  reserved: { color: TILE_COLORS.teal, gain: 1.45, pulse: false },
}

/** The instance colour of each state, in `BED_STATES` order (linear, gain applied). Built once. */
export const DOOR_COLORS: readonly Color[] = BED_STATES.map((s) => new Color(DOOR_STYLE[s].color).multiplyScalar(DOOR_STYLE[s].gain))

export const DOOR_PULSE: readonly number[] = BED_STATES.map((s) => (DOOR_STYLE[s].pulse ? 1 : 0))

export function bedStateIndex(bed: BedState): number {
  return BED_STATES.indexOf(bed)
}
