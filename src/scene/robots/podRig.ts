/**
 * The pods' per-frame work, without React so the node tests can run it on real InstancedMeshes: pose, sway, hatches,
 * light ring, face and lids. `PodsLayer` owns the meshes and calls `update` once per frame; nothing here allocates.
 *
 *   pose     `pod.position` (x, z) and `pod.heading` are already interpolated by Simulation.sync; the pod hangs from the rail,
 *            so its height is the contract's (`POD.pivotY`), never `pod.position.y`.
 *   sway     acceleration along the rail and across it (a turn) are measured over sim time, whenever the sim has stepped, and
 *            drive a damped pendulum (podMotion.ts) about the pivot on the rail's underside.
 *   dock     while `delivering` or `loading` the pendulum is held by a stiff, critically damped dock clamp (podMotion.ts): the sway of
 *            the stop is gone within about half a second, so a funnel 1 cm under the pod is never touched.
 *   hatches  the bottom hatch slides open for the whole of `delivering` (never below podBottomY), the side hatch swings out while the
 *            pod is `loading` (podMotion.ts), eased in sim time. Their dark seats are fixed to the body and show when a plate has moved.
 *   ring     `pod.light` (amber pulses softly while waiting), rewritten only when it changes.
 *   face     the destination room of the order, redrawn into the shared atlas only on change.
 *   lids     tinted from `pod.compartments`, rewritten only on change.
 */
import { Color, Matrix4, Object3D, type InstancedMesh } from 'three'
import { MEDICINES } from '@/content/catalogue'
import { STATUS } from '@/scene/materials'
import type { Pod, PodLight } from '@/sim/types'
import { faceLabel } from './faceAtlas'
import { hideInstances, prime } from './instancing'
import { HATCH_SECONDS, bottomHatchWants, easeHatch, isDocked, lateralAccel, moveHatch, sideHatchWants, stepSway, swayTarget } from './podMotion'
import { HATCH, LID_CENTERS, POD, SEAT_BOTTOM, SEAT_SIDE, SIDE_HATCH_CLOSED } from './podParts'

export interface PodMeshes {
  bogie: InstancedMesh
  body: InstancedMesh
  ring: InstancedMesh
  face: InstancedMesh
  lids: InstancedMesh
  /** 4 x pod count instances: [0, N) the bottom hatches, [N, 2N) the side hatches, [2N, 3N) and [3N, 4N) their dark seats. */
  hatches: InstancedMesh
}

export interface OrderLookup {
  get(id: string): { readonly roomId: string } | undefined
}

export interface FaceDrawer {
  draw(index: number, label: string): void
}

const LIGHT_INDEX: Record<PodLight, number> = { white: 0, teal: 1, amber: 2, green: 3 }
/** Status colours pushed above 1 so the ring blooms; the idle ring is calmer. */
const RING_COLOR = [
  new Color(STATUS.idle).multiplyScalar(0.85),
  new Color(STATUS.teal).multiplyScalar(1.7),
  new Color(STATUS.amber).multiplyScalar(1.7),
  new Color(STATUS.green).multiplyScalar(1.7),
]
const AMBER = LIGHT_INDEX.amber
const NEUTRAL_LID = new Color('#e1e8e8')
/** Hatch plates keep the palette's own grey; the seats under them are nearly black (they read as the opening). */
const PLATE_COLOR = new Color('#ffffff')
const SEAT_COLOR = new Color('#12191b')
const MED_COLOR = new Map<string, Color>(MEDICINES.map((m) => [m.id, new Color(m.color)]))

const LIDS = LID_CENTERS.length
const LID_LOCAL: Matrix4[] = LID_CENTERS.map((c) => new Matrix4().makeTranslation(c.x, c.y, c.z))
const FLIP_Y = new Matrix4().makeRotationY(Math.PI)

const pivot = new Object3D()
pivot.rotation.order = 'YXZ'
const bogie = new Object3D()
const pivotM = new Matrix4()
const baseM = new Matrix4()
const local = new Matrix4()
const out = new Matrix4()
const tmpColor = new Color()

