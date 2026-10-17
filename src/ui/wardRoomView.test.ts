import { describe, expect, it } from 'vitest'
import { patientInRoom } from '@/content/catalogue'
import { CONFIG } from '@/sim/config'
import { LivingDay } from '@/sim/life'
import { ROOMS } from '@/sim/places'
import type { Order } from '@/sim/types'
import { PLANNED_DISCHARGES } from './dayStats'
import { bayLabel, mealText, wardLifeView, type WardLifeSource } from './wardRoomView'

const at = (hour: number): number => (hour - CONFIG.sim.startHour) * 3600

function source(hour: number = CONFIG.sim.startHour, orders: Order[] = []): WardLifeSource & { life: LivingDay; t: number } {
  const life = new LivingDay(
    hour,
    ROOMS.map((r) => ({ roomId: r.id, patientId: patientInRoom(r.id).id, patientName: patientInRoom(r.id).name })),
  )
  return { t: at(hour), life, meds: { orders: new Map(orders.map((o) => [o.id, o])) } }
}

const goingHome = PLANNED_DISCHARGES[0]
const staying = ROOMS.map((r) => patientInRoom(r.id)).find((p) => p.stay.kind === 'staying')!

function order(partial: Partial<Order> & { roomId: string; doseAt: number }): Order {
  return { id: 'o1', ward: 'A', patientId: 'x', items: [], prescriberId: 'doc', source: 'sim', createdAt: 0, stage: 'enRoute', stageAt: {}, ...partial }
}

