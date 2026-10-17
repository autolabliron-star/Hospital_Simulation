import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { PATIENTS } from './catalogue'
import patientsJson from './patients.json'
import { PatientsSchema } from './schema'

const goingHome = PATIENTS.filter((p) => p.stay.kind === 'goingHome')
const dischargeHours = goingHome.map((p) => (p.stay.kind === 'goingHome' ? p.stay.atHour : NaN))

/** A copy of patients.json with one patient's stay (or other fields) replaced. */
const withPatient = (id: string, change: Record<string, unknown>, base: object[] = patientsJson) =>
  base.map((p) => ('id' in p && p.id === id ? { ...p, ...change } : p))

describe('stay plans parse', () => {
  it('patients.json parses against PatientsSchema', () => {
    expect(PatientsSchema.safeParse(patientsJson).success).toBe(true)
  })

  it('every inpatient has a stay, a way of leaving and a whole-number day of stay from 1', () => {
    for (const p of PATIENTS) {
      expect(['staying', 'goingHome'], p.id).toContain(p.stay.kind)
      expect(['walk', 'wheelchair'], p.id).toContain(p.leavesBy)
      expect(Number.isInteger(p.dayOfStay) && p.dayOfStay >= 1, p.id).toBe(true)
    }
  })
})

describe('discharge plan (CONFIG.beds)', () => {
  it('5 or 6 patients go home today', () => {
    expect(goingHome.length).toBeGreaterThanOrEqual(5)
    expect(goingHome.length).toBeLessThanOrEqual(6)
  })

  it('every discharge falls inside CONFIG.beds.dischargeHours', () => {
    const [from, to] = CONFIG.beds.dischargeHours
    for (const hour of dischargeHours) {
      expect(hour, `discharge at ${hour}`).toBeGreaterThanOrEqual(from)
      expect(hour, `discharge at ${hour}`).toBeLessThanOrEqual(to)
    }
  })

  it('at least CONFIG.beds.beforeNoon discharges happen before 11:00', () => {
    expect(dischargeHours.filter((h) => h < 11).length).toBeGreaterThanOrEqual(CONFIG.beds.beforeNoon)
  })

  it('discharges are spread over at least four different hours', () => {
    expect(new Set(dischargeHours).size).toBeGreaterThanOrEqual(4)
  })

  it('both wards have a discharge', () => {
    const wards = new Set(goingHome.map((p) => p.roomId.charAt(0)))
    expect(wards).toEqual(new Set(['A', 'B']))
  })

  it('discharge times fall on quarter hours', () => {
    for (const hour of dischargeHours) expect(Number.isInteger(hour * 4), `${hour}`).toBe(true)
  })

  it('patients who stay have no discharge time', () => {
    for (const p of PATIENTS.filter((q) => q.stay.kind === 'staying')) expect('atHour' in p.stay, p.id).toBe(false)
  })
})

describe('how patients leave', () => {
  it('every patient aged 80 or over leaves by wheelchair', () => {
    for (const p of PATIENTS.filter((q) => q.age >= 80)) expect(p.leavesBy, p.id).toBe('wheelchair')
  })
})

describe('schema rejects bad plans', () => {
  const firstGoingHome = patientsJson.find((p) => p.stay.kind === 'goingHome')!.id
  const goingHomeIds = patientsJson.filter((p) => p.stay.kind === 'goingHome').map((p) => p.id)

  it('rejects a discharge outside the window', () => {
    expect(PatientsSchema.safeParse(withPatient(firstGoingHome, { stay: { kind: 'goingHome', atHour: 17 } })).success).toBe(false)
  })

  it('rejects a discharge time off the quarter hour', () => {
    expect(PatientsSchema.safeParse(withPatient(firstGoingHome, { stay: { kind: 'goingHome', atHour: 10.1 } })).success).toBe(false)
  })

  it('rejects a plan with fewer than CONFIG.beds.beforeNoon discharges before 11:00', () => {
    let plan: object[] = patientsJson
    for (const id of goingHomeIds.slice(0, 2)) plan = withPatient(id, { stay: { kind: 'goingHome', atHour: 12 } }, plan)
    const result = PatientsSchema.safeParse(plan)
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.message.includes('before 11:00'))).toBe(true)
  })

  it('rejects a plan with nobody going home from ward B', () => {
    let plan: object[] = patientsJson
    for (const id of goingHomeIds) if (id.startsWith('pt-B')) plan = withPatient(id, { stay: { kind: 'staying' } }, plan)
    const result = PatientsSchema.safeParse(plan)
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.message.includes('ward B'))).toBe(true)
  })

  it('rejects a plan with more than six discharges', () => {
    let plan: object[] = patientsJson
    for (const p of patientsJson.filter((q) => q.stay.kind === 'staying').slice(0, 2)) plan = withPatient(p.id, { stay: { kind: 'goingHome', atHour: 13 } }, plan)
    expect(PatientsSchema.safeParse(plan).success).toBe(false)
  })

  it('rejects a day of stay below 1', () => {
    expect(PatientsSchema.safeParse(withPatient(firstGoingHome, { dayOfStay: 0 })).success).toBe(false)
  })

  it('rejects an unknown way of leaving', () => {
    expect(PatientsSchema.safeParse(withPatient(firstGoingHome, { leavesBy: 'stretcher' })).success).toBe(false)
  })
})
