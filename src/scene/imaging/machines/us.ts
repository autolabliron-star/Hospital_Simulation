/**
 * The ultrasound cart, the probe with the sonographer's hand and the probe cable as geometry (pure builders). The room draws the
 * couch, the stool and the cabinets; the cart footprint it reserves is 0.7 (x) x 0.9 (z) round the anchor, and everything static
 * here stays inside it. The cart's front (control panel) faces north (-z); its monitor turns on its arm toward the stool.
 *
 *   cart    world coordinates, static
 *   probe   local frame: the lens centre at the origin, +y up the probe; the hand is drawn AFTER the probe in the vertex list, so
 *           `setDrawRange(0, probeVertices)` shows the probe alone (parked) and the full range shows the hand on it
 *   cable   a unit box along z; the rig scales and rotates it between the probe and the cart every frame
 */
import { BoxGeometry, type BufferGeometry } from 'three'
import { bake, bx, capsule, COL, cyl, merge, rbox, rbx, sphere, tube } from './geometry'
import { monitorHead, screenPlane } from './monitors'
import { US_CART } from './motion'

const X = US_CART.x
const Z = US_CART.z

/** The cart's extent the room reserves (m), for tests. */
export const US_FOOTPRINT = { halfX: 0.35, halfZ: 0.45 } as const

/** Where the cable leaves the probe, in the probe's frame. */
export const PROBE_CABLE_ANCHOR = { x: 0, y: 0.145, z: 0 } as const

export function buildUsCart(): BufferGeometry {
  const parts: BufferGeometry[] = [
    bx(X - 0.28, X + 0.28, 0.07, 0.12, Z - 0.38, Z + 0.38, COL.dark),
    rbx(X - 0.26, X + 0.26, 0.12, 0.4, Z - 0.34, Z + 0.34, 0.04, COL.white),
    bx(X - 0.2, X + 0.2, 0.2, 0.3, Z - 0.344, Z - 0.338, COL.dark),
    // the spine: chassis up to the monitor's neck
    rbx(X - 0.1, X + 0.1, 0.4, 1.12, Z - 0.02, Z + 0.3, 0.03, COL.white),
    // control panel (tilted toward the sonographer), keyboard, trackball and the probe socket
    rbox(0.5, 0.035, 0.34, 0.012, COL.white, { x: X, y: 0.9, z: Z - 0.04, rx: -0.12 }),
    rbox(0.42, 0.012, 0.15, 0.005, COL.dark, { x: X, y: 0.924, z: Z - 0.08, rx: -0.12 }),
    sphere(0.02, COL.greyMid, { x: X + 0.14, y: 0.918, z: Z - 0.17 }),
    bx(X, X + 0.1, 0.89, 0.93, Z - 0.22, Z - 0.18, COL.dark),
    // the monitor on its neck
    cyl('y', 0.028, 0.14, COL.dark, { x: X, y: 1.17, z: Z + 0.2 }),
    monitorHead(US_CART.monitor.x, US_CART.monitor.y, US_CART.monitor.z, US_CART.monitor.yaw, US_CART.monitor.w, US_CART.monitor.h),
    // the probe holder on the couch side: a bracket and a cup (the parked probe's lens rests on the cup's floor)
    bx(X - 0.31, X - 0.2, 0.86, 0.89, Z - 0.15, Z - 0.09, COL.dark),
    tube('y', 0.042, 0.032, 0.07, COL.grey, { x: US_CART.holder.x, y: 0.925, z: US_CART.holder.z }, 20),
    cyl('y', 0.042, 0.012, COL.grey, { x: US_CART.holder.x, y: 0.895, z: US_CART.holder.z }, 20),
    // the gel bottle on the other side
    bx(X + 0.2, X + 0.31, 0.86, 0.89, Z - 0.15, Z - 0.09, COL.dark),
    tube('y', 0.04, 0.032, 0.05, COL.grey, { x: X + 0.3, y: 0.915, z: Z - 0.12 }, 20),
    cyl('y', 0.03, 0.14, COL.gel, { x: X + 0.3, y: 0.965, z: Z - 0.12 }, 16),
    cyl('y', 0.012, 0.03, COL.white, { x: X + 0.3, y: 1.05, z: Z - 0.12 }, 12, 0.008),
  ]
  // four casters: a wheel and a fork each
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(cyl('x', 0.05, 0.03, COL.rubber, { x: X + sx * 0.26, y: 0.05, z: Z + sz * 0.31 }, 14))
      parts.push(bx(X + sx * 0.26 - 0.022, X + sx * 0.26 + 0.022, 0.05, 0.12, Z + sz * 0.31 - 0.02, Z + sz * 0.31 + 0.02, COL.dark))
    }
  }
  return merge(parts)
}

/** The monitor's textured plane (UV-cropped to the screen's aspect), in front of the cart's monitor head. */
export function buildUsMonitor(): BufferGeometry {
  const m = US_CART.monitor
  const k = 0.025 + 0.002
  return screenPlane(m.w, m.h, { x: m.x + Math.sin(m.yaw) * k, y: m.y, z: m.z + Math.cos(m.yaw) * k, ry: m.yaw })
}

export interface ProbeGeometry {
  geometry: BufferGeometry
  /** Vertices of the probe alone (the hand's vertices follow). */
  probeVertices: number
}

/** The probe (a transducer with a dark lens) and, after it in the vertex list, the hand holding it. */
export function buildUsProbe(): ProbeGeometry {
  const probe: BufferGeometry[] = [
    rbx(-0.025, 0.025, 0.012, 0.115, -0.016, 0.016, 0.008, COL.white),
    rbx(-0.028, 0.028, 0, 0.016, -0.02, 0.02, 0.006, COL.rubber),
    rbx(-0.026, 0.026, 0.075, 0.1, -0.017, 0.017, 0.006, COL.greyMid),
    cyl('y', 0.012, 0.025, COL.dark, { y: 0.125 }, 10),
  ]
  let probeVertices = 0
  for (const p of probe) probeVertices += p.getAttribute('position').count
  const hand: BufferGeometry[] = [
    rbox(0.085, 0.03, 0.085, 0.014, COL.skin, { x: 0.005, y: 0.13 }),
    // four fingers down the west face, the thumb on the east
    ...[-0.03, -0.01, 0.01, 0.03].map((z) => capsule('y', 0.0085, 0.085, COL.skin, { x: -0.034, y: 0.082, z })),
    capsule('y', 0.0095, 0.06, COL.skin, { x: 0.033, y: 0.092 }),
    // the wrist and a scrub cuff, running east toward the sonographer
    capsule('x', 0.026, 0.12, COL.skin, { x: 0.1, y: 0.135 }),
    cyl('x', 0.031, 0.05, COL.teal, { x: 0.17, y: 0.138 }, 14),
  ]
  return { geometry: merge([...probe, ...hand]), probeVertices }
}

/** A unit box along z (length 1, section 1 x 1): scaled to the cable's length and thickness every frame. */
export function buildUsCable(): BufferGeometry {
  return bake(new BoxGeometry(1, 1, 1), COL.darker)
}
