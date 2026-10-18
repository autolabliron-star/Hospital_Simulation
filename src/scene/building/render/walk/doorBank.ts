/**
 * The state of the walk-mode doors (W1): how open each is (0 shut, 1 wide), and what sets it off. Pure (no three.js, no React): the
 * sensing runs over plain positions, so node tests can drive it with a fake crowd. Allocation-free after the constructor.
 *
 * A door opens while anyone (a person of the sim, or you) is within its sensing radius of the centre of the opening, stays open for a
 * hold time after the last one leaves, then closes. The opening moves at a fixed rate and is shown through a smoothstep, so the leaves
 * ease in and out (the pattern of the pharmacy's robot doors).
 *
 * W3: the leaves are SOLID (src/scene/blockers.ts), so a door has to be open when your body gets there. You sense it along the
 * segment from where you are to where your velocity takes you in `lead.seconds` (CONFIG.player.doorLeadSeconds): the door is set off
 * when its centre is within the sensing radius of that SEGMENT, so at a run (4.2 m/s, 2.5 m of lead) an auto door starts opening about
 * 5 m out and is wide open 2.7 m out, a swing door about 4.1 m out and wide open 1.6 m out. People of the sim are sensed from where
 * they are, as ever (a patient in bed 2.5 m from a swing door does not set it off).
 *
 * W3: swing doors are DOUBLE-ACTING, like the corridor doors of a real hospital. A shut door opens AWAY from whoever sets it off: the
 * leaf swings to the far side of the wall line from that body (you, sensed from where you stand; a person of the sim from where they
 * are), so it never swings into the path of the one who opened it and the pocket between an open leaf and the wall is never on the
 * way in. The direction (`swing`, +1 toward the door's `into` side, -1 the other way) is chosen on the frame a door starts to open
 * from fully shut, by the first body that senses it (you before the crowd), and then kept until the door has shut again: it never
 * flips mid-swing, not even when somebody comes at it from the other side while it is open or closing.
 */
import type { WalkDoor } from '../../layout/walk/types'

export interface PointLike {
  x: number
  z: number
}

/** Anything with an entity position: the sim's `Person`. */
export interface PersonLike {
  entity: { position: PointLike }
}

/** Where your body is going: the velocity (m/s) and how many seconds ahead of you the doors look. Filled in place, never reallocated. */
export interface DoorLead {
  vx: number
  vz: number
  seconds: number
}

/** A lead that looks nowhere (a door senses you where you stand). */
export function newLead(): DoorLead {
  return { vx: 0, vz: 0, seconds: 0 }
}

/**
 * Fill `out` with your lead: the velocity you have, or the one your keys ask for (`wish`) when that is faster, so a door starts
 * opening on the frame you press the key and not only once the body has picked up speed. `seconds` is `CONFIG.player.doorLeadSeconds`.
 */
export function setLead(out: DoorLead, vx: number, vz: number, wishX: number, wishZ: number, seconds: number): DoorLead {
  const useWish = wishX * wishX + wishZ * wishZ > vx * vx + vz * vz
  out.vx = useWish ? wishX : vx
  out.vz = useWish ? wishZ : vz
  out.seconds = seconds
  return out
}

/** Seconds to open fully (per unit of opening: speed is 1 / seconds) and seconds a door stays open after the last one leaves. */
export const DOOR_TIMING = {
  auto: { opens: 0.55, hold: 1.0 },
  swing: { opens: 0.6, hold: 0.9 },
} as const

const smooth = (k: number): number => k * k * (3 - 2 * k)

/** A body this close to the wall line (m) is in the doorway: which side it is on is read from the way it is going instead. */
const SIDE_EPS = 0.02

export class DoorBank {
  readonly count: number
  /** The eased opening shown (0..1). */
  readonly shown: Float32Array
  /** The opening before easing: moves at a fixed rate. */
  readonly raw: Float32Array
  /**
   * Swing doors: which way the leaf swings, +1 toward the door's `into` side (as in the layout), -1 to the other side. Always +1 for an
   * auto door and for a swing door that has not opened yet. Changes only while the door is fully shut (`raw` 0), so the leaf you
   * see and the box your body hits (both written from this) never flip while the leaf is out.
   */
  readonly swing: Int8Array
  /** Seconds since anyone was near. */
  private readonly since: Float32Array
  /** The `shown` values last handed out as changed (so unchanged frames cost nothing). */
  private readonly written: Float32Array
  private readonly cx: Float32Array
  private readonly cz: Float32Array
  private readonly r2: Float32Array
  private readonly rate: Float32Array
  private readonly hold: Float32Array
  /** The unit vector across the wall toward the `into` side, per door (swing doors read it to see which side a body is on). */
  private readonly nx: Float32Array
  private readonly nz: Float32Array
  /** 1 for a swing (double-acting) door. */
  private readonly double: Uint8Array

