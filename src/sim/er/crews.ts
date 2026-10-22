/**
 * Wave 1: a pool of paramedic crews. A real ambulance service sends different crews through the day, so each ambulance takes the next crew from
 * a seeded rotation, never the one that has just left. Synthetic people only (names from the content's own first-name lists); the first crew is
 * the one in content/staff.ts.
 */
import { STAFF, type StaffMember } from '@/content/staff'
import type { Rng } from '../rng'

type Paramedic = StaffMember & { role: 'paramedic' }

const para = (id: string, name: string): Paramedic => ({ id, role: 'paramedic', post: 'er', shift: 'day', name: `Paramedic ${name}` })

/** Lead and second paramedic of every crew. */
export const PARAMEDIC_CREWS: readonly (readonly [StaffMember, StaffMember])[] = [
  [STAFF.find((s) => s.id === 'para-1')!, STAFF.find((s) => s.id === 'para-2')!],
  [para('para-3', 'Aiko'), para('para-4', 'Aaron')],
  [para('para-5', 'Abena'), para('para-6', 'Anton')],
  [para('para-7', 'Astrid'), para('para-8', 'Bilal')],
  [para('para-9', 'Amina'), para('para-10', 'Adam')],
]

/** Picks the next crew: random, but never the one that took the previous ambulance. */
export class CrewRotation {
  private last = -1

  constructor(private readonly rng: Rng) {}

  next(): readonly [StaffMember, StaffMember] {
    let i = this.rng.int(0, PARAMEDIC_CREWS.length - 1)
    if (i === this.last) i = (i + 1) % PARAMEDIC_CREWS.length
    this.last = i
    return PARAMEDIC_CREWS[i]
  }
}
