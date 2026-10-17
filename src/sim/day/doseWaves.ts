/**
 * Scheduled dose waves (L1): `CONFIG.doseWaves.leadSeconds` before each dose hour (12:00, 18:00, 22:00) the ward doctors'
 * regular medicines go out for every occupied room in one go: one `source: 'schedule'` order per room (the patient's usual
 * medicines), prescribed by that ward's doctor, due at the dose hour. The pods then stream out of the core in a visible wave
 * and the nurses give the doses on the hour, through the same pipeline as every other order (verify, pick, pod, drawer, give).
 *
 * There is never a wave before 11:30: the default 07:30 morning and its medicine story are untouched. A warm start just
 * after a dose hour (a Jump to 12:00 or 18:00) still shows the wave: it goes out at once, due now, if the dose hour is at
 * most `LATE_SECONDS` ago.
 *
 * Which medicines are "usual" depends on who lies in the bed: `occupantMeds` is the seam for the bed-flow builder's
 * admissions (default: the M1 inpatient's `usualMeds`, via the content).
 */
import { patientInRoom } from '@/content/catalogue'
import { STAFF } from '@/content/staff'
import { fillDayTemplate } from '@/content/day'
import { CONFIG } from '../config'
import { clockText } from '../events'
import type { LivingDay } from '../life'
import type { MedSystem } from '../meds/system'
import { ROOMS } from '../places'
import type { Order, OrderItem, RoomId, WardId } from '../types'
import type { World } from '../er/world'
import { timeOfClockHour } from './roster'

/** A warm start this long after a dose hour still sends that wave out (due now). */
export const LATE_SECONDS = 900

export interface DoseDeps {
  world: World
  life: LivingDay
  meds: MedSystem
}

export interface FiredWave {
  hour: number
  /** Sim time the orders were written, and the time they are due. */
  t: number
  doseAt: number
  orders: Order[]
}

const WARDS: readonly WardId[] = ['A', 'B']

/** The ward doctor's staff id ('doc-A', 'doc-B'): the prescriber of a ward's wave. */
function wardDoctor(ward: WardId): string {
  const d = STAFF.find((s) => s.role === 'doctor' && s.ward === ward)
  if (!d) throw new Error(`doseWaves: no doctor for ward ${ward}`)
  return d.id
}

export class DoseWaves {
  /** The waves sent so far, in order. */
  readonly fired: FiredWave[] = []
  /**
   * The medicines of the patient in a room, as catalogue ids; null: no regular medicines, skip the room. Replace it when
   * rooms get new occupants (bed flow); the default is the content's inpatient of that room.
   */
  occupantMeds: (roomId: RoomId) => readonly string[] | null = (roomId) => patientInRoom(roomId).usualMeds
  private next: number

  constructor(
    private readonly deps: DoseDeps,
    t0: number,
  ) {
    const hours = CONFIG.doseWaves.hours
    const i = hours.findIndex((h) => timeOfClockHour(h) + LATE_SECONDS > t0)
    this.next = i < 0 ? hours.length : i
  }

  /** Call every fixed step: sends the next wave when its time has come. */
  step(t: number): void {
    const hours = CONFIG.doseWaves.hours
    if (this.next >= hours.length) return
    const doseT = timeOfClockHour(hours[this.next])
    if (t < doseT - CONFIG.doseWaves.leadSeconds) return
    this.send(hours[this.next], doseT, t)
    this.next++
  }

  /** The sim time the next wave goes out (Infinity when the day's waves are all sent). */
  get nextAt(): number {
    const hours = CONFIG.doseWaves.hours
    return this.next >= hours.length ? Infinity : timeOfClockHour(hours[this.next]) - CONFIG.doseWaves.leadSeconds
  }

  private send(hour: number, doseT: number, t: number): void {
    const { life, meds, world } = this.deps
    const doseAt = Math.max(doseT, t)
    const orders: Order[] = []
    const perWard: Record<WardId, number> = { A: 0, B: 0 }
    for (const room of ROOMS) {
      const status = life.rooms.get(room.id)
      if (!status || (status.bed !== 'occupied' && status.bed !== 'dischargeSigned')) continue
      const usual = this.occupantMeds(room.id)
      if (!usual || usual.length === 0) continue
      const items: OrderItem[] = usual.slice(0, CONFIG.orders.maxItems).map((medId) => ({ medId, qty: 1 }))
      const r = meds.prescribe({ source: 'schedule', doseAt, prescriberId: wardDoctor(room.ward), roomId: room.id, items })
      if (r.ok) {
        orders.push(r.order)
        perWard[room.ward]++
      }
    }
    for (const ward of WARDS) {
      if (perWard[ward] === 0) continue
      world.say('doseWave', fillDayTemplate('doseWave', { time: clockText(doseT), count: perWard[ward] }), { actorId: wardDoctor(ward) })
    }
    this.fired.push({ hour, t, doseAt, orders })
  }
}
