/**
 * W2 delivery hardware: the glass chute and the fold-out funnel tray of every room (docs/W2-CEILING-RAIL.md, "Delivery").
 *
 * A MedPod hangs from the ceiling rail and stops overhead at `room.podDock`. A small funnel tray folds out from the
 * corridor face of the wall to under the pod, the pod drops each pack onto it, and the pack slides into the top of a slim
 * glass tube that runs down the wall to the top of the MedDrawer cabinet (at `WALL.cutHeight`).
 *
 * Chute-local frame (used by every function here): origin on the tube axis, y = world height, +x along the wall, +z
 * towards the corridor. Ward A is placed as is; ward B is turned half a turn about y (its corridor lies at +z, so local +z
 * must point the other way), exactly like the cabinets (`cabinetYaw`, `cabinetFlip`). All sizes are metres.
 *
 *   wall face   plate    tube (glass)       funnel tray, folded up (left) and folded out (right), side view
 *      |  |       |  |      ( )               z = -back   0      +0.07                        funnelTo
 *      |  |plate  |  |tube  ( )                 |plate|   |tube|  ====== pivot ====================> tray (2.5 deg slope)
 *      |  |       |  |      ( )  y = topY (just under the pod)
 *
 * Static parts are merged per material (glass tubes; white plates, straps and hinge arms). The 16 funnel trays are one
 * InstancedMesh and are rotated about the hinge by DrawersLayer. The back-plate glow strips and the packs in flight are
 * extra instances of the drawers' existing light and pack meshes (no extra draw calls).
 */
import { BoxGeometry, CylinderGeometry, TorusGeometry, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BANDS, DRAWER_CHUTES, WALL, type DrawerChute } from '@/sim/places'

export const CHUTE = {
  /** The glass tube is about 0.14 m across. */
  radius: 0.07,
  radialSegments: 12,
  /** The white back plate on the wall face: a slim spine, so the tube stays readable from behind it too (ward B in the overview). */
  plate: { w: 0.07, sunk: 0.004, t: 0.022, above: 0.03 },
  /** Clamp rings round the tube, as heights above the cabinet top, and the flange where the tube enters the cabinet. */
  strap: { r: 0.077, tube: 0.006, heights: [0.3, 0.62] as readonly number[] },
  flange: { hx: 0.085, h: 0.04, zFront: 0.072 },
  /** Hinge arms from the plate to the funnel's pivot, one each side of the tray, and the pin caps on them. */
  ear: { x: 0.108, w: 0.016, h: 0.034, cap: 0.012 },
  crossbar: { hx: 0.12, h: 0.034 },
  /** Glow strip on the plate (instances of the drawers' light mesh): width, thickness, and clearance from the foot and the top. */
  strip: { w: 0.014, t: 0.004, bottom: 0.08, top: 0.05 },
  /** The funnel's pivot sits just under the tube's rim, on the tube axis. */
  pivotBelowTop: 0.004,
} as const

export const FUNNEL = {
  w: 0.19,
  floorT: 0.012,
  /** The floor starts just in front of the tube's mouth, so a pack centred on the axis is wholly over the opening. */
  floorStart: 0.035,
  rimH: 0.026,
  rimT: 0.01,
  rimLen: 0.34,
  /** The two guide wings at the tube end that narrow the tray to the pack's width. */
  wing: { len: 0.075, h: 0.026, t: 0.012, z: 0.07, x: 0.075, yaw: 0.45 },
  /** Folded up against the wall (a hair past vertical, leaning into the wall) and folded out (the far end 2.5 degrees up, so packs slide to the tube). */
  foldAngle: -(92 * Math.PI) / 180,
  deployTilt: (2.5 * Math.PI) / 180,
  /** The tray reaches this far past `funnelTo` (the pod's hatch), so the hatch is wholly over it. */
  overshoot: 0.08,
  /** Geometry length; instances are scaled in z to each chute's own reach. */
  baseLength: 0.6,
  /** Seconds to fold out or back (eased). */
  seconds: 0.6,
} as const

/** Rotation about the chute-local x axis of the funnel at `open` (0 folded, 1 deployed). */
export function funnelRotation(open: number): number {
  const k = open <= 0 ? 0 : open >= 1 ? 1 : open
  const e = k * k * (3 - 2 * k)
  return FUNNEL.foldAngle + (-FUNNEL.deployTilt - FUNNEL.foldAngle) * e
}

export interface ChuteLayout {
  roomId: DrawerChute['roomId']
  /** Tube axis, world. */
  x: number
  z: number
  /** +1 for ward A (corridor at +z), -1 for ward B: world offset of a chute-local (x, z) is (flip * x, flip * z). */
  flip: 1 | -1
  yaw: number
  /** How far the wall face is behind the tube axis (m). */
  back: number
  topY: number
  bottomY: number
  /** Height of the funnel's hinge. */
  pivotY: number
  /** `funnelTo` in chute-local (lateral, outward) metres: where the pod's hatch is. */
  dropX: number
  dropZ: number
  /** Tray length along the tray, and the instance z-scale that gives it. */
  funnelLen: number
  funnelScale: number
}

/** The wall face of a room/corridor wall, as |z|. */
const WALL_FACE = BANDS.roomWall - WALL.thickness / 2

