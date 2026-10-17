/**
 * The state of the walk-mode doors (W1): how open each is (0 shut, 1 wide), and what sets it off. Pure (no three.js, no React): the
 * sensing runs over plain positions, so node tests can drive it with a fake crowd. Allocation-free after the constructor.
 *
 * A door opens while anyone (a person of the sim, or you) is within its sensing radius of the centre of the opening, stays open for a
 * hold time after the last one leaves, then closes. The opening moves at a fixed rate and is shown through a smoothstep, so the leaves
 * ease in and out (the pattern of the pharmacy's robot doors).
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

/** Seconds to open fully (per unit of opening: speed is 1 / seconds) and seconds a door stays open after the last one leaves. */
export const DOOR_TIMING = {
  auto: { opens: 0.55, hold: 1.0 },
  swing: { opens: 0.6, hold: 0.9 },
} as const

const smooth = (k: number): number => k * k * (3 - 2 * k)

export class DoorBank {
  readonly count: number
  /** The eased opening shown (0..1). */
  readonly shown: Float32Array
  /** The opening before easing: moves at a fixed rate. */
  readonly raw: Float32Array
  /** Seconds since anyone was near. */
  private readonly since: Float32Array
  /** The `shown` values last handed out as changed (so unchanged frames cost nothing). */
  private readonly written: Float32Array
  private readonly cx: Float32Array
  private readonly cz: Float32Array
  private readonly r2: Float32Array
  private readonly rate: Float32Array
  private readonly hold: Float32Array

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
    doors.forEach((d, i) => {
      this.cx[i] = d.x
      this.cz[i] = d.z
      this.r2[i] = d.sense * d.sense
      const t = DOOR_TIMING[d.kind]
      this.rate[i] = 1 / t.opens
      this.hold[i] = t.hold
    })
  }

  private near(i: number, people: readonly PersonLike[], player: PointLike | null): boolean {
    const x = this.cx[i]
    const z = this.cz[i]
    const r2 = this.r2[i]
    if (player) {
      const dx = player.x - x
      const dz = player.z - z
      if (dx * dx + dz * dz < r2) return true
    }
    for (let k = 0; k < people.length; k++) {
      const p = people[k].entity.position
      const dx = p.x - x
      const dz = p.z - z
      if (dx * dx + dz * dz < r2) return true
    }
    return false
  }

  /**
   * Advance every door by `dt` seconds. Returns true when any door's shown opening differs from the last time this returned true
   * (so the caller rewrites the leaf matrices only then).
   */
  update(dt: number, people: readonly PersonLike[], player: PointLike | null): boolean {
    let changed = false
    for (let i = 0; i < this.count; i++) {
      this.since[i] = this.near(i, people, player) ? 0 : this.since[i] + dt
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
}
