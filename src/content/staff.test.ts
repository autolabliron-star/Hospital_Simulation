import { describe, expect, it } from 'vitest'
import { HOSTS, NIGHT_STAFF, STAFF, staffName } from './staff'

const SHIFTS = ['day', 'night', 'office']

describe('shifts', () => {
  it('every member of STAFF has a known shift', () => {
    for (const s of STAFF) expect(SHIFTS, s.id).toContain(s.shift)
  })

  it('every ward nurse works the day shift', () => {
    for (const s of STAFF.filter((m) => m.role === 'nurse' && m.ward)) expect(s.shift, s.id).toBe('day')
  })

  it('ward doctors work office hours', () => {
    for (const s of STAFF.filter((m) => m.role === 'doctor' && m.ward)) expect(s.shift, s.id).toBe('office')
  })
})

describe('night staff', () => {
  it('every night member is on the night shift', () => {
    for (const s of NIGHT_STAFF) expect(s.shift, s.id).toBe('night')
  })

  it('has one night nurse per ward', () => {
    for (const ward of ['A', 'B'] as const) {
      const nurses = NIGHT_STAFF.filter((s) => s.role === 'nurse' && s.ward === ward)
      expect(nurses, ward).toHaveLength(1)
    }
    expect(NIGHT_STAFF.filter((s) => s.role === 'nurse')).toHaveLength(2)
  })

  it('has one on-call doctor for both wards (no ward of their own)', () => {
    const doctors = NIGHT_STAFF.filter((s) => s.role === 'doctor')
    expect(doctors).toHaveLength(1)
    expect(doctors[0].ward).toBeUndefined()
  })

  it('has one night porter and one night cleaner', () => {
    expect(NIGHT_STAFF.filter((s) => s.role === 'porter')).toHaveLength(1)
    expect(NIGHT_STAFF.filter((s) => s.role === 'cleaner')).toHaveLength(1)
  })

  it('has no other roles', () => {
    for (const s of NIGHT_STAFF) expect(['nurse', 'doctor', 'porter', 'cleaner'], s.id).toContain(s.role)
  })
})

describe('ward hosts', () => {
  it('has one host per ward, with the host role', () => {
    expect(HOSTS.map((h) => h.role)).toEqual(['host', 'host'])
    expect(HOSTS.map((h) => h.ward).sort()).toEqual(['A', 'B'])
  })

  it('works the day shift, when meals are served', () => {
    for (const h of HOSTS) expect(h.shift, h.id).toBe('day')
  })
})

describe('the new members stay out of the running simulation', () => {
  it('NIGHT_STAFF and HOSTS are not in STAFF', () => {
    const existing = new Set(STAFF.map((s) => s.id))
    for (const s of [...NIGHT_STAFF, ...HOSTS]) expect(existing.has(s.id), s.id).toBe(false)
  })

  it('every id is unique across the three arrays', () => {
    const ids = [...STAFF, ...NIGHT_STAFF, ...HOSTS].map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('staffName resolves the new members, so the event line can name them', () => {
    expect(staffName('host-A')).toBe('Host Ilona')
    expect(staffName('doc-N')).toBe('Dr. Oriel')
    expect(staffName('nurse-N-B')).toBe('Nurse Rhys')
  })
})
