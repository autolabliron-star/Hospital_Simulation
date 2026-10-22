import { describe, expect, it } from 'vitest'
import dietJson from './diet.json'
import { DIET, DietSchema, isNilByMouth } from './diet'
import { AMBULANCE_REASONS, ER_REASONS } from './roster'

describe('diet.json (F-29)', () => {
  it('parses, and every nil-by-mouth reason is a real ER or ambulance reason', () => {
    expect(DietSchema.safeParse(dietJson).success).toBe(true)
    const known = new Set([...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text))
    for (const r of DIET.nilByMouth.reasons) expect(known.has(r), r).toBe(true)
  })

  it('keeps a stroke work-up, a drowsy or confused patient and a vomiting patient nil by mouth, and not a sprain or a rash', () => {
    for (const r of ['Sudden weakness down one side', 'Confused and very drowsy today', 'Severe abdominal pain, vomiting', 'Dizzy and vomiting since morning']) {
      expect(isNilByMouth(r), r).toBe(true)
    }
    for (const r of ['Twisted ankle playing football', 'Rash and itchy eyes', 'Chest pain spreading to arm', 'not a reason']) expect(isNilByMouth(r), r).toBe(false)
  })

  it('has a short bedside sign and one plain line for the patient', () => {
    expect(DIET.nilByMouth.sign).toBe('Nil by mouth')
    expect(DIET.nilByMouth.bark).not.toMatch(/[\r\n!]/)
    expect(DietSchema.safeParse({ nilByMouth: { ...DIET.nilByMouth, reasons: ['x', 'x'] } }).success).toBe(false)
  })
})
