/**
 * Per-person emote state and the per-frame fill of the instance buffers, with no React and no allocation per frame.
 *
 * Every person who has ever shown up gets a stable SLOT. The animation state lives in typed arrays indexed by slot,
 * so a person keeps their icon's pop and fade even while others come and go. The id -> slot map is rebuilt only when
 * the number of people changes, or about four times a second (`SYNC_SECONDS`) to catch one person leaving as another
 * arrives. Between rebuilds a frame is a plain loop over the slots.
 *
 * `update` writes the icons that are visible this frame, compacted to the front of `posSize` / `uvRect` / `alphaOut`,
 * which the layer uploads as instanced attributes: one draw call for all of them.
 */
import type { Entity, Vec3 } from '@/sim/types'
import { EMOTE_CODE, UV_TABLE } from './emoteAtlas'
import {
  CENTRE_LIFT,
  FADE_IN_SECONDS,
  FADE_OUT_SECONDS,
  MAX_RANGE,
  POP_SECONDS,
  emoteWorldSize,
  fadeCurve,
  popScale,
  rangeFade,
} from './emoteMath'
import { headAnchor } from './headAnchor'

/** Most people tracked (the crowd renderer's MAX_PEOPLE). Anyone beyond this gets no icon. */
export const MAX_TRACKED = 320
/** How often the id -> slot map is rebuilt even if the head count has not changed. */
export const SYNC_SECONDS = 0.25
/** Longest frame step the animations accept (a stalled tab must not skip the pop). */
export const MAX_STEP = 0.1
/** A person this faded out gets no icon. */
const MIN_VISIBLE_FADE = 0.02

const anchor: Vec3 = { x: 0, y: 0, z: 0 }

export class EmoteTracker {
  /** Instance data for the first `count` icons: x, y, z of the quad centre and its size (metres). */
  readonly posSize: Float32Array
  /** Instance data: u, v, width, height of the icon in the atlas. */
  readonly uvRect: Float32Array
  /** Instance data: opacity 0..1. */
  readonly alphaOut: Float32Array
  /** Icons written by the last `update`. */
  count = 0

  private readonly entities: (Entity | null)[]
  private readonly slotOf = new Map<string, number>()
  private readonly freeSlots: Int32Array
  private freeCount = 0
  /** One past the highest slot ever handed out. */
  private high = 0
  private lastSize = -1
  private sinceSync = 0

  // animation state, per slot
  /** Icon code being drawn (0 = none). Kept while the icon fades out. */
  private readonly shown: Uint8Array
  /** Pop-in progress 0..1. Frozen while the icon fades out, so the exit does not change its size. */
  private readonly grow: Float32Array
  /** Fade level 0..1. */
  private readonly level: Float32Array

  constructor(
    private readonly source: ReadonlyMap<string, Entity>,
    readonly capacity: number = MAX_TRACKED,
  ) {
    this.entities = new Array<Entity | null>(capacity).fill(null)
    this.freeSlots = new Int32Array(capacity)
    this.shown = new Uint8Array(capacity)
    this.grow = new Float32Array(capacity)
    this.level = new Float32Array(capacity)
    this.posSize = new Float32Array(capacity * 4)
    this.uvRect = new Float32Array(capacity * 4)
    this.alphaOut = new Float32Array(capacity)
  }

  /** Number of people currently holding a slot. */
  get tracked(): number {
    return this.slotOf.size
  }

  /** The slot of a person, or undefined when they have none. */
  slotFor(id: string): number | undefined {
    return this.slotOf.get(id)
  }

  /**
   * Rebuild the id -> slot map from the source. Keeps the slot (and so the animation state) of everyone who stays.
   * People who left free their slots first, so a newcomer reuses one instead of growing the table.
   */
  sync(): void {
    this.lastSize = this.source.size
    this.sinceSync = 0
    for (const [id, s] of this.slotOf) {
      if (this.source.has(id)) continue
      this.slotOf.delete(id)
      this.entities[s] = null
      this.shown[s] = 0
      this.freeSlots[this.freeCount++] = s
    }
    for (const [id, e] of this.source) {
      let s = this.slotOf.get(id)
      if (s === undefined) {
        s = this.takeSlot()
        if (s < 0) continue // full: this person gets no icon
        this.slotOf.set(id, s)
        this.shown[s] = 0
        this.grow[s] = 0
        this.level[s] = 0
      }
      this.entities[s] = e // the sim may swap the object for the same id
    }
  }

  private takeSlot(): number {
    if (this.freeCount > 0) return this.freeSlots[--this.freeCount]
    if (this.high < this.capacity) return this.high++
    return -1
  }

  /**
   * Advance every icon by `dt` seconds and fill the instance buffers for a camera at (cx, cy, cz).
   * Returns the number of visible icons (also in `count`).
   */
  update(dt: number, cx: number, cy: number, cz: number): number {
    const step = dt > MAX_STEP ? MAX_STEP : dt > 0 ? dt : 0
    this.sinceSync += step
    if (this.source.size !== this.lastSize || this.sinceSync >= SYNC_SECONDS) this.sync()

    const growStep = step / POP_SECONDS
    const inStep = step / FADE_IN_SECONDS
    const outStep = step / FADE_OUT_SECONDS
    const maxD2 = MAX_RANGE * MAX_RANGE
    let n = 0
    for (let s = 0; s < this.high; s++) {
      const e = this.entities[s]
      if (e === null) continue
      const code = EMOTE_CODE[e.emote]
      if (code !== 0) {
        if (code !== this.shown[s]) {
          // a new icon (or a different one replacing the last): pop in from nothing
          this.shown[s] = code
          this.grow[s] = 0
        }
        const g = this.grow[s] + growStep
        this.grow[s] = g > 1 ? 1 : g
        const l = this.level[s] + inStep
        this.level[s] = l > 1 ? 1 : l
      } else if (this.level[s] > 0) {
        const l = this.level[s] - outStep
        this.level[s] = l > 0 ? l : 0
      }
      if (this.level[s] <= 0) {
        this.shown[s] = 0
        continue
      }
      const vis = e.fade === undefined ? 1 : e.fade
      if (vis < MIN_VISIBLE_FADE) continue

      headAnchor(e, anchor)
      const dx = anchor.x - cx
      const dy = anchor.y + 0.35 - cy
      const dz = anchor.z - cz
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= maxD2) continue
      const d = Math.sqrt(d2)
      const range = rangeFade(d)
      if (range <= 0) continue

      const base = emoteWorldSize(d)
      const p = n * 4
      this.posSize[p] = anchor.x
      this.posSize[p + 1] = anchor.y + CENTRE_LIFT * base
      this.posSize[p + 2] = anchor.z
      this.posSize[p + 3] = base * popScale(this.grow[s])
      const t = (this.shown[s] - 1) * 4
      this.uvRect[p] = UV_TABLE[t]
      this.uvRect[p + 1] = UV_TABLE[t + 1]
      this.uvRect[p + 2] = UV_TABLE[t + 2]
      this.uvRect[p + 3] = UV_TABLE[t + 3]
      this.alphaOut[n] = fadeCurve(this.level[s]) * (vis > 1 ? 1 : vis) * range
      n++
    }
    this.count = n
    return n
  }

  /** The icon code drawn for a person right now (0 = none), for tests and debugging. */
  shownCode(id: string): number {
    const s = this.slotOf.get(id)
    return s === undefined ? 0 : this.shown[s]
  }
}
