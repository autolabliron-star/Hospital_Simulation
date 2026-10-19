/**
 * R2: the da Vinci 5 patient cart is solid for you. Its base (places.ts SURGERY.cart.size: 0.98 m wide, 1.49 m long along its heading, the rig draws it at the
 * same place: rig.ts writeCart) is published as one moving blocker (src/scene/blockers.ts, the registry the door leaves use), rewritten every frame from
 * `sim.surgery.state.robot.cart` before you move: parked by the west wall, turning, driving in, docked beside the table and driving back, it stops your body
 * where it stands, and pushes you out of its way while it moves (collision.ts step 0). Sim coordinates, as the robot state and your body are. Pure: no
 * three.js, no React; SurgeryLayer.tsx registers the source and writes it at FRAME_PRIORITY.doors.
 */
import { BLOCKER_STRIDE, type BlockerSource } from '@/scene/blockers'
import { SURGERY } from '@/sim/places'
import type { RobotState } from '@/sim/types'

/** Half the cart's footprint: along its heading (u) and across it (v). */
export const CART_HALF = { u: SURGERY.cart.size.l / 2, v: SURGERY.cart.size.w / 2 } as const

/** The blocker source of the cart: one box, empty until the first write. */
export function createCartBlockers(): BlockerSource {
  return { name: 'da Vinci cart', count: 0, data: new Float64Array(BLOCKER_STRIDE) }
}

/** Write the cart's footprint at `o` of `out` (cx, cz, the unit axis along its heading, the half extents along and across it). Returns the boxes written: 1. */
export function writeCartBlocker(cart: RobotState['cart'], out: Float64Array, o = 0): number {
  out[o] = cart.x
  out[o + 1] = cart.z
  out[o + 2] = Math.sin(cart.heading)
  out[o + 3] = Math.cos(cart.heading)
  out[o + 4] = CART_HALF.u
  out[o + 5] = CART_HALF.v
  return 1
}
