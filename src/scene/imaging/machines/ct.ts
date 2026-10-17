/**
 * The CT scanner as geometry (pure builders): a gantry housing with a 1.2 m aperture, a static bore liner, the ROTOR ring that
 * spins in the recess behind the aperture, a pedestal and a moving cantilever table top, plus the red laser lines and the status
 * strip (glow). Bore axis along world x, patient head EAST. World coordinates for static parts; the table top is built in the
 * table's frame (x from its centre, y absolute) and the rotor about its own centre (the axis through the origin).
 */
import type { BufferGeometry } from 'three'
import type { ConsoleScreen } from '@/scene/building/layout'
import { IMAGING } from '@/sim/places'
import { bake, box, bx, COL, extrudeSoft, GlowBuilder, type GlowGeometry, merge, paintTriangles, rbox, rbx, roundedShape, sector, tube } from './geometry'
import { consoleFurniture } from './monitors'
import { CRADLE } from './motion'

const C = IMAGING.ct.machine
const T = IMAGING.ct.table

export const CT = {
  /** Half the depth of the housing along x, its width (z) and height range (y), and the aperture. */
  halfDepth: 0.45,
  width: 1.9,
  y0: 0.03,
  y1: 1.97,
  centreY: 1.0,
  aperture: 0.6,
  /** The static bore liner (inner and outer radius) and how far it reaches past each face. */
  linerIn: 0.38,
  linerOut: 0.4,
  bevelT: 0.05,
  bevelS: 0.04,
  /** The rotor ring: it turns about the x axis through (x, 1.0, z) in the recess just behind the aperture. */
  rotor: { x: C.x - 0.2, rIn: 0.41, rOut: 0.59, depth: 0.14 },
  /** The pedestal the table top slides over (x range, half width, top). */
  base: { x0: C.x - 2.6, x1: C.x - 1.2, halfZ: 0.3, top: 0.74 },
  /** The table top: underside, slab top, pad top (= the patient's surface, IMAGING.ct.table.height). */
  cradle: { y0: 0.745, y1: 0.775, top: T.height },
  /** Status strip on the housing's top (centre x offset, half length along z). */
  strip: { dx: -0.26, halfZ: 0.5 },
} as const

const FRONT_X = C.x - CT.halfDepth

/** The housing, the aperture bezel, the liner, the plug behind the rotor, a status display and the plinth (world coordinates). */
export function buildCtGantry(): BufferGeometry {
  const { bevelT: t, bevelS: s, centreY, aperture } = CT
  const depth = 2 * CT.halfDepth
  const shape = roundedShape(0, centreY, CT.width - 2 * s, CT.y1 - CT.y0 - 2 * s, 0.36, [[0, centreY, aperture + s]], 72)
  const body = bake(extrudeSoft(shape, depth - 2 * t, t, s, 3), COL.white, { ry: Math.PI / 2, x: C.x, z: C.z })
  // the recess wall inside the aperture is grey
  paintTriangles(body, (tri) => {
    for (let k = 0; k < 3; k++) if (Math.hypot(tri[3 * k + 1] - centreY, tri[3 * k + 2] - C.z) > aperture + s + 0.02) return null
    return COL.grey
  })
  const parts: BufferGeometry[] = [body]
  // a grey bezel plate round the aperture on the front cap
  parts.push(tube('x', 0.88, aperture + s, 0.012, COL.grey, { x: FRONT_X - 0.006, y: centreY, z: C.z }, 72))
  // the bore liner (white), through the whole housing and a little proud of both faces
  parts.push(tube('x', CT.linerOut, CT.linerIn, 2 * CT.halfDepth + 0.04, COL.white, { x: C.x, y: centreY, z: C.z }, 64))
  // the dark plug that closes the recess behind the rotor (and the back of the aperture)
  const plugX0 = CT.rotor.x + CT.rotor.depth / 2 + 0.01
  const plugX1 = C.x + CT.halfDepth
  parts.push(tube('x', aperture + 0.005, CT.linerOut - 0.005, plugX1 - plugX0, COL.darker, { x: (plugX0 + plugX1) / 2, y: centreY, z: C.z }, 64))
  // a small display and two buttons on the front cap, top right corner (outside the bezel plate)
  parts.push(rbx(FRONT_X - 0.014, FRONT_X, 1.64, 1.8, C.z - 0.82, C.z - 0.56, 0.01, COL.bezel))
  parts.push(bx(FRONT_X - 0.016, FRONT_X - 0.008, 1.7, 1.74, C.z - 0.78, C.z - 0.6, COL.teal))
  // plinth
  parts.push(bx(C.x - 0.35, C.x + 0.35, 0, 0.05, C.z - 0.8, C.z + 0.8, COL.dark))
  return merge(parts)
}

