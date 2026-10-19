/**
 * R2: the lobby gate. Every lift lobby (a shaft on a level) has room for ONE stretcher (or wheelchair) party and `CONFIG.lifts.lobbyWalkers`
 * waiting walkers. The four lobbies are numbered in a fixed order (A1 < A2 < B1 < B2). A party that rides takes its departure AND its
 * arrival lobby together or not at all (`LiftBank.grant` tries both in that fixed order within one step and keeps neither unless it gets
 * both), so nobody ever holds one lobby while waiting for another: there is no hold-and-wait, hence no deadlock. A fade (the ER's
 * "admitted to a ward upstairs", a MealBot's service run) takes only the stretcher slot of the one lobby it uses (`claimFade`).
 *
 * A lobby has two kinds of room. DEPARTURE room is where a party waits for its car: one stretcher slot and `lobbyWalkers` walker spots.
 * LANDING room is where a party that has just ridden steps out: the same stretcher slot, and the row of car spots of its car (a car carries
 * at most `walkersPerCar` walkers, and a car lands one load at a time, so walkers never need more than that per car; they never wait there).
 * A ride reserves the departure room of its first lobby and the landing room of its second together.
 *
 * Pure bookkeeping: no people, no time.
 */
import { CONFIG } from '../config'
import type { LevelId } from '../levels'
import type { ShaftId } from '../places'

/** 0 = A1, 1 = A2, 2 = B1, 3 = B2: the fixed order every reservation is taken in. */
export type LobbyKey = 0 | 1 | 2 | 3
export const LOBBY_KEYS: readonly LobbyKey[] = [0, 1, 2, 3]

/** Walkers that can be landing in one lobby at once: a full car per car of the shaft. */
export const LANDING_CAPACITY = CONFIG.lifts.carsPerShaft * CONFIG.lifts.walkersPerCar

export function lobbyKey(shaft: ShaftId, level: LevelId): LobbyKey {
  return ((shaft === 'A' ? 0 : 2) + (level - 1)) as LobbyKey
}

export function lobbyShaft(key: LobbyKey): ShaftId {
  return key < 2 ? 'A' : 'B'
}

export function lobbyLevel(key: LobbyKey): LevelId {
  return (key % 2 === 0 ? 1 : 2) as LevelId
}

/** "A1", "A2", "B1", "B2". */
export function lobbyName(key: LobbyKey): string {
  return `${lobbyShaft(key)}${lobbyLevel(key)}`
}

export class LobbyGate {
  /** Who holds the stretcher slot (a trip's owner id, or a fade's owner), or null. */
  stretcherBy: string | null = null
  /** Who holds the lobby for a fade (the ER's "admitted to a ward upstairs", a MealBot run): nobody lands from a car while it stands here. */
  fadeBy: string | null = null
  /** Who holds each waiting-walker slot. */
  readonly walkerBy: (string | null)[]
  /** Who has walkers landing here (one entry per person). */
  readonly landingBy: string[] = []

  constructor(readonly key: LobbyKey) {
    this.walkerBy = new Array<string | null>(CONFIG.lifts.lobbyWalkers).fill(null)
  }

  get freeWalkers(): number {
    let n = 0
    for (const w of this.walkerBy) if (w === null) n++
    return n
  }

  /** Would a party needing a stretcher slot and `walkers` walker slots fit right now? */
  fits(stretcher: boolean, walkers: number): boolean {
    if (stretcher && this.stretcherBy !== null) return false
    return this.freeWalkers >= walkers
  }

  /** Take the slots (call only after `fits`); returns the walker slot indices taken, lowest first. */
  take(owner: string, stretcher: boolean, walkers: number): number[] {
    if (stretcher) this.stretcherBy = owner
    const slots: number[] = []
    for (let i = 0; i < this.walkerBy.length && slots.length < walkers; i++) {
      if (this.walkerBy[i] === null) {
        this.walkerBy[i] = owner
        slots.push(i)
      }
    }
    return slots
  }

  /**
   * Hold the lobby for a fade: the stretcher slot, and nobody landing (a MealBot or a stretcher at the lobby's door would stand where the
   * riders step out). False while the slot is held or a ride has this lobby reserved for landing.
   */
  takeFade(owner: string): boolean {
    if (this.fadeBy === owner) return true
    if (this.stretcherBy !== null || this.landingBy.length > 0) return false
    this.stretcherBy = owner
    this.fadeBy = owner
    return true
  }

  /** Would a party landing here with a stretcher and/or `walkers` walkers have room? */
  fitsLanding(stretcher: boolean, walkers: number): boolean {
    if (this.fadeBy !== null) return false
    if (stretcher && this.stretcherBy !== null) return false
    return this.landingBy.length + walkers <= LANDING_CAPACITY
  }

  /** Take the landing room (call only after `fitsLanding`). */
  takeLanding(owner: string, stretcher: boolean, walkers: number): void {
    if (stretcher) this.stretcherBy = owner
    for (let i = 0; i < walkers; i++) this.landingBy.push(owner)
  }

  /** Free everything `owner` holds here. */
  release(owner: string): void {
    for (let i = this.landingBy.length - 1; i >= 0; i--) if (this.landingBy[i] === owner) this.landingBy.splice(i, 1)
    if (this.stretcherBy === owner) this.stretcherBy = null
    if (this.fadeBy === owner) this.fadeBy = null
    for (let i = 0; i < this.walkerBy.length; i++) if (this.walkerBy[i] === owner) this.walkerBy[i] = null
  }

  holds(owner: string): boolean {
    return this.stretcherBy === owner || this.walkerBy.includes(owner) || this.landingBy.includes(owner)
  }
}
