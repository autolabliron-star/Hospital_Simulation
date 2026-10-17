/**
 * MedDrawer geometry. One cabinet fills the 0.8 m gap that the building leaves in the corridor wall at `room.drawer`.
 *
 * Cabinet-local frame: origin on the wall centre line at the floor, +z towards the corridor, +x along the wall. Ward A
 * is built as is; ward B is the same cabinet turned half a turn about y (its corridor lies at +z, so local +z must
 * point the other way). All sizes are metres.
 *
 *   room face (z = -0.25)                                                corridor face (z = +0.26)
 *        |  drawer front y 0.28..0.58 (slides out into the room)             |  hatch y 0.63..0.93 hangs from
 *        |  status light above it                                            |  its top edge (W2: it stays closed;
 *        |  (tray is embedded in the solid body when closed)                 |  the pods deliver through the chute in the top)
 *
 * Static parts are merged per material (shell with the closed hatches, cap, dark slots); the drawer, status lights and
 * the packs on the tray are instanced and animated by DrawersLayer. The glass chute that feeds the cabinet's top and the
 * funnel above it are in chute.ts.
 */
import { BoxGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ROOMS, WALL, type RoomSpec } from '@/sim/places'

export const CAB = {
  /** Width: exactly the gap the building leaves. */
  w: 0.8,
  /** Top of the cabinet = the section cut, flush with the walls. */
  h: WALL.cutHeight,
  cap: 0.015,
  /** Room face and corridor face (local z). */
  zRoom: -0.25,
  zCorr: 0.26,
  /** Corridor-side cavity behind the hatch (x half width, y range, back wall z). */
  cavity: { hx: 0.27, y0: 0.63, y1: 0.93, zBack: -0.04 },
  /** Drawer opening on the room side. */
  drawerSlot: { hx: 0.27, y0: 0.28, y1: 0.58 },
  /** The hatch hangs from `hingeY`, just under the cavity ceiling, and sits proud of the corridor face by `t`. */
  hatch: { w: 0.53, h: 0.28, t: 0.03, hingeY: 0.92 },
  drawer: { w: 0.54, h: 0.3, t: 0.03, tray: 0.36 },
  /** The drawer comes out this far, so the nurse at `drawerSpot` (0.9 m from the wall) keeps 0.35 m clear. */
  slideMax: 0.32,
  /** Hatch swing, radians (about 75 degrees inwards). */
  hatchOpen: 1.31,
  /** Status light pills. */
  light: { w: 0.3, h: 0.04, t: 0.025, yCorr: 1.08, yRoom: 0.75 },
} as const

/** Local +z points to the corridor for ward A and away from it for ward B. */
export function cabinetYaw(room: RoomSpec): number {
  return room.ward === 'A' ? 0 : Math.PI
}

/** +1 for ward A, -1 for ward B: world offset of a cabinet-local (x, z) is (sx * x, sx * z). */
export function cabinetFlip(room: RoomSpec): 1 | -1 {
  return room.ward === 'A' ? 1 : -1
}

function mergeAndFree(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('MedDrawer: could not merge geometries')
  return merged
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(x, y, z)
}

/** The cabinet body without the hatch cavity: five blocks round the cavity, so the hatch has room to swing in. */
function shellLocal(): BufferGeometry[] {
  const { w, h, cap, zRoom, zCorr, cavity } = CAB
  const top = h - cap
  const depthBack = cavity.zBack - zRoom
  const depthFront = zCorr - cavity.zBack
  const cx = (cavity.zBack + zRoom) / 2
  const fz = (zCorr + cavity.zBack) / 2
  const sideW = w / 2 - cavity.hx
  return [
    // main body behind the cavity
    box(w, top, depthBack, 0, top / 2, cx),
    // front block below, above and either side of the cavity
    box(w, cavity.y0, depthFront, 0, cavity.y0 / 2, fz),
    box(w, top - cavity.y1, depthFront, 0, (cavity.y1 + top) / 2, fz),
    box(sideW, cavity.y1 - cavity.y0, depthFront, -(cavity.hx + sideW / 2), (cavity.y0 + cavity.y1) / 2, fz),
    box(sideW, cavity.y1 - cavity.y0, depthFront, cavity.hx + sideW / 2, (cavity.y0 + cavity.y1) / 2, fz),
  ]
}

/** Cabinet-local geometry, one per material. */
export function cabinetLocalParts(): { shell: BufferGeometry; cap: BufferGeometry; slots: BufferGeometry } {
  const { w, h, cap, zRoom, zCorr, cavity, drawerSlot } = CAB
  const shell = mergeAndFree(shellLocal())
  const capGeo = box(w, cap, zCorr - zRoom, 0, h - cap / 2, (zCorr + zRoom) / 2)
  const slots = mergeAndFree([
    // dark lining at the back of the hatch cavity
    box(cavity.hx * 2, cavity.y1 - cavity.y0, 0.006, 0, (cavity.y0 + cavity.y1) / 2, cavity.zBack + 0.003),
    // dark drawer opening on the room face (the drawer front sits in front of it)
    box(drawerSlot.hx * 2, drawerSlot.y1 - drawerSlot.y0, 0.008, 0, (drawerSlot.y0 + drawerSlot.y1) / 2, zRoom - 0.003),
  ])
  return { shell, cap: capGeo, slots }
}

