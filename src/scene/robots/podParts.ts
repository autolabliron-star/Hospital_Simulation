/**
 * MedPod geometry (W2: the pods HANG from the ceiling rail), built once and shared by all pods (one InstancedMesh per part).
 *
 * Everything is in POD SPACE: the origin is the pod's pivot, on the rail's underside (`ROBOT.rail.undersideY`) straight over
 * the pod's centre, +y is up (so the body is at negative y) and local +z is the direction of travel (heading 0 faces +z).
 * An instance matrix is then just "move to (x, undersideY, z), yaw by the heading, sway about the pivot".
 *
 *   bogie    a small trolley under the rail: plate and four wheels         (MAT.metalDark)   yaws with the rail, never sways
 *   body     the rounded body from `podBottomY` to `podTopY` plus the neck up to the pivot   (MAT.whitePlastic)
 *   ring     a light band near the top of the body, tinted per pod         (MAT.tintedGlow)
 *   face     the screen on the front, one atlas cell per pod               (local material, see faceMaterial.ts)
 *   lid      four compartment lids on top of the body, tinted per lid      (MAT.tinted)
 *   hatch    ONE plate shape (MAT.frame, instance colours): instances [0, N) are the bottom hatches, [N, 2N) the side hatches,
 *            [2N, 3N) and [3N, 4N) their dark seats (thin plates under them that show once a plate has moved away)
 *
 * The bottom hatch SLIDES back along the pod when it opens (so it never dips below `podBottomY`: at a drawer a funnel waits 1 cm
 * under the pod). The side hatch is modelled on the pod's local +x side (the MedVend side of ward A's dock lane) and swings out
 * like an awning; ward B's circuit is the mirror image, so its pods flip the side hatch by half a turn (`HATCH.flipForWard`).
 */
import { BoxGeometry, CylinderGeometry, type BufferGeometry, InstancedBufferAttribute, Matrix4, PlaneGeometry } from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ROBOT } from '@/sim/places'
import type { WardId } from '@/sim/types'
import { ATLAS, faceCell } from './faceAtlas'
import { SWAY } from './podMotion'

const { w: POD_W, l: POD_L, h: POD_H } = ROBOT.podSize
const PIVOT_Y = ROBOT.rail.undersideY

export const POD = {
  w: POD_W,
  l: POD_L,
  h: POD_H,
  /** World height of the pivot (the rail underside); pod-space y is measured from here. */
  pivotY: PIVOT_Y,
  /** Pod-space y of the body's bottom and top (negative: below the pivot). */
  bottom: ROBOT.podBottomY - PIVOT_Y,
  top: ROBOT.podTopY - PIVOT_Y,
  /** The ring: a thin band round the body just under its top. */
  ringT: 0.05,
  ringY: ROBOT.podTopY - PIVOT_Y - 0.065,
  /** The neck from the body's top up into the bogie. */
  neckR: 0.035,
  neckTop: -0.025,
  /** Lids: a 2 x 2 grid on the top, a hand's width either side of the neck. */
  lidOffset: 0.125,
  lidSize: 0.11,
  lidThick: 0.03,
  /** The face screen: centre height, size, and how far it stands off the front. */
  faceY: ROBOT.podBottomY - PIVOT_Y + 0.25,
  faceW: 0.34,
  faceH: 0.18,
  faceLift: 0.003,
} as const

/** The bogie under the rail: its plate (underside of the rail down to `plateBottom`), and the wheels. */
export const BOGIE = {
  plateW: 0.16,
  plateT: 0.045,
  plateL: 0.46,
  /** A hair under the rail's underside so the two never share a plane. */
  plateTop: -0.001,
  /** Small enough that the wheels (beside the rail, not under it) stay below the rail's underside plane. */
  wheelR: 0.022,
  wheelW: 0.03,
  wheelX: 0.095,
  wheelZ: 0.15,
} as const

/** A hatch is a plate of this size hinged (or guided) along one edge, the instance origin, reaching `reach` from it. */
export const HATCH = {
  w: 0.3,
  reach: 0.25,
  t: 0.012,
  /** How far the closed plates stand proud of the body, so the bottom one (and the pod) ends exactly at `podBottomY`. */
  proud: 0.006,
  /** The bottom hatch slides back this far (its own reach: the whole opening is clear); the side hatch swings this far (radians) when fully open. */
  bottomSlide: 0.25,
  sideOpen: 1.2,
  /** Pod-space hinge of the bottom hatch (rear edge, flush with the body's underside) and of the side hatch (top edge, on the +x side). */
  bottomHinge: { x: 0, y: ROBOT.podBottomY - PIVOT_Y + 0.006, z: -0.125 },
  sideHinge: { x: POD_W / 2, y: ROBOT.podBottomY - PIVOT_Y + 0.315, z: 0 },
  /** The dark seats: a sixth of a plate's thickness, a hair proud of the body face and hidden under the closed plate. */
  seatScale: 1 / 6,
  seatLift: 0.0015,
  /** Ward B's circuit is the mirror image of A's, so its MedVend is on the pod's other side: its side hatch is turned half a turn about the pivot's up axis. */
  flipForWard: (ward: WardId): boolean => ward === 'B',
} as const

/** Maps hatch space (plate along +z from the hinge, normal +y) onto the pod's +x side: reach points down, the normal points out. */
export const SIDE_HATCH_CLOSED = new Matrix4().set(
  // columns: hatch x -> pod -z, hatch y (the normal) -> pod +x, hatch z (the reach) -> pod -y
  0, 1, 0, 0,
  0, 0, -1, 0,
  -1, 0, 0, 0,
  0, 0, 0, 1,
)

