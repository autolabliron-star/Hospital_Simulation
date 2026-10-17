/**
 * What E does right now (W1 walk-in). Every frame the interaction system gathers what is near you (registered interactables,
 * free seats, people) and this module picks the best one, so the prompt says what the key will do before it is pressed.
 * Adapted from Waltz City (src/scene/player/interactions.ts), with this project's reach and cone.
 *
 *   in reach      within the thing's radius (CONFIG.player.reach, 2 m, unless it gives its own)
 *   in front      within CONFIG.player.reachHalfAngleDeg (55 degrees) either side of where you face; closer than 0.7 m you
 *                 are touching it, whichever way you face
 *   best          lowest priority number first (bedside, console, station, drawer, door 1; gate 2; seat 3; prop 4; people 5),
 *                 then the nearest, with a small penalty for being off to the side
 *   steady        the current target keeps its place unless a rival is clearly better, and its reach is a little wider, so
 *                 the prompt neither flickers between two things nor blinks at the edge of reach
 *
 * Pure: no stores, no sim, no three.js, and `pickBest` allocates nothing (candidates live in a reusable pool), so it can run in
 * a frame callback. People are scanned from the sim's entities and seats from its seat registry; they are not registered.
 */
import type { Interactable, InteractableKind } from '@/scene/interact.store'
import { CONFIG } from '@/sim/config'
import type { Entity, SeatSpec } from '@/sim/types'

export type TargetKind = 'item' | 'seat' | 'person'

/** The priorities of the contract in `interact.store.ts`, plus people below everything. */
export const PRIORITY = { bedside: 1, console: 1, station: 1, drawer: 1, door: 1, gate: 2, seat: 3, prop: 4, person: 5 } as const satisfies Record<InteractableKind | 'person', number>

export const REACH = {
  /** Default range of an interactable that does not give its own. */
  radius: CONFIG.player.reach,
  /** Seats are taken from a bit nearer: you stand at the chair, not across the room. */
  seatRadius: CONFIG.player.reach * 0.75,
  halfAngle: (CONFIG.player.reachHalfAngleDeg * Math.PI) / 180,
  /** Closer than this you are basically touching it, whichever way you face. */
  pointBlank: 0.7,
  /** Ranking: distance in metres plus this much per radian off to the side. */
  anglePenalty: 0.5,
  /** The current target wins a tie of priority by this many metres of score. */
  stickiness: 0.35,
  /** The current target stays in reach this much further out and this much further round. */
  radiusSlack: 0.25,
  angleSlack: (8 * Math.PI) / 180,
} as const

export function priorityOf(kind: InteractableKind, explicit?: number): number {
  return explicit ?? PRIORITY[kind]
}

/** One thing in reach range. `ref` is what it came from, for the label and the action. */
export interface Candidate {
  kind: TargetKind
  /** The interactable id, seat id or entity id. */
  id: string
  ref: Interactable | SeatSpec | Entity | null
  priority: number
  x: number
  z: number
  radius: number
  /** False: shown with its locked label, but pressing the key does not use it. */
  enabled: boolean
}

export interface Facing {
  x: number
  z: number
  /** Radians, atan2(dx, dz): 0 faces +z. */
  heading: number
}

/** A reusable set of candidates: `begin()` empties it, `add()` fills the next slot. Slots are never freed. */
export class CandidatePool {
  readonly items: Candidate[] = []
  count = 0

  begin(): void {
    this.count = 0
  }

  add(kind: TargetKind, id: string, ref: Candidate['ref'], priority: number, x: number, z: number, radius: number, enabled: boolean): void {
    let c = this.items[this.count]
    if (!c) {
      c = { kind, id, ref, priority, x, z, radius, enabled }
      this.items.push(c)
    } else {
      c.kind = kind
      c.id = id
      c.ref = ref
      c.priority = priority
      c.x = x
      c.z = z
      c.radius = radius
      c.enabled = enabled
    }
    this.count++
  }
}

/** Where the pick landed: the index into the list, how far, and how far round (radians). Written by `pickBest`. */
export interface PickResult {
  index: number
  distance: number
  angle: number
}

export function newPickResult(): PickResult {
  return { index: -1, distance: 0, angle: 0 }
}

const TAU = Math.PI * 2

/** The signed difference b - a of two angles, wrapped to (-pi, pi]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  else if (d <= -Math.PI) d += TAU
  return d
}

/** Is `c` in reach of `who`: close enough and in front? `current` widens both a little. */
export function inReach(who: Facing, c: Candidate, current: boolean): boolean {
  const dx = c.x - who.x
  const dz = c.z - who.z
  const radius = c.radius + (current ? REACH.radiusSlack : 0)
  const d2 = dx * dx + dz * dz
  if (d2 > radius * radius) return false
  if (d2 <= REACH.pointBlank * REACH.pointBlank) return true
  const angle = Math.abs(angleDelta(who.heading, Math.atan2(dx, dz)))
  return angle <= REACH.halfAngle + (current ? REACH.angleSlack : 0)
}

