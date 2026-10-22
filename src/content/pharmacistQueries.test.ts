import { describe, expect, it } from 'vitest'
import { MEDICINES } from './catalogue'
import { findInteractions, frequencyText, PHARMACIST_QUERIES, PharmacistQueriesSchema, routeText } from './pharmacistQueries'
import queriesJson from './pharmacistQueries.json'

describe('pharmacistQueries.json', () => {
  it('parses, and the loaded copy is the file', () => {
    expect(PharmacistQueriesSchema.parse(queriesJson)).toEqual(PHARMACIST_QUERIES)
  })

  it('rejects an unknown key, a multi-line sentence and a repeated rule id', () => {
    const clone = () => JSON.parse(JSON.stringify(queriesJson)) as typeof queriesJson & Record<string, unknown>
    const extra = clone()
    extra.surprise = 1
    expect(PharmacistQueriesSchema.safeParse(extra).success).toBe(false)
    const multi = clone()
    multi.duplicate.pending = 'one\ntwo'
    expect(PharmacistQueriesSchema.safeParse(multi).success).toBe(false)
    const twice = clone()
    twice.rules = [twice.rules[0], twice.rules[0]]
    expect(PharmacistQueriesSchema.safeParse(twice).success).toBe(false)
  })

  it('has a route for every dose form of the catalogue and a plain frequency for every medicine', () => {
    for (const m of MEDICINES) {
      expect(routeText(m).length).toBeGreaterThan(0)
      expect(frequencyText(m)).not.toMatch(/[{}]/)
    }
  })

  it('writes the frequency from the dose plan', () => {
    expect(frequencyText({ id: 'paracetamol' })).toBe('four times a day (08:00, 12:00, 18:00, 22:00)')
    expect(frequencyText({ id: 'omeprazole' })).toBe('once a day (08:00)')
    expect(frequencyText({ id: 'apixaban' })).toBe('twice a day (08:00, 20:00)')
    expect(frequencyText({ id: 'ondansetron' })).toBe('as needed, at least 8 hours apart')
    expect(routeText({ form: 'inhaler' })).toBe('inhaled')
  })
})

describe('findInteractions', () => {
  const none = new Set<string>()
  it('queries an NSAID on top of apixaban, and apixaban on top of an NSAID', () => {
    const a = findInteractions({ orderMeds: ['ibuprofen'], patientMeds: new Set(['apixaban']), condition: '' })
    expect(a.map((r) => r.id)).toEqual(['nsaid-anticoagulant'])
    expect(a[0].text).toMatch(/^Queried: Ibuprofen and Apixaban/)
    const b = findInteractions({ orderMeds: ['apixaban'], patientMeds: new Set(['ibuprofen']), condition: '' })
    expect(b.map((r) => r.id)).toEqual(['nsaid-anticoagulant'])
  })

  it('reports a pair inside one order once', () => {
    const r = findInteractions({ orderMeds: ['ibuprofen', 'apixaban'], patientMeds: none, condition: '' })
    expect(r.map((x) => x.id)).toEqual(['nsaid-anticoagulant'])
  })

  it('queries an NSAID for heart failure by the words of the stay, not for other reasons', () => {
    expect(findInteractions({ orderMeds: ['ibuprofen'], patientMeds: none, condition: 'Heart failure, fluid check' }).map((r) => r.id)).toEqual(['nsaid-heart-failure'])
    expect(findInteractions({ orderMeds: ['ibuprofen'], patientMeds: none, condition: 'Asthma flare' })).toEqual([])
  })

  it('is quiet for medicines that do not clash and is deterministic', () => {
    const ctx = { orderMeds: ['paracetamol', 'omeprazole'], patientMeds: new Set(['apixaban', 'furosemide']), condition: 'Heart failure' }
    expect(findInteractions(ctx)).toEqual([])
    const again = { orderMeds: ['ibuprofen'], patientMeds: new Set(['apixaban', 'furosemide']), condition: 'Heart failure' }
    expect(findInteractions(again)).toEqual(findInteractions(again))
    expect(findInteractions(again).map((r) => r.id)).toEqual(['nsaid-anticoagulant', 'nsaid-heart-failure', 'nsaid-loop-diuretic'])
  })
})