export class PodRig {
  readonly count: number
  /** Sway state, four floats per pod: pitch, pitch rate, roll, roll rate. */
  readonly sway: Float32Array
  /** Hatch openings (linear 0..1, shown eased) per pod. */
  readonly bottomOpen: Float32Array
  readonly sideOpen: Float32Array
  private readonly accel: Float32Array
  private readonly lat: Float32Array
  private readonly lastSpeed: Float32Array
  private readonly lastHeading: Float32Array
  private readonly light: Int8Array
  private readonly labels: (string | null)[]
  private readonly lidKey: string[]
  private lastSimT: number
  /** False until the first frame has read the pods' speeds and headings (so a rebuilt hospital starts at rest, not with a jolt). */
  private primed = false

  constructor(
    count: number,
    private readonly atlas: FaceDrawer | null,
    simT = 0,
  ) {
    this.count = count
    this.sway = new Float32Array(count * 4)
    this.bottomOpen = new Float32Array(count)
    this.sideOpen = new Float32Array(count)
    this.accel = new Float32Array(count)
    this.lat = new Float32Array(count)
    this.lastSpeed = new Float32Array(count)
    this.lastHeading = new Float32Array(count)
    this.light = new Int8Array(count).fill(-1)
    this.labels = new Array<string | null>(count).fill(null)
    this.lidKey = new Array<string>(count * LIDS).fill('?')
    this.lastSimT = simT
  }

  /** Forget the motion history (a Jump swaps in another hospital): pods start at rest. */
  reset(simT: number): void {
    this.lastSimT = simT
    this.sway.fill(0)
    this.accel.fill(0)
    this.lat.fill(0)
    this.lastSpeed.fill(0)
    this.lastHeading.fill(0)
    this.bottomOpen.fill(0)
    this.sideOpen.fill(0)
    this.primed = false
  }

  /** Give the tinted meshes their instance colours before the first draw (no shader recompiles later) and hide every instance until the first frame places it. */
  init(m: PodMeshes): void {
    prime(m.ring, RING_COLOR[0])
    prime(m.lids, NEUTRAL_LID)
    prime(m.hatches, PLATE_COLOR)
    for (let i = this.count * 2; i < this.count * 4; i++) m.hatches.setColorAt(i, SEAT_COLOR)
    if (m.hatches.instanceColor) m.hatches.instanceColor.needsUpdate = true
    for (const mesh of [m.bogie, m.body, m.ring, m.face, m.lids, m.hatches]) hideInstances(mesh)
  }