/** The pedestal under the table top (the top rides on it when the table is out). */
export function buildCtBase(): BufferGeometry {
  const b = CT.base
  const z0 = C.z - b.halfZ
  const z1 = C.z + b.halfZ
  return merge([
    rbx(b.x0, b.x1, 0.08, b.top, z0, z1, 0.04, COL.white),
    bx(b.x0 + 0.05, b.x1 - 0.05, 0, 0.08, z0 + 0.04, z1 - 0.04, COL.dark),
    bx(b.x0 + 0.04, b.x1 - 0.04, 0.5, 0.52, z0 - 0.002, z1 + 0.002, COL.grey),
  ])
}

/** Everything that never moves, as ONE geometry: the gantry, the pedestal and the control-room monitors' bezels and stands. */
export function buildCtStatic(screens: readonly ConsoleScreen[]): BufferGeometry {
  return merge([buildCtGantry(), buildCtBase(), ...consoleFurniture(screens)])
}

/** The moving cantilever table top in the table's frame: a thin slab 2.2 x 0.46 with a teal pad (top at the table height). */
export function buildCtCradle(): BufferGeometry {
  const { y0, y1, top } = CT.cradle
  const half = CRADLE.length / 2
  const hw = CRADLE.width / 2
  return merge([rbx(-half, half, y0, y1, -hw, hw, 0.014, COL.white), rbx(-half + 0.05, half - 0.05, y1 - 0.001, top, -hw + 0.03, hw - 0.03, 0.01, COL.teal)])
}

/**
 * The rotor in its own frame: the axis is the x axis through the origin. A dark ring with 12 tick marks on its front face, a bright
 * tube housing on top and two detector arcs opposite, so the spin reads at a glance.
 */
export function buildCtRotor(): BufferGeometry {
  const { rIn, rOut, depth } = CT.rotor
  const half = depth / 2
  const parts: BufferGeometry[] = [tube('x', rOut, rIn, depth, COL.dark, {}, 64)]
  // the tube housing: a bright block on the ring's top, standing proud of the front face
  parts.push(rbox(depth + 0.04, 0.15, 0.2, 0.02, COL.white, { y: 0.5 }))
  parts.push(box(0.01, 0.05, 0.12, '#f0a33a', { x: -half - 0.03, y: 0.5 }))
  // two detector arcs on the opposite side (angle measured in the XY plane of the extrusion, turned to the x axis by ry)
  const deg = Math.PI / 180
  parts.push(sector(rIn + 0.025, rOut - 0.025, 215 * deg, 262 * deg, depth + 0.016, COL.teal, { ry: Math.PI / 2 }, 8))
  parts.push(sector(rIn + 0.025, rOut - 0.025, 278 * deg, 325 * deg, depth + 0.016, COL.teal, { ry: Math.PI / 2 }, 8))
  // twelve tick marks on the front face, one of them amber
  const r = 0.545
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6
    parts.push(box(0.006, 0.05, 0.016, k === 0 ? '#f0a33a' : COL.white, { x: -half - 0.002, y: r * Math.cos(a), z: r * Math.sin(a), rx: a }))
  }
  return merge(parts)
}

/** Red positioning lasers and the status strip on the housing's top. */
export function buildCtGlow(): GlowGeometry {
  const padTop = CT.cradle.top
  const y0 = padTop + 0.005
  const y1 = padTop + 0.012
  const planeX = FRONT_X - 0.01
  const lasers = [
    // a vertical line on the gantry face plane, from the table up past the patient
    bx(planeX - 0.006, planeX + 0.006, padTop + 0.02, CT.centreY + 0.4, C.z - 0.006, C.z + 0.006, '#ff2a1a'),
    // the horizontal line along the table, from the gantry out to the foot end
    bx(C.x - 2.1, planeX, y0, y1, C.z - 0.006, C.z + 0.006, '#ff2a1a'),
    // the cross at the patient: a transverse line over the upper body at the loading position
    bx(T.out.x + 0.15 - 0.006, T.out.x + 0.15 + 0.006, y0, y1, C.z - CRADLE.width / 2 + 0.02, C.z + CRADLE.width / 2 - 0.02, '#ff2a1a'),
  ]
  const strip = bx(C.x + CT.strip.dx - 0.05, C.x + CT.strip.dx + 0.05, CT.y1 - 0.002, CT.y1 + 0.006, C.z - CT.strip.halfZ, C.z + CT.strip.halfZ, '#ffb23a')
  return new GlowBuilder().region('laser', '#ff2a1a', lasers).region('status', '#ffb23a', [strip]).build()
}
