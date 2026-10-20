/**
 * S1 "Showcase": a short list of timed actions after a warm start that finish placing the hospital at work. One ward order
 * per ward at CONFIG.opening.medsAt (MedVend picks, a pod flies), and, at a showcase opening, early visitors in the
 * lounges. Simulation steps it only after an in-flight warm; it is `done` once its last action ran.
 */
import { patientInRoom } from '@/content/catalogue'
import { STAFF } from '@/content/staff'
import { CONFIG } from '../config'
import type { World } from '../er/world'
import type { MedSystem } from '../meds/system'
import type { Director } from '../population/director'
import { ROOMS } from '../places'
import type { Rng } from '../rng'
import type { OpeningKind, RoomId, WardId } from '../types'

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

const WARDS: readonly WardId[] = ['A', 'B']

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
    for (const s of CONFIG.opening.medsAt) this.actions.push({ at: t0 + s, run: () => this.writeWardOrders() })
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

  /** One rounds-style order per ward, for an occupied room with no open order yet. */
  private writeWardOrders(): void {
    const { meds, rng, world, occupied } = this.deps
    for (const ward of WARDS) {
      const rooms = ROOMS.filter((r) => r.ward === ward && occupied(r.id) && !this.hasOpenOrder(r.id))
      if (rooms.length === 0) continue
      const room = rng.pick(rooms)
      const usual = world.beds?.recordOf(room.id)?.usualMeds ?? patientInRoom(room.id).usualMeds
      if (usual.length === 0) continue
      // as the doctors' rounds do: one to three of the patient's usual medicines (demo data, no clinical logic)
      const count = rng.int(1, Math.min(3, usual.length))
      const chosen = rng.shuffle([...usual]).slice(0, count)
      const items = usual.filter((m) => chosen.includes(m)).map((medId) => ({ medId, qty: 1 }))
      const doctor = STAFF.find((s) => s.role === 'doctor' && s.ward === ward)
      if (!doctor) continue
      meds.prescribe({ roomId: room.id, items, prescriberId: doctor.id, source: 'sim' })
    }
  }

  private hasOpenOrder(roomId: RoomId): boolean {
    for (const o of this.deps.meds.orders.values()) {
      if (o.roomId === roomId && o.stage !== 'given' && o.cancelledAt === undefined) return true
    }
    return false
  }
}
