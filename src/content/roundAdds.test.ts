import { describe, expect, it } from 'vitest'
import { MEDICINES } from './catalogue'
import { ROUND_ADDS, RoundAddsSchema } from './roundAdds'
import roundAddsJson from './roundAdds.json'

/** Medicines a ward round must never start by itself (F-22). */
const NEVER = ['apixaban', 'levothyroxine', 'metformin', 'bisoprolol', 'amlodipine', 'atorvastatin', 'furosemide', 'amoxicillin', 'salbutamol']

describe('roundAdds.json (F-22)', () => {
  it('parses and names real medicines', () => {
    expect(RoundAddsSchema.safeParse(roundAddsJson).success).toBe(true)
    const ids = new Set(MEDICINES.map((m) => m.id))
    for (const id of ROUND_ADDS) expect(ids.has(id), id).toBe(true)
  })

  it('holds only the safe symptomatic list', () => {
    for (const id of ROUND_ADDS) expect(NEVER, id).not.toContain(id)
    expect([...ROUND_ADDS].sort()).toEqual(['lactulose', 'macrogol', 'omeprazole', 'ondansetron', 'paracetamol', 'senna'])
  })

  it('rejects a repeated medicine and a short list', () => {
    expect(RoundAddsSchema.safeParse({ safe: ['paracetamol', 'paracetamol', 'senna'] }).success).toBe(false)
    expect(RoundAddsSchema.safeParse({ safe: ['paracetamol'] }).success).toBe(false)
  })
})
