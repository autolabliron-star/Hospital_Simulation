/**
 * S1 "Showcase": a short list of timed actions after a warm start that finish placing the hospital at work: at a showcase
 * opening, early visitors in the lounges. MedVend and the pods are busy from the start without it: the 08:00 dose wave goes out
 * at the 07:30 opening (day/doseWaves.ts). Simulation steps it only after an in-flight warm; it is `done` once its last action ran.
 */
import type { World } from '../er/world'
import type { MedSystem } from '../meds/system'
import type { Director } from '../population/director'
import type { Rng } from '../rng'
import type { OpeningKind, RoomId } from '../types'

export interface OpeningDeps {
  world: World
  meds: MedSystem
  director: Director | null
  rng: Rng
  /** Who lies in a ward bed now (L1 bed flow), or null for an empty room. */
  occupied: (roomId: RoomId) => boolean
}

interface Action {
  /** Sim time at which it runs. */
  at: number
  run: () => void
}

export class OpeningScript {
  done = false
  private readonly actions: Action[] = []

  constructor(
    private readonly deps: OpeningDeps,
    /** The warm start's time. */
    readonly t0: number,
    readonly opening: OpeningKind,
  ) {
    // early visitors: a showcase opening at the start of the day only (a later warm start seeds its own visitors)
    if (opening === 'showcase' && t0 === 0) this.actions.push({ at: t0, run: () => this.seedVisitors() })
    this.actions.sort((a, b) => a.at - b.at)
  }

  /** Run whatever is due at `t`. */
  step(t: number): void {
    while (this.actions.length > 0 && t >= this.actions[0].at) this.actions.shift()!.run()
    if (this.actions.length === 0) this.done = true
  }

  private seedVisitors(): void {
    const w = this.deps.world
    const quiet = w.quiet
    w.quiet = true
    try {
      this.deps.director?.seedOpening()
    } finally {
      w.quiet = quiet
    }
  }
}
