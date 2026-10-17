/**
 * MealBot geometry (L1), about 0.6 x 1.1 x 1.25 m (`MEALBOT_SIZE`), built once and shared by every bot. Local +z is the way it
 * drives (heading 0 faces +z), +x is to its left, the floor is y = 0. Like the MedPods it is a white rounded cart robot with a dark
 * skirt and a light ring, but it carries meals: a head tower with a face visor in front and, behind it, a tray cabinet with eight
 * shelves that opens at the REAR behind a shutter that slides up into the header (animated by `MealBot.door`). The ring is peach
 * when it carries meals (the pods' rings are teal, so meals and medicine never get confused).
 *
 *   static   skirt, wheels, cabinet shell and shelves, head tower, visor, peach stripes    vertex colours, one draw call
 *   door     the shutter panel, hinged at its top edge (scaled in y to retract)            vertex colours, one draw call
 *   ring     a light band round the upper body, tinted per bot                            instance colours, one draw call
 *   shadow   a soft blob on the floor                                                       one draw call
 * The shelf trays are the tray prop of src/scene/meals/trayParts.ts, placed on `SHELF` by the trays layer.
 */
import { BoxGeometry, BufferGeometry, CylinderGeometry, Color, Float32BufferAttribute, PlaneGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MEALBOT_SIZE } from '@/sim/places'
import { PEACH } from './palette'

const W = MEALBOT_SIZE.w
const L = MEALBOT_SIZE.l
const H = MEALBOT_SIZE.h

/** Vertex colours of the static parts (sRGB hex; converted to linear when painted). */
export const BOT_COLORS = {
  white: '#f5f6f6',
  skirt: '#2b3133',
  visor: '#1b2426',
  sensor: '#c6cdcf',
  interior: PEACH.cream,
  shelf: '#dfe4e4',
  stripe: PEACH.light,
  panel: '#e9eeee',
} as const

/** Key measurements (metres, bot-local). */
export const BOT = {
  w: W,
  l: L,
  h: H,
  skirtH: 0.16,
  /** The cabinet runs from the rear to `cabinetZ1`; the head tower from there to the front. */
  cabinetZ0: -L / 2,
  cabinetZ1: 0.1,
  cabinetTop: 1.14,
  headTop: H,
  wall: 0.04,
  ringY: 1.07,
} as const

/** The tray cabinet: the opening at the rear, and the eight shelves. */
export const CABINET = {
  /** Inner width and the opening's bottom and top edge. */
  innerW: W - 2 * BOT.wall,
  openingY0: 0.24,
  openingY1: 0.98,
  /** The shutter sits in the rear plane, a hair inside the rear face. */
  shutterZ: BOT.cabinetZ0 + 0.008,
  shutterThick: 0.014,
} as const

export const SHELF_COUNT = 8
/** Height of the top face of shelf `k` (k = 0 is the lowest), in the bot's frame. */
export const SHELF = {
  y0: 0.26,
  pitch: 0.088,
  /** Where a tray's centre sits along z: the middle of the cabinet. */
  z: (BOT.cabinetZ0 + 0.04 + BOT.cabinetZ1 - 0.04) / 2,
  /** A shelf tray is slightly smaller than a table tray so it fits the pitch. */
  trayScale: 0.78,
} as const
export function shelfY(k: number): number {
  return SHELF.y0 + k * SHELF.pitch
}

function paint(g: BufferGeometry, hex: string): BufferGeometry {
  const c = new Color(hex)
  const n = g.getAttribute('position').count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3))
  return g
}

/** RoundedBoxGeometry and BoxGeometry disagree on indexing in this three version, so merge them non-indexed. */
function mergeAndFree(parts: BufferGeometry[], what: string): BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(flat, false)
  for (const g of parts) g.dispose()
  for (const g of flat) g.dispose()
  if (!merged) throw new Error(`MealBot: could not merge ${what}`)
  return merged
}