/**
 * The best of the first `count` candidates, or false when none is in reach. `currentId` is the target picked last time (for
 * stickiness). Writes into `out` and allocates nothing.
 */
export function pickBest(who: Facing, list: readonly Candidate[], count: number, currentId: string | null, out: PickResult): boolean {
  let bestKey = Infinity
  out.index = -1
  for (let i = 0; i < count; i++) {
    const c = list[i]
    const isCurrent = currentId !== null && c.id === currentId
    if (!inReach(who, c, isCurrent)) continue
    const dx = c.x - who.x
    const dz = c.z - who.z
    const distance = Math.sqrt(dx * dx + dz * dz)
    const angle = distance < 1e-4 ? 0 : Math.abs(angleDelta(who.heading, Math.atan2(dx, dz)))
    const score = distance + REACH.anglePenalty * angle
    // priority dominates: a 1 outranks any 2 whatever the distances (the keys differ by far more than any score)
    const key = c.priority * 1000 + score - (isCurrent ? REACH.stickiness : 0)
    if (key < bestKey) {
      bestKey = key
      out.index = i
      out.distance = distance
      out.angle = angle
    }
  }
  return out.index >= 0
}

/** The convenience form for tests and one-off calls: the winning candidate, or null. */
export function pickTarget(who: Facing, candidates: readonly Candidate[], currentId: string | null = null): { candidate: Candidate; distance: number; angle: number } | null {
  const out = newPickResult()
  if (!pickBest(who, candidates, candidates.length, currentId, out)) return null
  return { candidate: candidates[out.index], distance: out.distance, angle: out.angle }
}

// ---------------------------------------------------------------------------------------------
// Gathering candidates (no allocation: plain index loops over arrays the system keeps up to date)
// ---------------------------------------------------------------------------------------------

/** Skip anything this far outside its own range: it cannot be in reach (the widest slack is `radiusSlack`). */
function near(who: Facing, x: number, z: number, radius: number): boolean {
  const dx = x - who.x
  const dz = z - who.z
  const r = radius + REACH.radiusSlack
  return dx * dx + dz * dz <= r * r
}

/** Registered interactables in range. One that is disabled and has no `lockedLabel` is skipped (the registry contract). */
export function addItems(pool: CandidatePool, who: Facing, items: readonly Interactable[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const radius = item.radius ?? REACH.radius
    if (!near(who, item.position.x, item.position.z, radius)) continue
    let enabled = true
    if (item.enabled) {
      try {
        enabled = item.enabled()
      } catch {
        enabled = false
      }
    }
    if (!enabled && item.lockedLabel === undefined) continue
    pool.add('item', item.id, item, priorityOf(item.kind, item.priority), item.position.x, item.position.z, radius, enabled)
  }
}

/** The seats worth offering: where an ordinary visitor sits. Bed, bay, table and desk seats are somebody's place of work or care. */
export const SITTABLE_KINDS: ReadonlySet<SeatSpec['kind']> = new Set(['waiting', 'cafe', 'lounge', 'bench'])

export function sittableSeats(all: readonly SeatSpec[]): SeatSpec[] {
  return all.filter((s) => SITTABLE_KINDS.has(s.kind))
}

/** Free seats in range. `isFree` asks the seat registry (nobody holds it, and it is not the one you sit on). */
export function addSeats(pool: CandidatePool, who: Facing, seats: readonly SeatSpec[], isFree: (id: string) => boolean): void {
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i]
    if (!near(who, s.x, s.z, REACH.seatRadius)) continue
    if (!isFree(s.id)) continue
    pool.add('seat', s.id, s, PRIORITY.seat, s.x, s.z, REACH.seatRadius, true)
  }
}

/** Can you talk to this entity right now: not you, not fading in or out, not carried on a stretcher or wheelchair. */
export function isTalkable(e: Pick<Entity, 'id' | 'fade' | 'riding'>): boolean {
  return e.id !== 'player' && (e.fade ?? 1) >= 0.5 && e.riding !== true
}

/** Anyone in range, from the entities (people are not registered: there are 120+ of them and they move). */
export function addPeople(pool: CandidatePool, who: Facing, people: readonly Entity[]): void {
  for (let i = 0; i < people.length; i++) {
    const e = people[i]
    if (!isTalkable(e)) continue
    if (!near(who, e.position.x, e.position.z, REACH.radius)) continue
    pool.add('person', e.id, e, PRIORITY.person, e.position.x, e.position.z, REACH.radius, true)
  }
}