export function chuteLayout(c: DrawerChute): ChuteLayout {
  const flip = c.z < 0 ? 1 : -1
  const dropX = (c.funnelTo.x - c.x) * flip
  const dropZ = (c.funnelTo.z - c.z) * flip
  const funnelLen = (dropZ + FUNNEL.overshoot) / Math.cos(FUNNEL.deployTilt)
  return {
    roomId: c.roomId,
    x: c.x,
    z: c.z,
    flip,
    yaw: flip === 1 ? 0 : Math.PI,
    back: WALL_FACE - Math.abs(c.z),
    topY: c.topY,
    bottomY: c.bottomY,
    pivotY: c.topY - CHUTE.pivotBelowTop,
    dropX,
    dropZ,
    funnelLen,
    funnelScale: funnelLen / FUNNEL.baseLength,
  }
}

/** One layout per room, in `ROOMS` order (the same order as `DRAWER_CHUTES`). */
export const CHUTE_LAYOUTS: readonly ChuteLayout[] = DRAWER_CHUTES.map(chuteLayout)

/** Where the deployed tray's far end lies, in chute-local metres: outward from the tube axis and its height at the hinge line. */
export function funnelTipOutward(l: ChuteLayout): number {
  return l.funnelLen * Math.cos(FUNNEL.deployTilt)
}

/** The glow strip on the plate, chute-local: centre height, height, and centre z (it lies on the plate's front face, behind the tube). */
export function chuteStrip(l: ChuteLayout): { y: number; h: number; z: number } {
  const y0 = l.bottomY + CHUTE.strip.bottom
  const y1 = l.topY - CHUTE.strip.top
  const zFront = -l.back - CHUTE.plate.sunk + CHUTE.plate.t
  return { y: (y0 + y1) / 2, h: y1 - y0, z: zFront + CHUTE.strip.t / 2 }
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

function mergeAndFree(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('Chute: could not merge geometries')
  return merged
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(w, h, d).translate(x, y, z)
}

function place(g: BufferGeometry, l: ChuteLayout): BufferGeometry {
  return g.rotateY(l.yaw).translate(l.x, 0, l.z)
}

/** The glass tubes, all sixteen merged (world coordinates). */
export function buildChuteGlass(layouts: readonly ChuteLayout[] = CHUTE_LAYOUTS): BufferGeometry {
  return mergeAndFree(
    layouts.map((l) =>
      new CylinderGeometry(CHUTE.radius, CHUTE.radius, l.topY - l.bottomY, CHUTE.radialSegments, 1, true).translate(l.x, (l.topY + l.bottomY) / 2, l.z),
    ),
  )
}

/** The white parts of one chute, chute-local (not yet placed). */
export function chuteHardwareLocal(l: ChuteLayout): BufferGeometry[] {
  const { plate, strap, flange, ear, crossbar } = CHUTE
  const zBack = -l.back - plate.sunk
  const zFront = -l.back - plate.sunk + plate.t
  const plateTop = l.topY + plate.above
  const parts: BufferGeometry[] = []
  // flange where the tube enters the cabinet: flush with the cabinet's corridor edge, back against the wall
  parts.push(box(flange.hx * 2, flange.h, flange.zFront - zBack, 0, l.bottomY + flange.h / 2, (flange.zFront + zBack) / 2))
  // the back plate, from the cabinet top up past the hinge
  parts.push(box(plate.w, plateTop - l.bottomY, plate.t, 0, (plateTop + l.bottomY) / 2, (zBack + zFront) / 2))
  // crossbar and hinge arms: the pivot is on the tube axis, the arms stand either side of the tray
  parts.push(box(crossbar.hx * 2, crossbar.h, plate.t, 0, l.pivotY, (zBack + zFront) / 2))
  const earLen = ear.cap - zBack
  for (const s of [-1, 1]) {
    parts.push(box(ear.w, ear.h, earLen, s * ear.x, l.pivotY, (zBack + ear.cap) / 2))
    parts.push(new CylinderGeometry(ear.cap, ear.cap, ear.w + 0.004, 8).rotateZ(Math.PI / 2).translate(s * (ear.x + 0.002), l.pivotY, 0))
  }
  // clamp rings
  for (const h of strap.heights) parts.push(new TorusGeometry(strap.r, strap.tube, 4, 10).rotateX(Math.PI / 2).translate(0, l.bottomY + h, 0))
  return parts
}

/** The white hardware of all sixteen chutes merged (world coordinates). */
export function buildChuteHardware(layouts: readonly ChuteLayout[] = CHUTE_LAYOUTS): BufferGeometry {
  return mergeAndFree(layouts.map((l) => place(mergeAndFree(chuteHardwareLocal(l)), l)))
}

/**
 * One funnel tray, hinge-local: the origin is the pivot on the tube axis, the tray runs out along +z and its floor's top
 * face is y = 0. Rotating it about x by a negative angle lifts its far end.
 */
export function funnelGeometry(): BufferGeometry {
  const { w, floorT, floorStart, rimH, rimT, rimLen, wing, baseLength } = FUNNEL
  const floorLen = baseLength - floorStart
  const parts: BufferGeometry[] = [
    box(w, floorT, floorLen, 0, -floorT / 2, floorStart + floorLen / 2),
    // rims run from the pivot (so they carry the hinge) along the first part of the tray
    box(rimT, rimH + floorT, rimLen + 0.012, -(w / 2 - rimT / 2), (rimH - floorT) / 2, (rimLen - 0.012) / 2),
    box(rimT, rimH + floorT, rimLen + 0.012, w / 2 - rimT / 2, (rimH - floorT) / 2, (rimLen - 0.012) / 2),
  ]
  // wings: angled so the tray narrows to the tube's mouth
  for (const s of [-1, 1]) {
    parts.push(new BoxGeometry(wing.t, wing.h, wing.len).rotateY(s * wing.yaw).translate(s * wing.x, wing.h / 2, wing.z))
  }
  return mergeAndFree(parts)
}