describe('ward room view', () => {
  it('returns nothing for a room the sim does not have', () => {
    expect(wardLifeView(source(), 'Z9')).toBeNull()
  })

  it('shows the synthetic patient, the day of stay and the plan', () => {
    const s = source()
    const rec = patientInRoom(goingHome.roomId)
    const v = wardLifeView(s, goingHome.roomId)!
    expect(v.hasPatient).toBe(true)
    expect(v.headline).toBe(rec.name)
    expect(v.age).toBe(rec.age)
    expect(v.reason).toBe(rec.reason)
    expect(v.stay).toBe(`Day ${rec.dayOfStay} of stay`)
    expect(v.bed).toBe('occupied')
    expect(v.bedLabel).toBe('Occupied')
    expect(v.plan?.discharge).toMatch(/^Going home today, about \d\d:\d\d$/)
    expect(v.plan?.nextDose).toBe('12:00, with the scheduled round')
    expect(v.plan?.meals).toBe('Breakfast at 07:45')
  })

  it('says a patient who stays is staying', () => {
    const v = wardLifeView(source(), staying.roomId)!
    expect(v.plan?.discharge).toBe('Staying on the ward')
  })

  it('shows the discharge as signed or under way once the bed says so', () => {
    const s = source()
    s.life.rooms.get(goingHome.roomId)!.bed = 'dischargeSigned'
    expect(wardLifeView(s, goingHome.roomId)?.plan?.discharge).toMatch(/signed/)
    s.life.rooms.get(goingHome.roomId)!.bed = 'leaving'
    const v = wardLifeView(s, goingHome.roomId)!
    expect(v.hasPatient).toBe(true) // still the patient's bed until they walk out
    expect(v.plan?.discharge).toBe('Going home now')
  })

  it('reads the next dose from the room\'s open orders', () => {
    const roomId = staying.roomId
    const due = order({ roomId, doseAt: at(7.5) - 60 })
    const later = order({ id: 'o2', roomId, doseAt: at(9) })
    const done = order({ id: 'o3', roomId, doseAt: at(7.6), stage: 'given' })
    const cancelled = order({ id: 'o4', roomId, doseAt: at(7.55), cancelledAt: 1 })
    const other = order({ id: 'o5', roomId: 'B8', doseAt: at(7.51) })
    expect(wardLifeView(source(7.5, [later, done, cancelled, other]), roomId)?.plan?.nextDose).toBe('09:00')
    expect(wardLifeView(source(7.5, [later, due]), roomId)?.plan?.nextDose).toBe('07:29, due now')
  })

  it('has no more scheduled doses after the last round of the day', () => {
    expect(wardLifeView(source(22.6), staying.roomId)?.plan?.nextDose).toBe('No more scheduled doses today')
    expect(wardLifeView(source(23.9), staying.roomId)?.plan?.nextDose).toBe('No more scheduled doses today')
  })

  it('names an empty clean bed "Ready for the next patient", and shows no plan', () => {
    const s = source()
    const r = s.life.rooms.get('A5')!
    r.bed = 'ready'
    r.patientId = null
    r.patientName = null
    const v = wardLifeView(s, 'A5')!
    expect(v.hasPatient).toBe(false)
    expect(v.headline).toBe('Ready for the next patient')
    expect(v.bedLabel).toBe('Ready')
    expect(v.plan).toBeNull()
    expect(v.age).toBeNull()
  })

  it('says what is happening in an empty bed that is not ready', () => {
    const s = source()
    for (const [bed, text] of [
      ['needsCleaning', 'Empty: waiting for a cleaner'],
      ['cleaning', 'Empty: being cleaned'],
    ] as const) {
      const r = s.life.rooms.get('A5')!
      r.bed = bed
      r.patientId = null
      r.patientName = null
      expect(wardLifeView(s, 'A5')?.headline).toBe(text)
    }
  })

  it('shows a reserved bed with its named patient, boarding in the ER or on the way', () => {
    const s = source()
    s.t = at(10)
    const r = s.life.rooms.get('A5')!
    r.bed = 'reserved'
    r.patientId = 'er-9'
    r.patientName = 'Leo Park'
    expect(wardLifeView(s, 'A5')).toMatchObject({ hasPatient: false, headline: 'Reserved for Leo Park', notice: 'Leo Park is on the way.' })
    r.boarding = { bayId: 'er:bay2', since: s.t - 12 * 60 }
    expect(wardLifeView(s, 'A5')?.notice).toBe('Leo Park is boarding in ER bay 2 (12 min) until this bed is ready.')
  })

  it('shows an admitted ER patient with their name and no invented history', () => {
    const s = source()
    const r = s.life.rooms.get('A5')!
    r.patientId = 'er-9'
    r.patientName = 'Leo Park'
    const v = wardLifeView(s, 'A5')!
    expect(v.hasPatient).toBe(true)
    expect(v.headline).toBe('Leo Park')
    expect(v.stay).toBe('Admitted from the ER')
    expect(v.age).toBeNull()
    expect(v.reason).toBeNull()
    expect(v.plan?.discharge).toBe('Not planned yet')
  })

  it('has every value as a plain string or number (the 4 Hz poll compares JSON)', () => {
    const v = wardLifeView(source(), 'A1')!
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })
})

describe('meal line', () => {
  it('shows the next meal before its window', () => {
    expect(mealText(7.5, 'none')).toBe('Breakfast at 07:45')
    expect(mealText(10, 'none')).toBe('Lunch at 12:00')
  })

  it('shows how the tray is doing inside the window and just after it', () => {
    expect(mealText(12.1, 'none')).toBe('Lunch: being served')
    expect(mealText(12.3, 'served')).toBe('Lunch: tray served')
    expect(mealText(12.5, 'eaten')).toBe('Lunch: eaten')
    expect(mealText(13.2, 'none')).toBe('Lunch: not served')
  })

  it('says all meals are done after dinner', () => {
    expect(mealText(21, 'none')).toBe('All meals done for today')
  })
})

describe('bay label', () => {
  it('turns a bay id into words', () => {
    expect(bayLabel('er:bay3')).toBe('ER bay 3')
    expect(bayLabel('bay-12')).toBe('ER bay 12')
    expect(bayLabel('trolley')).toBe('trolley')
  })
})