const SEAT_SQUASH = new Matrix4().makeScale(1, HATCH.seatScale, 1)
/** Pod-space pose of the bottom hatch's dark seat (a thin plate in the plate's footprint, a millimetre up from its lower face). */
export const SEAT_BOTTOM = new Matrix4()
  .makeTranslation(HATCH.bottomHinge.x, HATCH.bottomHinge.y - 0.001, HATCH.bottomHinge.z)
  .multiply(SEAT_SQUASH)
/** Pod-space pose of the side hatch's dark seat on the +x side (turned for ward B by the caller, like the plate). */
export const SEAT_SIDE = new Matrix4()
  .makeTranslation(HATCH.sideHinge.x, HATCH.sideHinge.y, HATCH.sideHinge.z)
  .multiply(SIDE_HATCH_CLOSED)
  .multiply(new Matrix4().makeTranslation(0, HATCH.seatLift, 0))
  .multiply(SEAT_SQUASH)

/** Pod-space centres of the four compartment lids, in the order the pod fills its compartments. */
export const LID_CENTERS: readonly { x: number; y: number; z: number }[] = [
  { x: -POD.lidOffset, y: POD.top + POD.lidThick / 2 - 0.003, z: POD.lidOffset },
  { x: POD.lidOffset, y: POD.top + POD.lidThick / 2 - 0.003, z: POD.lidOffset },
  { x: -POD.lidOffset, y: POD.top + POD.lidThick / 2 - 0.003, z: -POD.lidOffset },
  { x: POD.lidOffset, y: POD.top + POD.lidThick / 2 - 0.003, z: -POD.lidOffset },
]

/** RoundedBoxGeometry and BoxGeometry disagree on indexing in this three version, so merge them non-indexed. */
function mergeAndFree(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(flat, false)
  for (const g of parts) g.dispose()
  for (const g of flat) g.dispose()
  if (!merged) throw new Error('MedPod: could not merge geometries')
  return merged
}

export function podBogieGeometry(): BufferGeometry {
  const { plateW, plateT, plateL, plateTop, wheelR, wheelW, wheelX, wheelZ } = BOGIE
  const parts: BufferGeometry[] = [new RoundedBoxGeometry(plateW, plateT, plateL, 2, 0.012).translate(0, plateTop - plateT / 2, 0)]
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(new CylinderGeometry(wheelR, wheelR, wheelW, 12).rotateZ(Math.PI / 2).translate(sx * wheelX, plateTop - plateT / 2, sz * wheelZ))
  }
  return mergeAndFree(parts)
}

/** The body, from the hatch's underside up to `podTopY`, with the neck that carries it up to the pivot. */
export function podBodyGeometry(): BufferGeometry {
  const y0 = POD.bottom + HATCH.proud
  const h = POD.top - y0
  const body = new RoundedBoxGeometry(POD_W, h, POD_L, 3, 0.06).translate(0, y0 + h / 2, 0)
  const neck = new CylinderGeometry(POD.neckR, POD.neckR, POD.neckTop - POD.top, 10).translate(0, (POD.neckTop + POD.top) / 2, 0)
  return mergeAndFree([body, neck])
}

export function podRingGeometry(): BufferGeometry {
  return new RoundedBoxGeometry(POD_W + 0.012, POD.ringT, POD_L + 0.012, 2, 0.02).translate(0, POD.ringY, 0)
}

export function podLidGeometry(): BufferGeometry {
  return new RoundedBoxGeometry(POD.lidSize, POD.lidThick, POD.lidSize, 1, 0.008)
}

/** The hatch plate, hinged along its z = 0 edge (the instance origin) and reaching along +z. */
export function podHatchGeometry(): BufferGeometry {
  return new BoxGeometry(HATCH.w, HATCH.t, HATCH.reach).translate(0, 0, HATCH.reach / 2)
}

/** The face quad, with a per-instance atlas cell offset (`aCell`, filled from `faceCell`). */
export function podFaceGeometry(podCount: number): BufferGeometry {
  const g = new PlaneGeometry(POD.faceW, POD.faceH).translate(0, POD.faceY, POD_L / 2 + POD.faceLift)
  const cells = new Float32Array(podCount * 2)
  for (let i = 0; i < podCount; i++) {
    const c = faceCell(i)
    cells[i * 2] = c.u
    cells[i * 2 + 1] = c.v
  }
  g.setAttribute('aCell', new InstancedBufferAttribute(cells, 2))
  return g
}

/** UV scale of one atlas cell (the shader multiplies the quad's 0..1 UV by this and adds `aCell`). */
export const CELL_SCALE = { u: 1 / ATLAS.cols, v: 1 / ATLAS.rows } as const

/**
 * World height of the highest point of a pod (the lid tops and the body's top corners) at its largest sway: what anything hung
 * above a docked pod (a chute, a funnel) must clear. The sway limits live in podMotion.ts.
 */
export function podTopAtMaxSway(maxAngle: number): number {
  const c = Math.cos(maxAngle)
  const s = Math.sin(maxAngle)
  const lidTop = POD.top + POD.lidThick - 0.003
  // pitch moves the ends of the pod (z = +-length/2) up and down; roll the sides (x = +-width/2)
  const pitch = Math.max(lidTop * c + (POD.lidOffset + POD.lidSize / 2) * s, POD.top * c + (POD_L / 2) * s)
  const roll = Math.max(lidTop * c + (POD.lidOffset + POD.lidSize / 2) * s, POD.top * c + (POD_W / 2) * s)
  return PIVOT_Y + Math.max(pitch, roll)
}

/** World height of the highest point of a pod at the largest sway it can reach (`SWAY.peak`). Kept under its old name for src/scene/pharmacy/keepClear.test.ts. */
export function podTopAtMaxLean(): number {
  return podTopAtMaxSway(SWAY.peak)
}
