/**
 * The MRI scanner as geometry (pure builders, no meshes): a magnet with a 0.7 m bore, a base cabinet, the moving table top and
 * three coils, and the blue LED ring. World coordinates for the static parts; the table top and the coils are built in the table's
 * own frame (x from the table's centre, y absolute, z from the table's centre line) and ride a group that `rig.ts` moves.
 *
 * Orientation: the bore axis runs along world x, the patient lies head EAST (+x), the table slides east into the bore. The magnet
 * is an extruded rounded rectangle (built in the XY plane, extruded along z, then turned so z becomes +x).
 */
import type { BufferGeometry } from 'three'
import type { ConsoleScreen } from '@/scene/building/layout'
import { IMAGING } from '@/sim/places'
import { bake, bx, COL, cyl, extrudeFlat, extrudeSoft, GlowBuilder, type GlowGeometry, merge, paintTriangles, rbx, roundedShape, torus, tube } from './geometry'
import { consoleFurniture } from './monitors'
import { COIL_OFFSET, CRADLE, type CoilKind } from './motion'

const A = IMAGING.mri.machine
const H = IMAGING.mri.table.height

/** The numbers of the drawing (the room reserves x +-1.075, z +-1.1 around the anchor for the magnet). */
export const MRI = {
  /** Half the depth of the magnet along x (cap to cap), and its width (z) and height range (y). */
  halfDepth: 0.95,
  width: 2.2,
  y0: 0.05,
  y1: 2.15,
  boreR: 0.35,
  boreY: 1.1,
  bevelT: 0.09,
  bevelS: 0.07,
  /** The base cabinet the table top slides over: x from the anchor, half width, top. Under the table's head end when it is out. */
  base: { x0: A.x - 3.0, x1: A.x - 1.2, halfZ: 0.31, top: 0.7 },
  /** The table top: underside, slab top, pad top (= the patient's surface, IMAGING.mri.table.height). */
  cradle: { y0: 0.705, y1: 0.75, top: H },
  /** The LED ring round the bore on the front (west) face. */
  led: { r: 0.49, tube: 0.012, color: '#3d8bff' },
} as const

const FRONT_X = A.x - MRI.halfDepth

/** The magnet body, its front facia, the back service panel, the top cover and the plinth (world coordinates). */
export function buildMriMagnet(): BufferGeometry {
  const { bevelT: t, bevelS: s, boreY, boreR } = MRI
  const depth = 2 * MRI.halfDepth
  // the caps keep this outline; the middle of the body is `s` larger all round and the bore `s` smaller
  const shape = roundedShape(0, boreY, MRI.width - 2 * s, MRI.y1 - MRI.y0 - 2 * s, 0.45, [[0, boreY, boreR + s]], 64)
  const body = bake(extrudeSoft(shape, depth - 2 * t, t, s, 4), COL.white, { ry: Math.PI / 2, x: A.x, z: A.z })
  // the bore wall and its flared rim take the liner colour (a triangle at a time: no blend across the caps)
  paintTriangles(body, (tri) => {
    for (let k = 0; k < 3; k++) if (Math.hypot(tri[3 * k + 1] - boreY, tri[3 * k + 2] - A.z) > boreR + s + 0.02) return null
    return COL.liner
  })

  const parts: BufferGeometry[] = [body]
  // a grey facia plate on the front cap, round the LED ring (the ring sits on the bare cap between the bore and the plate)
  const facia = extrudeFlat(roundedShape(0, boreY, MRI.width - 2 * s - 0.22, MRI.y1 - MRI.y0 - 2 * s - 0.22, 0.36, [[0, boreY, 0.6]], 64), 0.012)
  parts.push(bake(facia, COL.grey, { ry: Math.PI / 2, x: FRONT_X - 0.006, z: A.z }))
  // back (east) cap: a dark service panel with grey vent slats
  const backX = A.x + MRI.halfDepth
  // (below the bore: the bore is open at both ends, its lower edge is at 0.75)
  parts.push(bx(backX - 0.01, backX + 0.012, 0.22, 0.62, A.z - 0.6, A.z + 0.6, COL.dark))
  for (let i = 0; i < 4; i++) parts.push(bx(backX + 0.008, backX + 0.018, 0.27 + i * 0.09, 0.3 + i * 0.09, A.z - 0.5, A.z + 0.5, COL.greyMid))
  // top: a service cover with two vents
  parts.push(rbx(A.x - 0.6, A.x + 0.6, MRI.y1 - 0.004, MRI.y1 + 0.016, A.z - 0.5, A.z + 0.5, 0.01, COL.grey))
  for (const k of [-1, 1]) parts.push(bx(A.x + k * 0.3 - 0.22, A.x + k * 0.3 + 0.22, MRI.y1 + 0.012, MRI.y1 + 0.02, A.z - 0.3, A.z + 0.3, COL.dark))
  // plinth
  parts.push(bx(A.x - 0.85, A.x + 0.85, 0, 0.06, A.z - 0.85, A.z + 0.85, COL.dark))
  return merge(parts)
}