  constructor(doors: readonly WalkDoor[]) {
    const n = doors.length
    this.count = n
    this.shown = new Float32Array(n)
    this.raw = new Float32Array(n)
    this.since = new Float32Array(n).fill(99)
    this.written = new Float32Array(n).fill(-1)
    this.cx = new Float32Array(n)
    this.cz = new Float32Array(n)
    this.r2 = new Float32Array(n)
    this.rate = new Float32Array(n)
    this.hold = new Float32Array(n)
    this.swing = new Int8Array(n).fill(1)
    this.nx = new Float32Array(n)
    this.nz = new Float32Array(n)
    this.double = new Uint8Array(n)
    doors.forEach((d, i) => {
      this.cx[i] = d.x
      this.cz[i] = d.z
      this.nx[i] = d.into.x
      this.nz[i] = d.into.z
      this.double[i] = d.kind === 'swing' ? 1 : 0
      this.r2[i] = d.sense * d.sense
      const t = DOOR_TIMING[d.kind]
      this.rate[i] = 1 / t.opens
      this.hold[i] = t.hold
    })
  }

  /** Is the centre of door `i` within its sensing radius of you (the point where you are, or with a lead the segment you are about to cover)? */
  private youNear(i: number, player: PointLike, lead: DoorLead | null): boolean {
    const x = this.cx[i]
    const z = this.cz[i]
    let dx = player.x - x
    let dz = player.z - z
    if (lead && lead.seconds > 0) {
      const sx = lead.vx * lead.seconds
      const sz = lead.vz * lead.seconds
      const len2 = sx * sx + sz * sz
      if (len2 > 1e-9) {
        // the point of the segment from you to where you will be that is closest to the door's centre
        let t = -(dx * sx + dz * sz) / len2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        dx += sx * t
        dz += sz * t
      }
    }
    return dx * dx + dz * dz < this.r2[i]
  }

  /**
   * The way a shut swing door `i` should open for a body at (px, pz): away from it, so +1 (toward `into`) for a body on the other side of
   * the wall line and -1 for a body on the `into` side. A body in the doorway (within `SIDE_EPS` of the line) has no side: the way its
   * lead is going decides (it is about to be on that side), and with no lead, +1.
   */
  private away(i: number, px: number, pz: number, lead: DoorLead | null): 1 | -1 {
    const nx = this.nx[i]
    const nz = this.nz[i]
    const across = (px - this.cx[i]) * nx + (pz - this.cz[i]) * nz
    if (across > SIDE_EPS) return -1
    if (across < -SIDE_EPS) return 1
    return lead !== null && lead.seconds > 0 && lead.vx * nx + lead.vz * nz < 0 ? -1 : 1
  }

  /**
   * 0 when nobody sets door `i` off, else the way a shut door would swing for the first body that does (you, then the people of the sim in
   * order): +1 or -1 as `swing`. For an auto door that is always +1 (it has no direction).
   */
  private sensed(i: number, people: readonly PersonLike[], player: PointLike | null, lead: DoorLead | null): 1 | 0 | -1 {
    const x = this.cx[i]
    const z = this.cz[i]
    const r2 = this.r2[i]
    const twoWay = this.double[i] === 1
    if (player && this.youNear(i, player, lead)) return twoWay ? this.away(i, player.x, player.z, lead) : 1
    for (let k = 0; k < people.length; k++) {
      const p = people[k].entity.position
      const dx = p.x - x
      const dz = p.z - z
      if (dx * dx + dz * dz < r2) return twoWay ? this.away(i, p.x, p.z, null) : 1
    }
    return 0
  }

  /**
   * Advance every door by `dt` seconds. Returns true when any door's shown opening differs from the last time this returned true
   * (so the caller rewrites the leaf matrices only then).
   */
  update(dt: number, people: readonly PersonLike[], player: PointLike | null, lead: DoorLead | null = null): boolean {
    let changed = false
    for (let i = 0; i < this.count; i++) {
      const from = this.sensed(i, people, player, lead)
      this.since[i] = from !== 0 ? 0 : this.since[i] + dt
      // a door that is fully shut takes its direction from whoever sets it off; once it is moving it keeps it until it has shut again
      if (from !== 0 && this.raw[i] === 0) this.swing[i] = from
      const want = this.since[i] < this.hold[i] ? 1 : 0
      const step = dt * this.rate[i]
      this.raw[i] = want === 1 ? Math.min(1, this.raw[i] + step) : Math.max(0, this.raw[i] - step)
      const e = smooth(this.raw[i])
      this.shown[i] = e
      if (Math.abs(e - this.written[i]) > 1e-4) {
        this.written[i] = e
        changed = true
      }
    }
    return changed
  }

  /**
   * Open every door you are already within sensing range of, at once (no easing): you pressed Tab into a doorway, and the leaves that
   * were shut while the overview ran must not be solid around you. Returns true when any door changed (the leaves need rewriting).
   */
  snapOpenNear(player: PointLike, lead: DoorLead | null = null): boolean {
    let changed = false
    for (let i = 0; i < this.count; i++) {
      if (!this.youNear(i, player, lead)) continue
      if (this.raw[i] === 0 && this.double[i] === 1) this.swing[i] = this.away(i, player.x, player.z, lead)
      this.since[i] = 0
      if (this.raw[i] !== 1 || this.shown[i] !== 1) {
        this.raw[i] = 1
        this.shown[i] = 1
        this.written[i] = -1
        changed = true
      }
    }
    return changed
  }
}
