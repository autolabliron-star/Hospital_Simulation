import { describe, expect, it } from 'vitest'
import { patientInRoom } from '@/content/catalogue'
import { CONFIG } from '@/sim/config'
import { EventLog } from '@/sim/events'
import { LivingDay } from '@/sim/life'
import { ROOMS } from '@/sim/places'
import type { SimEventType } from '@/sim/types'
import { DayStatsTracker, hourText, PLANNED_DISCHARGES, servedOnTime, type DayStatsSource } from './dayStats'

/** A clock hour as sim seconds (t counts from 07:30). */
const at = (hour: number): number => (hour - CONFIG.sim.startHour) * 3600

interface Fixture extends DayStatsSource {
  t: number
  life: LivingDay
  log: EventLog
}

function fixture(startHour: number = CONFIG.sim.startHour): Fixture {
  const life = new LivingDay(
    startHour,
    ROOMS.map((r) => ({ roomId: r.id, patientId: patientInRoom(r.id).id, patientName: patientInRoom(r.id).name })),
  )
  return { t: at(startHour), life, log: new EventLog() }
}

function push(f: Fixture, hour: number, type: SimEventType, refs: { subjectId?: string; roomId?: string } = {}): void {
  f.log.push(at(hour), type, `${type} at ${hour}`, refs)
}

/** The patient has left the bed: the room is empty and waiting for a cleaner. */
function empty(f: Fixture, roomId: string): void {
  const r = f.life.rooms.get(roomId)!
  r.bed = 'needsCleaning'
  r.patientId = null
  r.patientName = null
  r.version++
}

describe('hourText and servedOnTime', () => {
  it('formats clock hours', () => {
    expect(hourText(7.75)).toBe('07:45')
    expect(hourText(22.5)).toBe('22:30')
    expect(hourText(10.25)).toBe('10:15')
  })

  it('a tray is on time inside its meal window and late after it', () => {
    expect(servedOnTime(7.8)).toBe(true) // breakfast 07:45 to 08:30
    expect(servedOnTime(8.5)).toBe(true)
    expect(servedOnTime(8.9)).toBe(false)
    expect(servedOnTime(12.2)).toBe(true) // lunch 12:00 to 12:45
    expect(servedOnTime(13.0)).toBe(false)
    expect(servedOnTime(17.9)).toBe(true) // dinner 17:30 to 18:15
    expect(servedOnTime(18.5)).toBe(false)
  })
})

