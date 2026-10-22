/**
 * F-29: nil by mouth. A patient whose admission profile follows only nil-by-mouth ER reasons (content/diet.json) is served no tray and has no
 * dish on the bedside screen; the sign text is exposed for the bedside. The sim makes no clinical decisions: the list is fixed demo content.
 */
import { describe, expect, it } from 'vitest'
import { ADMISSION_PROFILES } from '@/content/admissions'
import { DIET, isNilByMouth } from '@/content/diet'
import { CONFIG } from '../config'
import { Simulation } from '../Simulation'
import { MEAL_WINDOWS, dietSignFor, isNilByMouthWardReason } from './plan'
import { DT, hourT } from './testkit'

const NBM_PROFILES = ADMISSION_PROFILES.filter((p) => p.reasons.every(isNilByMouth))

describe('nil by mouth: from the ER reason to the ward reason', () => {
  it('a ward reason is nil by mouth exactly when its admission profile follows only nil-by-mouth ER reasons', () => {
    expect(NBM_PROFILES.length).toBeGreaterThanOrEqual(5)
    for (const p of ADMISSION_PROFILES) {
      const nbm = p.reasons.every(isNilByMouth)
      expect(isNilByMouthWardReason(p.wardReason), p.id).toBe(nbm)
      // no profile mixes the two: a ward reason is one diet
      expect(p.reasons.some(isNilByMouth), `${p.id} mixes nil-by-mouth and normal reasons`).toBe(nbm)
    }
    // every nil-by-mouth ER reason is covered by some nil-by-mouth profile
    for (const r of DIET.nilByMouth.reasons) expect(NBM_PROFILES.some((p) => p.reasons.includes(r)), r).toBe(true)
  })

  it('knows nothing of a planned inpatient, an empty bed or no reason, and gives the sign text only for nil by mouth', () => {
    for (const r of ['Heart failure, fluid check', '', 'not a reason']) expect(isNilByMouthWardReason(r)).toBe(false)
    expect(isNilByMouthWardReason(undefined)).toBe(false)
    expect(isNilByMouthWardReason(null)).toBe(false)
    expect(dietSignFor(undefined)).toBeNull()
    expect(dietSignFor('Ear infection, antibiotics')).toBeNull()
    expect(dietSignFor(NBM_PROFILES[0].wardReason)).toBe(DIET.nilByMouth.sign)
    expect(DIET.nilByMouth.sign).toBe('Nil by mouth')
  })
})

describe('nil by mouth: the lunch round', () => {
  it('serves no tray to a nil-by-mouth patient and shows no dish, the sign is exposed, and everybody else is served', () => {
    const sim = new Simulation(2026, { startHour: 12, population: false })
    const lunch = MEAL_WINDOWS.find((w) => w.meal === 'lunch')!
    // the patients in bed at 12:00; two of them are on a nil-by-mouth profile (the admission reason of the stay)
    const inBed = [...sim.life.rooms.values()].filter((r) => r.bed === 'occupied' && r.patientId !== null).map((r) => r.roomId)
    expect(inBed.length).toBeGreaterThanOrEqual(6)
    const [nbmA, nbmB, ...others] = inBed
    const admitAs = (room: string, wardReason: string): void => {
      sim.beds.board.recordOf(room)!.reason = wardReason
      sim.beds.board.syncRoom(sim.beds.board.get(room))
    }
    admitAs(nbmA, NBM_PROFILES[0].wardReason)
    admitAs(nbmB, NBM_PROFILES[1].wardReason)
    sim.step(DT)
    for (const room of [nbmA, nbmB]) {
      expect(sim.meals.nilByMouth(room), room).toBe(true)
      expect(sim.meals.servable(room), room).toBe(false)
      expect(sim.meals.chosenDish('lunch', room), room).toBeNull()
      expect(sim.meals.dietSign(room), room).toBe(DIET.nilByMouth.sign)
    }
    expect(sim.meals.nilByMouth(others[0])).toBe(false)
    expect(sim.meals.dietSign(others[0])).toBeNull()
    expect(sim.meals.chosenDish('lunch', others[0])).not.toBeNull()

    const served = new Set<string>()
    const trayRooms = new Set<string>()
    const total = Math.round((hourT(lunch.end) + 900 - sim.t) / DT)
    for (let i = 0; i < total; i++) {
      sim.step(DT)
      if (i % 30 === 0) for (const r of sim.life.rooms.values()) if (r.meal !== 'none') trayRooms.add(r.roomId)
    }
    for (const e of sim.log.events) if (e.type === 'mealServed' && e.roomId !== undefined) served.add(e.roomId)
    expect(served.has(nbmA), 'no tray for the first nil-by-mouth patient').toBe(false)
    expect(served.has(nbmB), 'no tray for the second nil-by-mouth patient').toBe(false)
    expect(trayRooms.has(nbmA) || trayRooms.has(nbmB), 'no tray ever on their table').toBe(false)
    // the ones who are not nil by mouth were served, as before
    expect(others.filter((r) => served.has(r)).length).toBeGreaterThanOrEqual(Math.floor(others.length / 2))
    expect(CONFIG.meals.windows.lunch).toBeDefined()
  }, 120_000)
})
