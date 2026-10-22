/**
 * The ER and ambulance reasons and the tests each one gets (content/imaging.json `erTests`, Wave 1): a bundle per complaint with a chance.
 * Red flags always get theirs; minor complaints mostly none.
 */
import { describe, expect, it } from 'vitest'
import { type ErTest, ErTestSchema, hasTests, PROTOCOLS, protocolById, testForReason } from './imaging'
import imagingJson from './imaging.json'
import { LAB_CATALOGUE } from './lab'
import peopleJson from './people.json'
import { AMBULANCE_REASONS, ER_REASONS } from './roster'

const B = (o: Partial<ErTest>): ErTest => ({ chance: 1, redFlag: false, bloods: null, ecg: false, imaging: null, ...o })

/** The brief's clinical rules: the red flags and what each one always gets. */
const RED_FLAGS: Array<[reason: string, expected: Partial<ErTest>]> = [
  ['Chest pain spreading to arm', { ecg: true, imaging: 'xr-chest', bloods: 'er-chest' }],
  ['Chest pain at rest, sweating', { ecg: true, imaging: 'xr-chest', bloods: 'er-chest' }],
  ['Sudden weakness down one side', { imaging: 'ct-head' }],
  ['Collapsed, not fully conscious', { imaging: 'ct-head' }],
  ['Collapsed at home, slow to respond', { imaging: 'ct-head' }],
  ['Severe headache, feels unwell', { imaging: 'ct-head' }],
  ['Confused after a fall', { imaging: 'ct-head' }],
  ['Fit that has now stopped', { imaging: 'ct-head' }],
  ['Severe abdominal pain, vomiting', { imaging: 'ct-abdo' }],
  ['Severe difficulty breathing', { imaging: 'xr-chest' }],
  ['Breathless and struggling to speak', { imaging: 'xr-chest' }],
]

describe('ER and ambulance reasons map to tests', () => {
  const reasons = [...ER_REASONS, ...AMBULANCE_REASONS].map((r) => r.text)

  it('every reason in people.json has a mapping, and the mapping has nothing else', () => {
    for (const text of reasons) expect(() => testForReason(text), text).not.toThrow()
    const fromPeople = [...peopleJson.erReasons, ...peopleJson.ambulanceReasons].map((r) => r.text)
    expect(Object.keys(imagingJson.erTests).sort()).toEqual([...fromPeople].sort())
  })

  it('every mapping parses against ErTestSchema', () => {
    for (const [text, test] of Object.entries(imagingJson.erTests)) expect(ErTestSchema.safeParse(test).success, text).toBe(true)
  })

  it('no MRI; every protocol and every lab panel exists', () => {
    for (const text of reasons) {
      const t = testForReason(text)
      if (t.imaging !== null) {
        expect(PROTOCOLS[t.imaging], text).toBeDefined()
        expect(protocolById(t.imaging).modality, text).not.toBe('mri')
      }
      if (t.bloods !== null) expect(LAB_CATALOGUE.panels[t.bloods], text).toBeDefined()
    }
  })

  it('throws on a reason that is not in people.json', () => {
    expect(() => testForReason('Not a reason in the data')).toThrow(/No imaging test is mapped/)
  })

  it.each(RED_FLAGS)('red flag "%s" always gets its bundle', (reason, expected) => {
    const t = testForReason(reason)
    expect(t.chance).toBe(1)
    expect(t.redFlag).toBe(true)
    expect(t).toMatchObject(expected)
    expect(hasTests(t)).toBe(true)
  })

  it('every priority 1 and 2 complaint always gets tests', () => {
    for (const r of [...ER_REASONS, ...AMBULANCE_REASONS].filter((x) => x.acuity <= 2)) {
      const t = testForReason(r.text)
      expect(t.chance, r.text).toBe(1)
      expect(hasTests(t), r.text).toBe(true)
    }
  })

  it('minor complaints (priority 4-5) mostly get none', () => {
    const minor = [...ER_REASONS, ...AMBULANCE_REASONS].filter((x) => x.acuity >= 4)
    const none = minor.filter((r) => !hasTests(testForReason(r.text)))
    expect(none.length / minor.length).toBeGreaterThan(0.5)
    for (const r of minor) expect(testForReason(r.text).chance, r.text).toBeLessThan(1)
  })

  it('asthma is treated, not X-rayed; a cut finger and a rash get nothing', () => {
    for (const r of ['Asthma getting worse, wheezing', 'Cut finger needing stitches', 'Rash and itchy eyes']) expect(testForReason(r)).toEqual(B({ chance: 0 }))
  })
})
