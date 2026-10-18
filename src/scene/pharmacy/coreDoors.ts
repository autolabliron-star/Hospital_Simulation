/**
 * The pharmacist glass doors' logic, pure (no three.js, no React): when each opens, how far, and where its leaves are as solid boxes for
 * the player's body. PharmacistDoors.tsx only writes the instance matrices from it.
 *
 * W3, what changed: the doors used to sense only the sim's people (never you), ran at priority 0, and froze while the sim was paused, so
 * you walked through the shut glass. Now
 *   - they sense YOU as well, along the way you are going (`lead`, the same look-ahead as the walk doors: at a run a door starts opening
 *     about 3.9 m out and is wide open about 1.6 m out), and people of the sim from where they stand, as before;
 *   - the step is given in REAL seconds while the sim is paused (the caller passes it), so the doors keep working for you;
 *   - the leaves are published as blockers (src/scene/blockers.ts): 2 boxes per door, a centimetre thicker than the drawn bars on each side.
 *
 * A door is set off while anyone is within `DOOR.triggerPeople` of the centre of its opening, stays open `DOOR.closeAfter` seconds after the
 * last one leaves, and moves at `DOOR.speed` openings a second; the leaves are shown through a smoothstep (they ease in and out).
 */
import { DOOR, OPENINGS, type Opening } from './layout'

export interface CorePoint {
  x: number
  z: number
}

/** Anything with an entity position: the sim's `Person`. */
export interface CorePerson {
  entity: { position: CorePoint }
}

/** Where you are going: the velocity (m/s) and how many seconds ahead the doors look (filled in place, never reallocated). */
export interface CoreLead {
  vx: number
  vz: number
  seconds: number
}

/** A blocker is a centimetre thicker than the bar it stands for, each side. */
export const CORE_BLOCKER_GROW = 0.01
/** Boxes written per door (its two leaves). */
export const CORE_BLOCKERS_PER_DOOR = 2

const smooth = (k: number): number => k * k * (3 - 2 * k)

/** A leaf is half the opening wide; its centre is `leafWidth / 2 + e * leafTravel` from the middle of the opening, `e` the shown opening. */
export const coreLeafWidth = (o: Opening): number => o.width / 2
export const coreLeafTravel = (o: Opening): number => coreLeafWidth(o) - 0.04
/** The leaves ride `DOOR.inset` inside the core, in front of the fixed glass of its wall. */
export const coreLeafZ = (o: Opening): number => o.z + (o.side === 'N' ? 1 : -1) * DOOR.inset
/** Where leaf `side` (0 the lower x, 1 the higher) stands along x for the shown opening `e`. */
export const coreLeafX = (o: Opening, side: number, e: number): number => o.x + (side === 0 ? -1 : 1) * (coreLeafWidth(o) / 2 + e * coreLeafTravel(o))

/**
 * How many seconds a door advances in a frame of `dt` real seconds: sim time while the sim runs (so the doors keep up with the crowd at 2x
 * and 4x), REAL time while it is paused (the doors must still open for you), never more than 0.1 s of a hitch.
 */
export function doorStepSeconds(dt: number, paused: boolean, speed: number): number {
  return Math.min(Math.max(dt, 0), 0.1) * (paused ? 1 : Math.max(1, speed))
}

export class CoreDoors {
  readonly count: number
  /** The eased opening shown, 0..1, per door. */
  readonly shown: Float32Array
  /** The opening before easing: moves at a fixed rate. */
  readonly raw: Float32Array
  /** Seconds since anyone was near. */
  private readonly since: Float32Array
  private readonly openings: readonly Opening[]

  constructor(openings: readonly Opening[] = OPENINGS) {
    this.openings = openings
    this.count = openings.length
    this.shown = new Float32Array(this.count)
    this.raw = new Float32Array(this.count)
    this.since = new Float32Array(this.count).fill(99)
  }

  /** Is the centre of door `i` within the trigger radius of you: where you are, or the segment you are about to cover with a lead? */
  private youNear(i: number, player: CorePoint, lead: CoreLead | null): boolean {
    const o = this.openings[i]
    let dx = player.x - o.x
    let dz = player.z - o.z
    if (lead && lead.seconds > 0) {
      const sx = lead.vx * lead.seconds
      const sz = lead.vz * lead.seconds
      const len2 = sx * sx + sz * sz
      if (len2 > 1e-9) {
        let t = -(dx * sx + dz * sz) / len2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        dx += sx * t
        dz += sz * t
      }
    }
    return dx * dx + dz * dz < DOOR.triggerPeople * DOOR.triggerPeople
  }

  /**
   * Advance every door by `dt` seconds (sim time while the sim runs, real time while it is paused: the caller decides). Returns true when
   * any door's shown opening changed.
   */
  update(dt: number, people: readonly CorePerson[], player: CorePoint | null, lead: CoreLead | null = null): boolean {
    let changed = false
    const r2 = DOOR.triggerPeople * DOOR.triggerPeople
    for (let i = 0; i < this.count; i++) {
      const o = this.openings[i]
      let near = player !== null && this.youNear(i, player, lead)
      for (let k = 0; !near && k < people.length; k++) {
        const p = people[k].entity.position
        const dx = p.x - o.x
        const dz = p.z - o.z
        near = dx * dx + dz * dz < r2
      }
      this.since[i] = near ? 0 : this.since[i] + dt
      const want = near || this.since[i] < DOOR.closeAfter ? 1 : 0
      // move toward `want` and rest there (a fully open door that should stay open must not start closing every other frame)
      const before = this.shown[i]
      if (want > this.raw[i]) this.raw[i] = Math.min(1, this.raw[i] + dt * DOOR.speed)
      else if (want < this.raw[i]) this.raw[i] = Math.max(0, this.raw[i] - dt * DOOR.speed)
      this.shown[i] = smooth(this.raw[i])
      if (this.shown[i] !== before) changed = true
    }
    return changed
  }

  /** Open every door you are already within range of, at once (you pressed Tab into a doorway). True when any door changed. */
  snapOpenNear(player: CorePoint, lead: CoreLead | null = null): boolean {
    let changed = false
    for (let i = 0; i < this.count; i++) {
      if (!this.youNear(i, player, lead)) continue
      this.since[i] = 0
      if (this.raw[i] !== 1 || this.shown[i] !== 1) {
        this.raw[i] = 1
        this.shown[i] = 1
        changed = true
      }
    }
    return changed
  }
}

/**
 * The leaves of every door as solid floor boxes (src/scene/blockers.ts: cx, cz, ux, uz, hu, hv), for the openings in `shown`. Returns the
 * number of boxes written (`CORE_BLOCKERS_PER_DOOR` a door). Allocation-free.
 */
export function writeCoreBlockers(openings: readonly Opening[], shown: ArrayLike<number>, out: Float64Array): number {
  let n = 0
  for (let i = 0; i < openings.length; i++) {
    const o = openings[i]
    for (let side = 0; side < 2; side++) {
      const b = n * 6
      out[b] = coreLeafX(o, side, shown[i])
      out[b + 1] = coreLeafZ(o)
      out[b + 2] = 1
      out[b + 3] = 0
      out[b + 4] = coreLeafWidth(o) / 2
      out[b + 5] = DOOR.leafT / 2 + CORE_BLOCKER_GROW
      n++
    }
  }
  return n
}
