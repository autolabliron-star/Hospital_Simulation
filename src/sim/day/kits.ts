/**
 * Kits: how the day rhythm builds, finds, rests and retires the real controller of each kind of post. One kit per
 * `PostKind` (roster.ts). Everything a shift change needs to know about a role lives here, so the manager stays generic:
 *
 *   make      the controller of a rota entry, standing at its post
 *   post      where it stands when idle (the handover spot is beside it)
 *   atRest    nothing in hand: at its post and idle, so it may be taken off duty now
 *   release   what to give back when a controller is taken out of the simulation (seat claims, the idle-porter set, the scanner)
 *   attach    what to register when a controller takes over (the scanner's operator)
 *   stop      stop taking new work (a shift ending)
 *
 * The controllers are other builders' classes (Porter, Cleaner, ImagingOperator, Coordinator): this file only uses what
 * they make public, and falls back to what the shared boards say (`world.idlePorters`, the ER bays' `cleanerId`).
 */
import { Cleaner } from '../er/cleaner'
import { Porter } from '../er/porter'
import { ErDoctor, ErNurse, Receptionist, TriageNurse } from '../er/staff'
import { ER_DOCTOR_POSTS, ER_NURSE_POSTS, PATROL, PORTER_BASES, TRIAGE_NURSE_POSTS, type Post } from '../er/spots'
import type { World } from '../er/world'
import { ImagingOperator, OPERATOR_MODALITY } from '../imaging/operator'
import { Coordinator } from '../people'
import type { Person } from '../person'
import { COMMAND_SEATS, LOBBY } from '../places'
import type { Rng } from '../rng'
import type { ImagingModality, SeatSpec } from '../types'
import type { Walker } from '../walker'
import { DeepCleaner } from './deepCleaner'
import type { PostKind, RotaEntry } from './roster'

export interface Kit {
  make(world: World, r: RotaEntry, walker: Walker, rng: Rng): Person
  post(world: World, r: RotaEntry): Post
  atRest(world: World, p: Person): boolean
  release(world: World, p: Person, r: RotaEntry): void
  attach(world: World, p: Person, r: RotaEntry): void
}

/** The controller classes that learned to stop taking work (er/staff.ts, deepCleaner.ts). */
function stoppable(p: Person): p is Person & { retiring: boolean } {
  return 'retiring' in p
}

/** Stop taking new work. A controller that cannot stop is waited for until it is at rest on its own. */
export function stop(p: Person): void {
  if (stoppable(p)) p.retiring = true
}

function nothing(): void {}

function bareKit(): Pick<Kit, 'release' | 'attach'> {
  return { release: nothing, attach: nothing }
}

function erStaffAtRest(_w: World, p: Person): boolean {
  return (p as unknown as { atRest: boolean }).atRest
}