  /**
   * One frame. `simT` is the sim clock, `simDt` the sim time this frame covers (0 while paused), `clock` real seconds
   * (for the amber pulse), `orders` the order book (for the face).
   */
  update(drivers: readonly { readonly pod: Pod }[], m: PodMeshes, simT: number, simDt: number, clock: number, orders: OrderLookup): void {
    const n = this.count
    if (!this.primed) {
      for (let i = 0; i < n; i++) {
        this.lastSpeed[i] = drivers[i].pod.speed
        this.lastHeading[i] = drivers[i].pod.heading
      }
      this.lastSimT = simT
      this.primed = true
    }
    // acceleration is measured over sim time, and only when the sim actually stepped since the last frame
    const stepped = simT - this.lastSimT
    const sampling = stepped > 1e-6
    const pulse = 0.55 + 0.45 * Math.sin(clock * 5)
    let ringChanged = false
    let lidChanged = false

    for (let i = 0; i < n; i++) {
      const pod = drivers[i].pod
      if (sampling) {
        this.accel[i] = (pod.speed - this.lastSpeed[i]) / stepped
        this.lat[i] = lateralAccel(pod.speed, pod.heading - this.lastHeading[i], stepped)
        this.lastSpeed[i] = pod.speed
        this.lastHeading[i] = pod.heading
      }
      // pitch swings back when speeding up; roll swings out of a turn (against the centripetal acceleration); a docked pod is clamped
      const docked = isDocked(pod.state, pod.speed)
      stepSway(this.sway, i * 4, swayTarget(this.accel[i]), simDt, docked)
      stepSway(this.sway, i * 4 + 2, swayTarget(-this.lat[i]), simDt, docked)
      this.bottomOpen[i] = moveHatch(this.bottomOpen[i], bottomHatchWants(pod.state), simDt, HATCH_SECONDS.bottom)
      this.sideOpen[i] = moveHatch(this.sideOpen[i], sideHatchWants(pod.state), simDt, HATCH_SECONDS.side)

      // the pod hangs under the rail: x, z and heading from the sim, the height from the contract
      pivot.position.set(pod.position.x, POD.pivotY, pod.position.z)
      pivot.rotation.set(this.sway[i * 4], pod.heading, this.sway[i * 4 + 2])
      pivot.updateMatrix()
      pivotM.copy(pivot.matrix)
      bogie.position.set(pod.position.x, POD.pivotY, pod.position.z)
      bogie.rotation.set(0, pod.heading, 0)
      bogie.updateMatrix()

      m.bogie.setMatrixAt(i, bogie.matrix)
      m.body.setMatrixAt(i, pivotM)
      m.ring.setMatrixAt(i, pivotM)
      m.face.setMatrixAt(i, pivotM)

      // bottom hatch: slides back along the underside (it stays at podBottomY, clear of a funnel just under it)
      const hb = HATCH.bottomHinge
      local.makeTranslation(hb.x, hb.y, hb.z - easeHatch(this.bottomOpen[i]) * HATCH.bottomSlide)
      out.multiplyMatrices(pivotM, local)
      m.hatches.setMatrixAt(i, out)
      out.multiplyMatrices(pivotM, SEAT_BOTTOM)
      m.hatches.setMatrixAt(n * 2 + i, out)
      // side hatch: hinged on its top edge on the MedVend side (ward B's side is the other one), the bottom edge swings out
      const hs = HATCH.sideHinge
      local.makeRotationZ(easeHatch(this.sideOpen[i]) * HATCH.sideOpen)
      local.setPosition(hs.x, hs.y, hs.z)
      local.multiply(SIDE_HATCH_CLOSED)
      if (HATCH.flipForWard(pod.ward)) {
        baseM.multiplyMatrices(pivotM, FLIP_Y)
        out.multiplyMatrices(baseM, local)
        m.hatches.setMatrixAt(n + i, out)
        out.multiplyMatrices(baseM, SEAT_SIDE)
      } else {
        out.multiplyMatrices(pivotM, local)
        m.hatches.setMatrixAt(n + i, out)
        out.multiplyMatrices(pivotM, SEAT_SIDE)
      }
      m.hatches.setMatrixAt(n * 3 + i, out)

      // light ring: only touch the colour when it changed (amber pulses while the pod waits)
      const l = LIGHT_INDEX[pod.light]
      if (this.light[i] !== l || l === AMBER) {
        this.light[i] = l
        if (l === AMBER) m.ring.setColorAt(i, tmpColor.copy(RING_COLOR[AMBER]).multiplyScalar(0.5 + 0.7 * pulse))
        else m.ring.setColorAt(i, RING_COLOR[l])
        ringChanged = true
      }

      // face screen: destination room, or the charge glyph
      const orderId = pod.orderId
      const label = faceLabel(orderId ? orders.get(orderId)?.roomId : undefined)
      if (this.labels[i] !== label) {
        this.labels[i] = label
        this.atlas?.draw(i, label)
      }

      // compartment lids
      for (let k = 0; k < LIDS; k++) {
        out.multiplyMatrices(pivotM, LID_LOCAL[k])
        m.lids.setMatrixAt(i * LIDS + k, out)
        const medId = pod.compartments[k] ?? ''
        if (this.lidKey[i * LIDS + k] !== medId) {
          this.lidKey[i * LIDS + k] = medId
          m.lids.setColorAt(i * LIDS + k, MED_COLOR.get(medId) ?? NEUTRAL_LID)
          lidChanged = true
        }
      }
    }
    if (sampling) this.lastSimT = simT

    m.bogie.instanceMatrix.needsUpdate = true
    m.body.instanceMatrix.needsUpdate = true
    m.ring.instanceMatrix.needsUpdate = true
    m.face.instanceMatrix.needsUpdate = true
    m.lids.instanceMatrix.needsUpdate = true
    m.hatches.instanceMatrix.needsUpdate = true
    if (ringChanged && m.ring.instanceColor) m.ring.instanceColor.needsUpdate = true
    if (lidChanged && m.lids.instanceColor) m.lids.instanceColor.needsUpdate = true
  }
}
