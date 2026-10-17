/**
 * MedPod kinematics on the ward circuits: cruise, keep a gap to the pod ahead, and stop at the right place (rank, dock
 * port, drawer).
 *
 * W2: the pods hang from a ceiling rail that follows the circuit (the body rides 2.30 m above the floor), so they share no
 * floor space with people: a pod never waits for a person, the player or a MealBot, and nobody waits for a pod.
 *
 * The circuit is one closed one-way loop per ward and pods never overtake, so each pod's leader is fixed:
 * the next pod round the ring. Leaders are read from a snapshot taken at the start of the step, so the
 * result does not depend on update order and a follower can never reach where its leader was.
 *
 * Decisions about *where* a pod should stop come from its state (set by MedSystem); this file only drives.
 */
import { CONFIG } from '../config'
import { ROBOT } from '../places'
import type { Pod, WardId } from '../types'
import { CIRCUITS, forward, pointAt, segmentAt, wrapS, type Circuit, type PathPoint } from './circuit'

const P = CONFIG.pods
const POD_LEN = ROBOT.podSize.l
const SPACING = POD_LEN + P.minGap
/** A pod this close to its stop point counts as arrived. */
const ARRIVE_EPS = 1e-3

/** Per-pod driving memory that is not part of the shared Pod contract. */
export interface Driver {
  pod: Pod
  circuit: Circuit
  /** Arc length at the start of the current fixed step (for interpolation). */
  prevS: number
  /** Where the pod wants to stop (absolute arc length on its circuit), or null to cruise round. */
  stopAt: number | null
  /** Set when the pod reached `stopAt` this step. */
  arrived: boolean
  /** Total metres driven (battery, KPIs). */
  odometer: number
}

export function brakingDistance(v: number): number {
  return (v * v) / (2 * P.decel)
}

export class PodFleet {
  readonly drivers: Driver[] = []
  readonly byWard: Record<WardId, Driver[]> = { A: [], B: [] }
  private readonly snapshot = new Float64Array(64)
  private readonly tmp: PathPoint = { x: 0, z: 0, heading: 0 }

  constructor() {
    for (const w of ['A', 'B'] as WardId[]) {
      const c = CIRCUITS[w]
      for (let k = 0; k < ROBOT.podsPerWard; k++) {
        // queue in the rank: the first pod at the head, the rest behind it towards the entry door
        const s = c.rankHead - k * SPACING
        const pod: Pod = {
          id: `${w}${k + 1}`,
          ward: w,
          s,
          position: { x: 0, y: 0, z: 0 },
          heading: 0,
          speed: 0,
          state: 'charging',
          light: 'white',
          compartments: new Array(ROBOT.compartments).fill(null),
          waitingFor: null,
          battery: 1 - k * 0.04,
        }
        const d: Driver = {
          pod,
          circuit: c,
          prevS: s,
          stopAt: c.rankHead,
          arrived: false,
          odometer: 0,
        }
        this.drivers.push(d)
        // ring order = path order; the leader of index i is i-1 (the pod in front), wrapping round
        this.byWard[w].unshift(d)
      }
    }
    for (const d of this.drivers) this.writePose(d, d.pod.s)
  }

  /** The pod directly in front on the same circuit, or null when the ward has one pod. */
  leaderOf(d: Driver): Driver | null {
    const ring = this.byWard[d.pod.ward]
    if (ring.length < 2) return null
    const i = ring.indexOf(d)
    return ring[(i + 1) % ring.length]
  }

  step(dt: number): void {
    for (let i = 0; i < this.drivers.length; i++) {
      const d = this.drivers[i]
      d.prevS = d.pod.s
      this.snapshot[i] = d.pod.s
      d.arrived = false
    }
    for (const w of ['A', 'B'] as WardId[]) {
      const ring = this.byWard[w]
      for (let i = 0; i < ring.length; i++) {
        const d = ring[i]
        const leader = ring.length > 1 ? ring[(i + 1) % ring.length] : null
        const leaderS = leader ? this.snapshot[this.drivers.indexOf(leader)] : null
        this.drive(d, dt, leaderS)
      }
    }
  }

  private drive(d: Driver, dt: number, leaderS: number | null): void {
    const pod = d.pod
    const c = d.circuit
    const L = c.length
    const v = pod.speed

    // 1. distance to my own stop point
    let limit = Infinity
    let limitIsStop = false
    if (d.stopAt !== null) {
      let ds = forward(c, pod.s, d.stopAt)
      if (ds > L - 0.05) ds = 0 // already there (float noise must not send us round the loop)
      limit = ds
      limitIsStop = true
    }
    pod.waitingFor = null

    // 2. keep the gap to the pod in front
    let gap = Infinity
    if (leaderS !== null) {
      gap = forward(c, pod.s, leaderS) - SPACING
      if (gap < 0) gap = 0
      if (gap < limit) {
        limit = gap
        limitIsStop = false
        if (gap < 0.05 && v < 0.05) pod.waitingFor = 'pod'
      }
    }

    // 3. speed profile: cruise, but always able to stop within `limit`
    const cruise = segmentAt(c, pod.s).zone === 'core' ? P.coreSpeed : P.corridorSpeed
    const vStop = Math.sqrt(2 * P.decel * Math.max(0, limit))
    const target = Math.min(cruise, vStop)
    let nv = v < target ? Math.min(v + P.accel * dt, target) : target
    let adv = nv * dt
    if (adv >= limit) {
      adv = limit
      nv = limit === 0 ? 0 : nv
    }
    pod.s = wrapS(c, pod.s + adv)
    d.odometer += adv
    pod.battery = Math.max(0, pod.battery - adv * P.drainPerMetre)
    if (limit - adv <= ARRIVE_EPS && limitIsStop) {
      // snap exactly onto the stop so the next forward() is 0, not one loop
      pod.s = wrapS(c, d.stopAt!)
      nv = 0
      d.arrived = true
    }
    if (limit - adv <= ARRIVE_EPS && !limitIsStop) nv = 0
    pod.speed = nv
  }

  /** Interpolate between the last two fixed steps and write position and heading. */
  sync(alpha: number): void {
    for (const d of this.drivers) {
      const s = d.prevS + forward(d.circuit, d.prevS, d.pod.s) * alpha
      this.writePose(d, s)
    }
  }

  private writePose(d: Driver, s: number): void {
    const p = pointAt(d.circuit, s, this.tmp)
    d.pod.position.x = p.x
    d.pod.position.z = p.z
    d.pod.heading = p.heading
  }

  driverOf(podId: string): Driver {
    const d = this.drivers.find((x) => x.pod.id === podId)
    if (!d) throw new Error(`Unknown pod ${podId}`)
    return d
  }
}
