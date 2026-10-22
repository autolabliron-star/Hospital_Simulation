/**
 * Outside the building (the architect's model): the plinth the model stands on (a large slab with a soft edge), lawns and an apron round the shell,
 * the west forecourt with the entrance canopy, the ambulance bay outside the ER with its markings and a parked ambulance,
 * and a few trees (instanced by the renderer).
 *
 * The plinth top is 4 cm below the floors, so the building reads as set into it. Nothing here is on a nav route.
 *
 * Look-exterior: the model's base (the plinth, the lawns, the apron, the forecourt paving) is OVERVIEW ONLY: while you walk, the real-place
 * exterior (./grounds, a separate component) is the ground to the horizon. The ambulance bay, the canopies, the planters and the trees stay.
 */
import { BUILDING, DOORS } from '@/sim/places'
import { WAYFINDING } from '@/scene/materials'
import { BUILDING_MODEL_ON } from '@/scene/building/model/flags'
import type { Frame, LayoutBuilder } from '@/scene/building/layout/builder'
import { LAYOUT_TREES } from './layoutTrees'

export const PLINTH = { x0: -78, x1: 48, z0: -32, z1: 32, top: -0.04, thickness: 0.7 } as const

/** The architect's model base: hidden while walking (the real ground replaces it). */
const OV = { overviewOnly: true } as const

const RED = WAYFINDING.emergency
const WHITE = '#ffffff'
const YELLOW = '#f2c14e'

function lawn(f: Frame, x0: number, x1: number, z0: number, z1: number): void {
  f.rbox((x0 + x1) / 2, PLINTH.top - 0.02, (z0 + z1) / 2, x1 - x0, 0.1, z1 - z0, 'grass', { r: 0.04, cast: false, ...OV })
}

function plinth(f: Frame): void {
  const { x0, x1, z0, z1, top, thickness } = PLINTH
  f.rbox((x0 + x1) / 2, top - thickness, (z0 + z1) / 2, x1 - x0, thickness, z1 - z0, 'plinth', { r: 0.3, cast: false, ...OV })
  // a slightly darker base lip, so the slab reads as a model base
  f.rbox((x0 + x1) / 2, top - thickness - 0.25, (z0 + z1) / 2, x1 - x0 - 0.8, 0.3, z1 - z0 - 0.8, 'concrete', { r: 0.12, cast: false, ...OV })
}

function groundCover(f: Frame): void {
  const o = BUILDING
  // lawns north, south and east
  lawn(f, -58, 38, o.z0 - 8.2, o.z0 - 2.4)
  lawn(f, -58, 38, o.z1 + 2.4, o.z1 + 8.2)
  lawn(f, o.x1 + 2.4, 46.4, o.z0 - 2.4, o.z1 + 2.4)
  lawn(f, -74, -63, 5.4, 6.4) // planter strip between the forecourt and the ambulance bay
  // a stone apron round the shell (north, south, east)
  // (thin boxes, not `plane`: `Frame.plane` does not pass `overviewOnly` on to its prim)
  const slab = (x: number, z: number, w: number, d: number): Frame => f.box(x, -0.002, z, w, 0.004, d, 'stonePath', { ...OV, cast: false })
  slab(-10, o.z0 - 1.2, 106, 2.4)
  slab(-10, o.z1 + 1.2, 106, 2.4)
  slab(o.x1 + 1.2, 0, 2.4, 44)
  // the forecourt in front of the entrance
  slab(-67.5, -2.2, 11, 15.6)
}

/**
 * A canopy: a slim slab on four columns. `y` is the underside. The entrance canopy (Look-exterior) hangs at 3.1 m, the height of the
 * authored lobby's own porch slab (tools/arch/lobby.py: x -64.8..-62.1, z -2.6..2.6, 3.1..3.32 m); with `?building=model` that porch is the
 * model's, so the procedural slab leaves exactly its rectangle out (`notch`) instead of fighting it with coplanar faces.
 */
function canopy(f: Frame, id: string, xMin: number, xMax: number, zc: number, depthZ: number, y = 3.0, notch?: { x0: number; hz: number }): void {
  const w = xMax - xMin
  const cx = (xMin + xMax) / 2
  const z0 = zc - depthZ / 2
  const z1 = zc + depthZ / 2
  if (notch) {
    const piece = (a: number, b: number, c: number, d: number): void => {
      f.rbox((a + b) / 2, y, (c + d) / 2, b - a, 0.22, d - c, 'whitePlastic', { r: 0.03 })
    }
    piece(xMin, notch.x0, z0, z1)
    piece(notch.x0, xMax, z0, zc - notch.hz)
    piece(notch.x0, xMax, zc + notch.hz, z1)
  } else {
    f.rbox(cx, y, zc, w, 0.22, depthZ, 'whitePlastic', { r: 0.08 })
    f.rbox(cx, y + 0.22, zc, w + 0.1, 0.04, depthZ + 0.1, 'wallCap', { r: 0.02, cast: false })
    f.box(cx, y - 0.04, zc - depthZ / 2 + 0.03, w - 0.1, 0.04, 0.06, 'wallMint', { cast: false })
    f.box(cx, y - 0.04, zc + depthZ / 2 - 0.03, w - 0.1, 0.04, 0.06, 'wallMint', { cast: false })
  }
  let column = 0
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = cx + sx * (w / 2 - 0.35)
      const pz = zc + sz * (depthZ / 2 - 0.35)
      f.cyl(px, 0, pz, 0.18, y, 'frame')
      // W3: a column is solid for your body (the building's people never go there; the footprint is outdoors, so the nav skips it)
      f.circle(`${id}:column${column++}`, px, pz, 0.09)
    }
  }
  f.box(cx, y - 0.02, zc, w - 0.6, 0.02, 0.1, 'glowWarm', { cast: false })
  f.rect(`${id}:canopy`, cx, zc, w, depthZ, { overhead: true })
}

