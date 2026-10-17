/**
 * Colours of the L1 look that the shared palette (src/scene/materials.ts) does not carry. The orchestrator owns the palette, so the
 * meal peach lives here; everything else is taken from `STATUS` and `WAYFINDING`.
 */
import { STATUS } from '@/scene/materials'

export const PEACH = {
  /** The MealBot's light ring when it carries meals, and the host's lanyard: a warm peach, never the pods' teal. */
  light: '#f2a07c',
  /** Softer peach for stripes and chips. */
  soft: '#f7c3a8',
  /** The inside of the tray cabinet. */
  cream: '#f3e6d8',
} as const

/** Door tile colours by bed state (see docs/L1-LIVING-DAY.md, "Bed flow"). Soft blue is the discharge colour. */
export const TILE_COLORS = {
  white: STATUS.idle,
  softBlue: '#8fbdf2',
  amber: STATUS.amber,
  green: STATUS.green,
  teal: STATUS.teal,
} as const