/** The base cabinet in front of the magnet: the table top rides on it when it is out. */
export function buildMriBase(): BufferGeometry {
  const b = MRI.base
  const z0 = A.z - b.halfZ
  const z1 = A.z + b.halfZ
  return merge([
    rbx(b.x0, b.x1, 0.08, b.top, z0, z1, 0.04, COL.white),
    bx(b.x0 + 0.05, b.x1 - 0.05, 0, 0.08, A.z - b.halfZ + 0.04, A.z + b.halfZ - 0.04, COL.dark),
    // a mid-grey trim band and a small dark control panel on each long side
    bx(b.x0 + 0.04, b.x1 - 0.04, 0.5, 0.52, z0 - 0.002, z1 + 0.002, COL.grey),
    rbx(b.x0 + 0.3, b.x0 + 0.75, 0.22, 0.4, z0 - 0.004, z0 + 0.004, 0.01, COL.dark),
    rbx(b.x0 + 0.3, b.x0 + 0.75, 0.22, 0.4, z1 - 0.004, z1 + 0.004, 0.01, COL.dark),
  ])
}

/** Everything that never moves, as ONE geometry: the magnet, the base and the bezels and stands of the control-room monitors. */
export function buildMriStatic(screens: readonly ConsoleScreen[]): BufferGeometry {
  return merge([buildMriMagnet(), buildMriBase(), ...consoleFurniture(screens)])
}

/**
 * The moving table top in the table's frame: a thin rounded slab 2.2 x 0.46 with a teal pad whose top is the patient's surface.
 * (The bore is 0.7 m: the slab's edges tuck into the bore wall, which hides them; the middle of the pad shows.)
 */
export function buildMriCradle(): BufferGeometry {
  const { y0, y1, top } = MRI.cradle
  const half = CRADLE.length / 2
  const hw = CRADLE.width / 2
  return merge([rbx(-half, half, y0, y1, -hw, hw, 0.022, COL.white), rbx(-half + 0.05, half - 0.05, y1 - 0.001, top, -hw + 0.03, hw - 0.03, 0.012, COL.teal)])
}

/** A coil in the table's frame (x from the table's centre). One of them rides the table at a time. */
export function buildMriCoil(kind: CoilKind): BufferGeometry {
  const c = COIL_OFFSET[kind]
  const top = MRI.cradle.top
  if (kind === 'head') {
    // a cage open at the front: a base, two side plates, a back plate and three top arches
    const parts: BufferGeometry[] = [
      rbx(c - 0.2, c + 0.2, top, top + 0.035, -0.18, 0.18, 0.012, COL.white),
      rbx(c - 0.2, c + 0.17, top, top + 0.3, -0.19, -0.165, 0.01, COL.white),
      rbx(c - 0.2, c + 0.17, top, top + 0.3, 0.165, 0.19, 0.01, COL.white),
      rbx(c + 0.17, c + 0.2, top, top + 0.3, -0.19, 0.19, 0.01, COL.white),
    ]
    for (const dx of [-0.14, 0, 0.12]) parts.push(rbx(c + dx - 0.02, c + dx + 0.02, top + 0.275, top + 0.31, -0.2, 0.2, 0.01, COL.dark))
    parts.push(rbx(c - 0.2, c - 0.17, top + 0.2, top + 0.3, -0.19, 0.19, 0.008, COL.grey)) // the visor's top rail
    return merge(parts)
  }
  if (kind === 'knee') {
    // a ring round the knee with a dark window on each side
    return merge([
      tube('x', 0.19, 0.15, 0.3, COL.white, { x: c, y: top + 0.17 }, 36),
      rbx(c - 0.08, c + 0.08, top + 0.12, top + 0.24, 0.186, 0.2, 0.008, COL.dark),
      rbx(c - 0.08, c + 0.08, top + 0.12, top + 0.24, -0.2, -0.186, 0.008, COL.dark),
      cyl('x', 0.012, 0.1, COL.grey, { x: c + 0.2, y: top + 0.08 }),
    ])
  }
  // spine: a flat array pad under the lower back, with a teal strip and a connector
  return merge([
    rbx(c - 0.22, c + 0.22, top, top + 0.04, -0.2, 0.2, 0.014, COL.liner),
    rbx(c - 0.17, c + 0.17, top + 0.038, top + 0.044, -0.15, 0.15, 0.006, COL.teal),
    bx(c + 0.22, c + 0.28, top, top + 0.025, -0.04, 0.04, COL.dark),
  ])
}

/** The blue LED ring on the front face, round the bore. */
export function buildMriGlow(): GlowGeometry {
  const ring = torus('x', MRI.led.r, MRI.led.tube, MRI.led.color, { x: FRONT_X - 0.004, y: MRI.boreY, z: A.z }, 72)
  return new GlowBuilder().region('led', MRI.led.color, [ring]).build()
}
