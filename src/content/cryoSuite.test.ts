import { describe, expect, it } from 'vitest'
import { CRYO_STEPS } from '@/sim/types'
import cryoJson from './cryoSuite.json'
import { CRYO_EVENT_FIELDS, CRYO_EVENT_KEYS, CRYO_EVENT_TYPE, CRYO_SUITE_COPY, CryoSuiteCopySchema, cryoLine, fillCryo } from './cryoSuite'

const clone = () => JSON.parse(JSON.stringify(cryoJson)) as Record<string, Record<string, string>>

describe('the cryoablation suite copy', () => {
  it('has a label for every step, the five event lines, the devices card and the panel words', () => {
    expect(Object.keys(CRYO_SUITE_COPY.steps).sort()).toEqual([...CRYO_STEPS].sort())
    expect(Object.keys(CRYO_SUITE_COPY.events).sort()).toEqual([...CRYO_EVENT_KEYS].sort())
    expect(Object.values(CRYO_EVENT_TYPE).every((t) => t.startsWith('cryo'))).toBe(true)
    expect(CRYO_SUITE_COPY.panel.tag).toBe('Simulated')
    expect(CRYO_SUITE_COPY.card.honesty.startsWith('Simulated')).toBe(true)
    expect(Object.keys(CRYO_SUITE_COPY.robotPhases).sort()).toEqual(['aiming', 'aligned', 'deploying', 'retracting', 'stowed'])
    expect(CRYO_SUITE_COPY.listStates).toEqual({ booked: 'Booked', pacu: 'In recovery', done: 'Done' })
    expect([CRYO_SUITE_COPY.panel.argon, CRYO_SUITE_COPY.panel.heater, CRYO_SUITE_COPY.panel.aiming]).toEqual(['Argon', 'Heater', 'Aiming…'])
  })

  it('names real products only on the devices card, and never claims a body position', () => {
    const brands = /MAXIO|Epione|Perfint|Quantum Surgical|Visual-ICE|Boston Scientific/
    const { card, ...rest } = CRYO_SUITE_COPY
    expect(JSON.stringify(rest)).not.toMatch(brands)
    expect(card.robot).toMatch(/MAXIO/)
    expect(card.console).toMatch(/Visual-ICE/)
    expect(JSON.stringify(CRYO_SUITE_COPY)).not.toMatch(/\b(prone|supine)\b/i)
  })

  it('fills the event lines (every field required) and leaves an unknown placeholder visible', () => {
    expect(cryoLine('needle', { k: 2, n: 3, err: '1.2' })).toContain('2 of 3')
    expect(cryoLine('planned', { ir: 'Dr. X', n: 4, patient: 'Ana Costa' })).toMatch(/Dr\. X.*4.*Ana Costa/)
    for (const key of CRYO_EVENT_KEYS) {
      const vars = Object.fromEntries(CRYO_EVENT_FIELDS[key].map((f) => [f, 'v'])) as never
      expect(cryoLine(key, vars)).not.toMatch(/[{}]/)
    }
    expect(fillCryo('Needle {k} of {n}', { k: 1 })).toBe('Needle 1 of {n}')
    expect(fillCryo(CRYO_SUITE_COPY.panel.aligned, { err: '0.9' })).toContain('0.9')
    expect(fillCryo('{constructor}', {})).toBe('{constructor}')
  })

  it('rejects bad copy: a missing step, a wrong placeholder, a missing one, a graphic word, a body position, an extra field', () => {
    const bad = (edit: (c: ReturnType<typeof clone>) => void) => {
      const c = clone()
      edit(c)
      return CryoSuiteCopySchema.safeParse(c).success
    }
    expect(bad(() => {})).toBe(true)
    expect(bad((c) => delete c.steps.freeze1)).toBe(false)
    expect(bad((c) => (c.events.needle = 'Needle {k} of {n} in, {mm} mm.'))).toBe(false)
    expect(bad((c) => (c.events.planned = '{ir} plans the paths for {patient}.'))).toBe(false)
    expect(bad((c) => (c.events.done = '{patient}: the wounds are dressed.'))).toBe(false)
    expect(bad((c) => (c.steps.sedation = 'Lying prone'))).toBe(false)
    expect(bad((c) => (c.panel.extra = 'x'))).toBe(false)
    expect(bad((c) => (c.panel.tag = 'Live'))).toBe(false)
    expect(bad((c) => delete c.robotPhases.aiming)).toBe(false)
    expect(bad((c) => delete c.listStates.pacu)).toBe(false)
  })
})