function ambulance(f: Frame, id: string, x: number, z: number): void {
  // body (long axis along x), cab to the west (away from the ER): it reversed in, tail toward the building
  f.rbox(x + 0.6, 0.45, z, 4.2, 1.9, 2.05, 'whitePlastic', { r: 0.18 })
  f.rbox(x - 2.3, 0.45, z, 1.7, 1.15, 2.0, 'whitePlastic', { r: 0.15 })
  f.box(x - 2.82, 1.0, z, 0.04, 0.5, 1.7, 'glass', { cast: false })
  f.box(x + 0.6, 1.0, z - 1.03, 4.1, 0.28, 0.02, 'tinted', { color: RED, cast: false })
  f.box(x + 0.6, 1.0, z + 1.03, 4.1, 0.28, 0.02, 'tinted', { color: RED, cast: false })
  f.box(x + 0.6, 1.35, z, 3.8, 0.04, 0.9, 'wallCap', { cast: false })
  f.box(x - 1.9, 2.37, z - 0.45, 0.2, 0.1, 0.5, 'tintedGlow', { color: '#3f7fd1', cast: false })
  f.box(x - 1.9, 2.37, z + 0.45, 0.2, 0.1, 0.5, 'tintedGlow', { color: RED, cast: false })
  for (const sx of [-1.9, 1.7]) for (const sz of [-1, 1]) f.cyl(x + sx, 0.26, z + sz * 0.95, 0.8, 0.28, 'rubber', { rx: Math.PI / 2, cast: false })
  f.rect(`${id}:ambulance`, x - 0.1, z, 6.1, 2.1)
}

function ambulanceBay(f: Frame): void {
  const doorZ = 14
  const x0 = -76
  const x1 = -62.1
  // the pad
  f.plane((x0 + x1) / 2, 0.002, 14, x1 - x0, 15.4, 'concrete')
  // two bays outlined in white, a hatched yellow no-parking strip between them
  const line = (cx: number, cz: number, w: number, d: number, color: string, y = 0.012) => f.plane(cx, y, cz, w, d, 'tinted', { color })
  for (const bz of [10.4, 17.6]) {
    line(-69, bz - 1.45, 8, 0.12, WHITE)
    line(-69, bz + 1.45, 8, 0.12, WHITE)
    line(-73.1, bz, 0.12, 2.9, WHITE)
  }
  for (let i = 0; i < 6; i++) f.plane(-72.6 + i * 1.5, 0.012, doorZ, 0.34, 2.4, 'tinted', { color: YELLOW, ry: 0.7 })
  // a painted cross
  line(-74.3, doorZ, 1.5, 0.45, RED)
  line(-74.3, doorZ, 0.45, 1.5, RED)
  // the double door on the ER's west wall: a frame and two door leaves slid open
  f.box(-62, 0, doorZ - 2.1, 0.22, 1.3, 0.1, 'frame')
  f.box(-62, 0, doorZ + 2.1, 0.22, 1.3, 0.1, 'frame')
  f.box(-62, 1.26, doorZ, 0.22, 0.05, 4.3, 'frame')
  ambulance(f, 'bay', -68.6, 10.4)
  canopy(f, 'bay', -67.2, -62, 14, 6.4)
}

function treeSpots(b: LayoutBuilder): void {
  for (const t of LAYOUT_TREES) b.trees.push({ x: t.x, z: t.z, height: t.height, tint: t.tint, seed: t.seed })
}

export function buildExterior(b: LayoutBuilder): void {
  b.area = 'outside' // exterior footprints belong to no area; they are not part of the inside-the-walls test
  const f = b.world
  plinth(f)
  groundCover(f)
  const entrance = DOORS.find((d) => d.id === 'entrance')!
  // the authored lobby's own porch slab (x -64.8..-62.1, z +-2.6) is left out of the procedural one when `?building=model` draws it
  canopy(f, 'entrance', -68.6, -62, entrance.center.z, 9, 3.1, BUILDING_MODEL_ON ? { x0: -64.8, hz: 2.6 } : undefined)
  ambulanceBay(f)
  treeSpots(b)
  // forecourt planters flanking the entrance walk
  for (const [i, z] of [-7, 4.2].entries()) {
    f.cyl(-70.2, 0, z, 1.0, 0.5, 'concrete')
    f.sphere(-70.2, 0.5, z, 0.9, 0.9, 0.9, 'leaf')
    // W3: planters are solid for your body (outdoor footprints are not in the people's nav)
    f.circle(`forecourt:planter${i}`, -70.2, z, 0.5)
  }
}