/** Place a cabinet-local geometry in the world for one room (rotated for ward B). */
export function placeForRoom(g: BufferGeometry, room: RoomSpec): BufferGeometry {
  const out = g.clone().rotateY(cabinetYaw(room)).translate(room.drawer.x, 0, room.drawer.z)
  return out
}

/** All 16 cabinets merged into one geometry per material. */
export function buildCabinets(): { shell: BufferGeometry; cap: BufferGeometry; slots: BufferGeometry } {
  const local = cabinetLocalParts()
  const placed = (g: BufferGeometry) => mergeAndFree(ROOMS.map((r) => placeForRoom(g, r)))
  const out = { shell: placed(local.shell), cap: placed(local.cap), slots: placed(local.slots) }
  local.shell.dispose()
  local.cap.dispose()
  local.slots.dispose()
  return out
}

/**
 * The hatch panel, hinged at its top edge (the origin, on the corridor face): it hangs down (-y) and stands proud of
 * the face by its thickness (+z). Rotating it about x by a positive angle swings its lower edge into the cavity.
 */
export function hatchGeometry(): BufferGeometry {
  const { w, h, t } = CAB.hatch
  return box(w, h, t, 0, -h / 2, t / 2)
}

/**
 * W2: the corridor hatch no longer opens (the pods deliver from the ceiling rail through the chute into the cabinet's top),
 * so the sixteen hatch panels are drawn closed, merged into one static geometry (world coordinates). DrawersLayer merges
 * it with the cabinet shell, so it costs no extra draw call.
 */
export function buildClosedHatches(): BufferGeometry {
  const hatch = hatchGeometry()
  const placed = ROOMS.map((r) =>
    hatch
      .clone()
      .rotateY(cabinetYaw(r))
      .translate(r.drawer.x, CAB.hatch.hingeY, r.drawer.z + cabinetFlip(r) * CAB.zCorr),
  )
  hatch.dispose()
  return mergeAndFree(placed)
}

/** The static cabinet shell and the closed hatches as one geometry (world coordinates). Frees both inputs. */
export function shellWithClosedHatches(shell: BufferGeometry): BufferGeometry {
  return mergeAndFree([shell, buildClosedHatches()])
}

/**
 * The drawer: front panel centred on the origin (z from -t/2 to +t/2), a handle on its outer face, and an open tray
 * running back into the cabinet (+z). The origin sits at the middle of the front panel's height range.
 */
export function drawerGeometry(): BufferGeometry {
  const { w, h, t, tray } = CAB.drawer
  const wall = 0.015
  const trayW = w - 0.06
  const zTray = t / 2 + tray / 2
  const floorY = -h / 2 + 0.005
  return mergeAndFree([
    box(w, h, t, 0, 0, 0),
    // handle (on the outer, room-facing side: local -z)
    box(0.24, 0.025, 0.022, 0, h * 0.28, -t / 2 - 0.011),
    // tray floor, sides and back
    box(trayW, wall, tray, 0, floorY, zTray),
    box(wall, 0.075, tray, -trayW / 2 + wall / 2, floorY + 0.045, zTray),
    box(wall, 0.075, tray, trayW / 2 - wall / 2, floorY + 0.045, zTray),
    box(trayW, 0.075, wall, 0, floorY + 0.045, t / 2 + tray - wall / 2),
  ])
}

/** Where the packs lie on the tray: drawer-local x, y (above the origin) and z. Six slots, 3 across and 2 deep. */
export const TRAY_PACKS: readonly { x: number; y: number; z: number }[] = [-0.15, 0, 0.15].flatMap((x) =>
  [0.09, 0.21].map((z) => ({ x, y: -CAB.drawer.h / 2 + 0.005 + 0.0075 + 0.025, z: CAB.drawer.t / 2 + z })),
)
export const TRAY_PACK_SIZE = { x: 0.14, y: 0.05, z: 0.1 } as const
export const SLOTS_PER_DRAWER = TRAY_PACKS.length

/** Cabinet-local y of the middle of the drawer front. */
export const DRAWER_MID_Y = (CAB.drawerSlot.y0 + CAB.drawerSlot.y1) / 2
/** Cabinet-local z of the drawer front's centre when closed (its outer face sits just proud of the room face). */
export const DRAWER_CLOSED_Z = CAB.zRoom - CAB.drawer.t / 2 - 0.004

/** Plan-view rectangles (world, m) of the static cabinet and of the drawer at full stretch, for the keep-clear tests. */
export function cabinetFootprints(room: RoomSpec): { body: Rect4; drawerOut: Rect4 } {
  const flip = cabinetFlip(room)
  const world = (lx0: number, lx1: number, lz0: number, lz1: number): Rect4 => {
    const xs = [room.drawer.x + flip * lx0, room.drawer.x + flip * lx1]
    const zs = [room.drawer.z + flip * lz0, room.drawer.z + flip * lz1]
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }
  }
  const { w, zRoom, zCorr, drawer, slideMax } = CAB
  const outerRoom = DRAWER_CLOSED_Z - drawer.t / 2 - 0.022 - slideMax
  return {
    // the closed hatch stands proud of the corridor face by its thickness; the closed drawer front is proud of the room face
    body: world(-w / 2, w / 2, zRoom - 0.05, zCorr + CAB.hatch.t),
    drawerOut: world(-drawer.w / 2, drawer.w / 2, outerRoom, zRoom),
  }
}

export interface Rect4 {
  x0: number
  x1: number
  z0: number
  z1: number
}
