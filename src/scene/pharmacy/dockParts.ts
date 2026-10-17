/**
 * Geometry of the glowing dock-port lights, the charging-contact glow strips and the portal flaps (pure three.js, shared by
 * DockGlow, RailPortals and the budget test).
 */
import { BoxGeometry, type BufferGeometry } from 'three'
import { CONTACT, PORT } from './layout'

/** The soft light strip under a dock port's sill, on the rail side (outside the glass). */
export function portGlowGeometry(): BufferGeometry {
  return new BoxGeometry(PORT.glow.w, PORT.glow.h, PORT.glow.d)
}

/** One glow strip along a charging contact. */
export function rankGlowGeometry(): BufferGeometry {
  return new BoxGeometry(CONTACT.glow.t, CONTACT.glow.h, CONTACT.length - 0.04)
}

/** A unit box that hangs from its top edge (the hinge line): scale by (width, length, thickness), then rotate about x. */
export function flapGeometry(): BufferGeometry {
  return new BoxGeometry(1, 1, 1).translate(0, -0.5, 0)
}