const KITS: Record<PostKind, Kit> = {
  reception: {
    make: (w, r, walker, rng) => new Receptionist(w, r.member, walker, rng),
    post: () => ({ at: LOBBY.reception.at, heading: LOBBY.reception.heading }),
    atRest: erStaffAtRest,
    ...bareKit(),
  },
  triage: {
    make: (w, r, walker, rng) => new TriageNurse(w, r.member, r.post!.index, walker, rng),
    post: (_w, r) => TRIAGE_NURSE_POSTS[r.post!.index],
    atRest: erStaffAtRest,
    ...bareKit(),
  },
  erDoctor: {
    make: (w, r, walker, rng) => new ErDoctor(w, r.member, r.post!.index, walker, rng),
    post: (_w, r) => ER_DOCTOR_POSTS[r.post!.index],
    atRest: erStaffAtRest,
    ...bareKit(),
  },
  erNurse: {
    make: (w, r, walker, rng) => new ErNurse(w, r.member, r.post!.index, walker, rng),
    post: (_w, r) => ER_NURSE_POSTS[r.post!.index],
    atRest: erStaffAtRest,
    ...bareKit(),
  },
  porter: {
    make: (w, r, walker, rng) => new Porter(w, r.member, r.post!.index, walker, rng),
    post: (_w, r) => PORTER_BASES[r.post!.index],
    // a porter stands in the idle set exactly when she is idle at her base
    atRest: (w, p) => w.idlePorters.has(p.entity.id),
    release: (w, p) => {
      w.idlePorters.delete(p.entity.id)
    },
    attach: nothing,
  },
  cleaner: {
    make: (w, r, walker, rng) =>
      r.member.shift === 'night' ? new DeepCleaner(w, r.member, r.post!.index, walker, rng) : new Cleaner(w, r.member, r.post!.index, walker, rng),
    post: (_w, r) => ({ at: PATROL[r.post!.index * 5].at, heading: 0 }),
    atRest: (w, p) => {
      const self = p as unknown as { atRest?: boolean }
      if (self.atRest !== undefined) return self.atRest
      // a day cleaner (no public state): free when she holds no ER bay and no ward room of the bed board
      const id = p.entity.id
      if (w.er.bays.some((b) => b.cleanerId === id)) return false
      if (w.beds) for (const rec of w.beds.rooms.values()) if (rec.clean && rec.clean.cleanerId === id && !rec.clean.done) return false
      return p.entity.roomId === undefined
    },
    ...bareKit(),
  },
  imaging: {
    make: (w, r, walker, rng) => {
      const modality = OPERATOR_MODALITY[r.member.id]
      return new ImagingOperator(w, r.member, modality, w.imaging!.sites.scanners[modality], walker, rng)
    },
    post: (w, r) => {
      const st = w.imaging!.sites.scanners[OPERATOR_MODALITY[r.member.id]].station
      return { at: st.at, heading: st.heading }
    },
    atRest: (w, p) => {
      const op = p as ImagingOperator
      return !op.working && op.isAtStation() && w.imaging!.machines[op.modality].session === null
    },
    release: (w, p) => {
      const op = p as ImagingOperator
      const seat = op.sites.station.seat
      if (seat) w.seats.release(seat.id, op.entity.id)
      if (w.imaging!.machines[op.modality].operator === op) w.imaging!.machines[op.modality].setOperator(null)
    },
    attach: (w, p) => {
      w.imaging!.attachOperator(p as ImagingOperator)
    },
  },
  command: {
    make: (_w, r, walker) => {
      const i = r.post!.index
      return new Coordinator(r.member, COMMAND_SEATS[i], walker, `command:desk:${i}`)
    },
    post: (_w, r) => COMMAND_SEATS[r.post!.index],
    atRest: () => true,
    release: (w, p) => {
      const seatId = p.entity.seated?.seatId
      if (seatId) w.seats.release(seatId, p.entity.id)
    },
    attach: (w, p, r) => {
      // the desk the comer sat down at is theirs from now on
      w.seats.claimId(`command:desk:${r.post!.index}`, p.entity.id)
    },
  },
}

export function kitOf(kind: PostKind): Kit {
  return KITS[kind]
}

/** The modality an imaging rota entry runs (undefined for anybody else). */
export function modalityOf(staffId: string): ImagingModality | undefined {
  return OPERATOR_MODALITY[staffId]
}

/** The seat a post is worked from (a command-center desk, a console), or null for a post worked standing. */
export function postSeat(world: World, r: RotaEntry): SeatSpec | null {
  if (r.post!.kind === 'command') return world.seats.byId(`command:desk:${r.post!.index}`)
  if (r.post!.kind === 'imaging') return world.imaging!.sites.scanners[OPERATOR_MODALITY[r.member.id]].station.seat
  return null
}

/** Seconds before the hour of a change a comer leaves the staff-room seat to walk to the post (the longest walk is about 50 s). */
export const LEAVE_SEAT_LEAD = 90