/** A box between two corners (x0..x1, y0..y1, z0..z1), painted. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: string): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return paint(g, hex)
}

function rbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, seg: number, hex: string): BufferGeometry {
  const g = new RoundedBoxGeometry(x1 - x0, y1 - y0, z1 - z0, seg, r).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return paint(g, hex)
}

/** Everything that never moves, merged into one vertex-coloured geometry. */
export function botStaticGeometry(): BufferGeometry {
  const hw = W / 2
  const ih = CABINET.innerW / 2
  const z0 = BOT.cabinetZ0
  const z1 = BOT.cabinetZ1
  const zf = L / 2
  const parts: BufferGeometry[] = []

  // dark skirt, a front sensor bar and four wheels
  parts.push(rbox(-hw, hw, 0, BOT.skirtH, -zf, zf, 0.05, 2, BOT_COLORS.skirt))
  parts.push(box(-0.15, 0.15, BOT.skirtH * 0.55, BOT.skirtH * 0.55 + 0.035, zf, zf + 0.012, BOT_COLORS.sensor))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new CylinderGeometry(0.095, 0.095, 0.05, 10).rotateZ(Math.PI / 2).translate(sx * (hw - 0.01), 0.095, sz * 0.36)
      parts.push(paint(wheel, BOT_COLORS.skirt))
    }
  }

  // the cabinet: floor plate, two side walls, a header that holds the shutter, and the partition to the head tower
  parts.push(box(-hw, hw, BOT.skirtH, CABINET.openingY0, z0, z1, BOT_COLORS.white))
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -hw : ih
    parts.push(rbox(x0, x0 + BOT.wall, CABINET.openingY0, CABINET.openingY1, z0, z1, 0.012, 1, BOT_COLORS.white))
  }
  parts.push(rbox(-hw, hw, CABINET.openingY1, BOT.cabinetTop, z0, z1, 0.05, 2, BOT_COLORS.white))
  parts.push(box(-ih, ih, CABINET.openingY0, CABINET.openingY1, z1 - 0.04, z1, BOT_COLORS.interior))
  // eight shelf boards (the trays stand on them)
  for (let k = 0; k < SHELF_COUNT; k++) {
    const top = shelfY(k)
    parts.push(box(-ih, ih, top - 0.012, top, z0 + 0.03, z1 - 0.04, BOT_COLORS.shelf))
  }

  // the head tower with the face visor, and the peach stripes on both sides
  parts.push(rbox(-hw, hw, BOT.skirtH, BOT.headTop, z1, zf, 0.08, 3, BOT_COLORS.white))
  parts.push(box(-0.17, 0.17, 0.78, 0.98, zf - 0.004, zf + 0.004, BOT_COLORS.visor))
  // two small peach eyes on the visor: a face, like the pods' screen
  for (const sx of [-1, 1]) parts.push(rbox(sx * 0.07 - 0.03, sx * 0.07 + 0.03, 0.86, 0.92, zf + 0.002, zf + 0.008, 0.008, 1, BOT_COLORS.stripe))
  for (const sx of [-1, 1]) {
    const x = sx * (hw + 0.003)
    parts.push(box(x - 0.003, x + 0.003, 0.54, 0.6, z1 + 0.03, zf - 0.04, BOT_COLORS.stripe))
    parts.push(box(x - 0.003, x + 0.003, 0.5, 0.56, z0 + 0.04, z1 - 0.04, BOT_COLORS.stripe))
  }
  return mergeAndFree(parts, 'static parts')
}

/** The shutter: hinged at its top edge (the origin is the middle of the top edge), so scaling it in y retracts it into the header. */
export function botDoorGeometry(): BufferGeometry {
  const h = CABINET.openingY1 - CABINET.openingY0
  const w = CABINET.innerW
  const t = CABINET.shutterThick
  const parts = [rbox(-w / 2, w / 2, -h, 0, -t / 2, t / 2, 0.004, 1, BOT_COLORS.panel), box(-0.1, 0.1, -h + 0.03, -h + 0.07, -t / 2 - 0.006, -t / 2, BOT_COLORS.stripe)]
  return mergeAndFree(parts, 'shutter')
}

/** Where the shutter's top edge is, in the bot's frame (its local origin): the underside of the header, at the rear plane. */
export const DOOR_ORIGIN = { y: CABINET.openingY1, z: CABINET.shutterZ } as const

/** The light ring: a band just wider than the body, like the pods' (a rounded box lying round the upper body). */
export function botRingGeometry(): BufferGeometry {
  return new RoundedBoxGeometry(W + 0.012, 0.045, L + 0.012, 2, 0.09).translate(0, BOT.ringY, 0)
}

export function botShadowGeometry(): BufferGeometry {
  return new PlaneGeometry(1.0, 1.55).rotateX(-Math.PI / 2).translate(0, 0.03, 0)
}