describe('day stats from sim.life and the day plan', () => {
  it('at the default start every bed is occupied and the whole plan is still to come', () => {
    const d = new DayStatsTracker().read(fixture())
    expect(d).toMatchObject({
      bedsTotal: 16,
      bedsOccupied: 16,
      bedsReady: 0,
      bedsReserved: 0,
      bedsToClean: 0,
      dischargesToday: 0,
      dischargesBeforeNoon: 0,
      admissionsToday: 0,
      boardingCount: 0,
      boardingLongestMin: 0,
      mealsServed: 0,
      mealsOnTime: 0,
      plannedDischarges: PLANNED_DISCHARGES.length,
      plannedToCome: PLANNED_DISCHARGES.length,
    })
    expect(PLANNED_DISCHARGES.length).toBeGreaterThanOrEqual(5)
    expect(d.nextPlannedHour).toBe(Math.min(...PLANNED_DISCHARGES.map((p) => p.atHour)))
  })

  it('counts beds by state', () => {
    const f = fixture()
    const set = (id: string, bed: 'dischargeSigned' | 'leaving' | 'needsCleaning' | 'cleaning' | 'ready' | 'reserved') => {
      f.life.rooms.get(id)!.bed = bed
    }
    set('A1', 'dischargeSigned') // still a patient's bed
    set('A2', 'leaving')
    set('A3', 'needsCleaning')
    set('A4', 'cleaning')
    set('A5', 'ready')
    set('A6', 'ready')
    set('A7', 'reserved')
    const d = new DayStatsTracker().read(f)
    expect(d.bedsOccupied).toBe(16 - 5) // A3..A7 are not taken
    expect(d.bedsReady).toBe(2)
    expect(d.bedsReserved).toBe(1)
    expect(d.bedsToClean).toBe(2)
    expect(d.bedsOccupied + d.bedsReady + d.bedsReserved + d.bedsToClean).toBe(16)
  })

  it('counts discharges and how many were before noon, and the plan shrinks as patients leave', () => {
    const f = fixture()
    const tracker = new DayStatsTracker()
    push(f, 10.4, 'wentHome', { subjectId: 'pt-A1' })
    empty(f, 'A1')
    push(f, 12.6, 'wentHome', { subjectId: 'pt-B4' })
    empty(f, 'B4')
    f.t = at(12.7)
    const d = tracker.read(f)
    expect(d.dischargesToday).toBe(2)
    expect(d.dischargesBeforeNoon).toBe(1)
    expect(d.plannedToCome).toBe(PLANNED_DISCHARGES.length - 2)
  })

  it('counts admissions from the log, once', () => {
    const f = fixture()
    const tracker = new DayStatsTracker()
    push(f, 11, 'admittedToWard', { subjectId: 'er-1', roomId: 'A1' })
    expect(tracker.read(f).admissionsToday).toBe(1)
    expect(tracker.read(f).admissionsToday).toBe(1) // reading twice does not count twice
    push(f, 11.5, 'admittedToWard', { subjectId: 'er-2', roomId: 'A2' })
    expect(tracker.read(f).admissionsToday).toBe(2)
  })

  it('counts meals served and the ones on time, by the meal windows', () => {
    const f = fixture()
    const tracker = new DayStatsTracker()
    push(f, 8.0, 'mealServed') // breakfast, in its window
    push(f, 8.9, 'mealServed') // breakfast, late
    push(f, 12.1, 'mealServed') // lunch, in its window
    const d = tracker.read(f)
    expect(d.mealsServed).toBe(3)
    expect(d.mealsOnTime).toBe(2)
  })

  it('shows ER boarding: how many, and the longest wait in whole minutes', () => {
    const f = fixture()
    const a = f.life.rooms.get('A1')!
    const b = f.life.rooms.get('B2')!
    a.bed = b.bed = 'reserved'
    f.t = at(10)
    a.boarding = { bayId: 'er:bay2', since: f.t - 14.5 * 60 }
    b.boarding = { bayId: 'er:bay4', since: f.t - 3 * 60 }
    const d = new DayStatsTracker().read(f)
    expect(d.boardingCount).toBe(2)
    expect(d.boardingLongestMin).toBe(14)
    delete a.boarding
    delete b.boarding
    expect(new DayStatsTracker().read(f).boardingCount).toBe(0)
  })

  it('does not carry over anything when the hospital is swapped (a Jump)', () => {
    const first = fixture()
    const tracker = new DayStatsTracker()
    push(first, 8, 'mealServed')
    push(first, 10.4, 'wentHome', { subjectId: 'pt-A1' })
    expect(tracker.read(first)).toMatchObject({ mealsServed: 1, dischargesToday: 1 })
    const second = fixture() // a new Simulation: its log starts again from id 1
    push(second, 12.1, 'mealServed')
    expect(tracker.read(second)).toMatchObject({ mealsServed: 1, mealsOnTime: 1, dischargesToday: 0 })
  })

  it('bumps `rev` only when a counter from the log changes', () => {
    const f = fixture()
    const tracker = new DayStatsTracker()
    tracker.read(f)
    const rev = tracker.rev
    tracker.read(f)
    expect(tracker.rev).toBe(rev)
    push(f, 12.1, 'doseWave') // not a counted type
    tracker.read(f)
    expect(tracker.rev).toBe(rev)
    push(f, 12.1, 'mealServed')
    tracker.read(f)
    expect(tracker.rev).toBeGreaterThan(rev)
  })
})

describe('a Jump (warm start) adds back what already happened', () => {
  it('counts the planned discharges whose patients are already gone, once', () => {
    const f = fixture(12)
    const gone = PLANNED_DISCHARGES.filter((p) => p.atHour <= 12)
    expect(gone.length).toBeGreaterThanOrEqual(2)
    for (const p of gone) empty(f, p.roomId)
    const d = new DayStatsTracker().read(f)
    expect(d.dischargesToday).toBe(gone.length)
    expect(d.dischargesBeforeNoon).toBe(gone.length) // all planned at or before 12:00 are before noon or at it
    expect(d.plannedToCome).toBe(PLANNED_DISCHARGES.length - gone.length)

    // the sim then sends one more home during the pre-roll: its event is counted, and the baseline does not count it twice
    const later = PLANNED_DISCHARGES.find((p) => p.atHour > 12)!
    push(f, 12.5, 'wentHome', { subjectId: later.id })
    empty(f, later.roomId)
    expect(new DayStatsTracker().read(f).dischargesToday).toBe(gone.length + 1)
  })

  it('a planned patient still in bed at the Jump is not counted as gone', () => {
    const f = fixture(10.5)
    const first = PLANNED_DISCHARGES.find((p) => p.atHour <= 10.5)!
    f.life.rooms.get(first.roomId)!.bed = 'leaving' // the warm start left them mid-discharge
    // everybody is still in a bed here, so nobody counts as gone before the Jump
    const d = new DayStatsTracker().read(f)
    expect(d.dischargesToday).toBe(0)
    expect(d.plannedToCome).toBe(PLANNED_DISCHARGES.length)
  })

  it('counts a patient admitted before the Jump, once, even if the log also has the event', () => {
    const f = fixture(18)
    const r = f.life.rooms.get('A3')!
    r.patientId = 'er-77'
    r.patientName = 'Leo Park'
    expect(new DayStatsTracker().read(f).admissionsToday).toBe(1)
    push(f, 18, 'admittedToWard', { subjectId: 'er-77', roomId: 'A3' })
    expect(new DayStatsTracker().read(f).admissionsToday).toBe(1)
  })
})
