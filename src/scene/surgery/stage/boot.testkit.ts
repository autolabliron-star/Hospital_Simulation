// A test kit, not shipped: the stirrup's boot (src/scene/surgery/table.ts writeBoot) as points the leg sleeves must enclose. The boot lies along the calf from the knee to the
// heel: its sole BOOT_DROP under the calf's axis (12 cm wide, 2.5 cm thick), two padded walls 5.8 cm either side, and the heel board across the far end.
import { LITHOTOMY_LEG, PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { HEEL_REACH } from '../table'

/** table.ts BOOT_DROP (not exported; stage.test.ts pins the two equal from the source). */
export const BOOT_DROP = 0.085

/** The boot's cross-section at any point along it, as (across, up) offsets from the calf's axis: the calf, the sole's two corners and middle, the walls' tops. */
const SECTION: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -BOOT_DROP - 0.0125],
  [0.07, -BOOT_DROP - 0.0125],
  [-0.07, -BOOT_DROP - 0.0125],
  [0.064, -BOOT_DROP + 0.045 + 0.0375],
  [-0.064, -BOOT_DROP + 0.045 + 0.0375],
]
/** The heel board's corners, across the boot's far end. */
const HEEL: readonly (readonly [number, number])[] = [
  [0.065, -BOOT_DROP + 0.05 + 0.055],
  [-0.065, -BOOT_DROP + 0.05 + 0.055],
  [0.065, -BOOT_DROP - 0.0125],
  [-0.065, -BOOT_DROP - 0.0125],
]

/** The axis of the left leg in the boot: knee to ankle (table frame d, x, h) and its length. */
export function bootAxis(): { d0: number; x0: number; h0: number; ud: number; ux: number; uh: number; len: number } {
  const K = LITHOTOMY_LEG.knee
  const A = LITHOTOMY_LEG.ankle
  const d0 = PELVIS_ON_TABLE.lithotomy + K.d
  const d1 = PELVIS_ON_TABLE.lithotomy + A.d
  const len = Math.hypot(d1 - d0, A.x - K.x, A.h - K.h)
  return { d0, x0: K.x, h0: K.h, ud: (d1 - d0) / len, ux: (A.x - K.x) / len, uh: (A.h - K.h) / len, len }
}

/** Points of the left boot (table frame d, x, h), every `step` metres along it, and the heel board's corners at its end. */
export function bootPoints(step = 0.02): [number, number, number][] {
  const a = bootAxis()
  const out: [number, number, number][] = []
  const end = a.len + HEEL_REACH + 0.025
  for (let s = 0; s <= end + 1e-9; s += step) {
    for (const [dx, dh] of SECTION) out.push([a.d0 + a.ud * s, a.x0 + a.ux * s + dx, a.h0 + a.uh * s + dh])
  }
  for (const [dx, dh] of HEEL) out.push([a.d0 + a.ud * end, a.x0 + a.ux * end + dx, a.h0 + a.uh * end + dh])
  return out
}
