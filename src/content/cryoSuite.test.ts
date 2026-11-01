import { describe, expect, it } from 'vitest'
import { CRYO_STEPS } from '@/sim/types'
import cryoJson from './cryoSuite.json'
import { CRYO_EVENT_FIELDS, CRYO_EVENT_KEYS, CRYO_EVENT_TYPE, CRYO_LUNG_STEPS, CRYO_SUITE_COPY, CryoSuiteCopySchema, cryoLine, cryoStepLabel, fillCryo } from './cryoSuite'

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

  it('R5 wave 3: has the lung\'s and the liver\'s own planned and done lines, the checklist pauses and a word for each target', () => {
    expect(Object.keys(CRYO_SUITE_COPY.targetEvents).sort()).toEqual(['liver', 'lung'])
    expect(Object.keys(CRYO_SUITE_COPY.checklist).sort()).toEqual(['signIn', 'signOut', 'timeOut'])
    expect(CRYO_SUITE_COPY.targets).toEqual({ kidney: 'Kidney', lung: 'Lung', liver: 'Liver' })
    // the freeze line counts its own freezes; the planned and done lines are the target's
    expect(cryoLine('freeze', { k: 2, n: 3, patient: 'Ana' })).toContain('Freeze 2 of 3')
    expect(cryoLine('planned', { ir: 'Dr. X', n: 2, patient: 'Ana Costa' }, 'lung')).toMatch(/lung tumour/)
    expect(cryoLine('planned', { ir: 'Dr. X', n: 2, patient: 'Ana Costa' }, 'liver')).toMatch(/liver tumour/)
    expect(cryoLine('planned', { ir: 'Dr. X', n: 2, patient: 'Ana Costa' })).toBe(cryoLine('planned', { ir: 'Dr. X', n: 2, patient: 'Ana Costa' }, 'kidney'))
    expect(cryoLine('done', { patient: 'Ana' }, 'lung')).toMatch(/lung/)
    expect(cryoLine('needle', { k: 1, n: 2, err: '1.0' }, 'lung')).toBe(cryoLine('needle', { k: 1, n: 2, err: '1.0' }))
    for (const t of ['lung', 'liver'] as const) for (const k of ['planned', 'done'] as const) expect(cryoLine(k, { ir: 'a', n: 1, patient: 'b' } as never, t)).not.toMatch(/[{}]/)
  })

  it('R5 wave 3 review: the honesty line separates the guide\'s 1-2 mm from the needle tip\'s larger error, and a refused start says why', () => {
    const h = CRYO_SUITE_COPY.card.honesty
    // the makers' 1-2 mm is the guide aligned; the tip can be several millimetres off (6 mm in one robot-guided lung series) and is checked on CT
    expect(h).toMatch(/guide to about 1-2 mm/)
    expect(h).toMatch(/several millimetres/)
    expect(h).toMatch(/checked on CT/)
    expect(h).not.toMatch(/1-2 mm at the tip/)
    expect(h).not.toMatch(/accurate/)
    // the needle's event line says the guide was aligned, not the needle placed
    expect(cryoLine('needle', { k: 1, n: 3, err: '1.2' })).toMatch(/guide, which was aligned to within 1\.2 mm/)
    // the panel tells the team being out of hours (noTeam) from a day too late for a whole case (tooLate)
    expect(CRYO_SUITE_COPY.panel.noTeam).toMatch(/on site from 08:00 to 17:30/)
    expect(CRYO_SUITE_COPY.panel.tooLate).toMatch(/Too late to start a whole case today/)
    expect(CRYO_SUITE_COPY.panel.tooLate).not.toBe(CRYO_SUITE_COPY.panel.noTeam)
  })

  it('R5 wave 3 review: the lung counts its freezes 1 to 3 (and its first two thaws) the way its captions do; every other case labels the common way', () => {
    expect(CRYO_LUNG_STEPS).toEqual(['anchorFreeze', 'anchorThaw', 'freeze1', 'thaw', 'freeze2'])
    expect(CRYO_LUNG_STEPS.map((k) => cryoStepLabel(k, 'lung'))).toEqual(['Freeze 1 of 3 (short)', 'Thaw 1 of 3', 'Freeze 2 of 3', 'Thaw 2 of 3', 'Freeze 3 of 3'])
    for (const k of CRYO_LUNG_STEPS) {
      expect(cryoStepLabel(k, 'kidney')).toBe(CRYO_SUITE_COPY.steps[k])
      expect(cryoStepLabel(k, 'liver')).toBe(CRYO_SUITE_COPY.steps[k])
      expect(cryoStepLabel(k)).toBe(CRYO_SUITE_COPY.steps[k])
    }
    expect(cryoStepLabel('aim', 'lung')).toBe(CRYO_SUITE_COPY.steps.aim)
    expect(cryoStepLabel('activeThaw', 'lung')).toBe(CRYO_SUITE_COPY.steps.activeThaw)
    // (the labels are the schema's: a missing or extra one is refused)
    const bad = (edit: (c: Record<string, Record<string, Record<string, string>>>) => void) => {
      const c = JSON.parse(JSON.stringify(cryoJson)) as Record<string, Record<string, Record<string, string>>>
      edit(c)
      return CryoSuiteCopySchema.safeParse(c).success
    }
    expect(bad(() => {})).toBe(true)
    expect(bad((c) => delete c.targetSteps.lung.freeze1)).toBe(false)
    expect(bad((c) => (c.targetSteps.lung.extra = 'x'))).toBe(false)
    expect(bad((c) => (c.targetSteps.lung.thaw = 'Thaw {k}'))).toBe(false)
    expect(bad((c) => delete (c as Record<string, unknown>).targetSteps)).toBe(false)
    expect(bad((c) => delete (c.panel as Record<string, unknown>).tooLate)).toBe(false)
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
    // (R5 wave 3)
    expect(bad((c) => delete (c.targetEvents as never as Record<string, unknown>).lung)).toBe(false)
    expect(bad((c) => (c.targetEvents as never as Record<string, Record<string, string>>).lung.planned = 'Plans {n} paths for {patient}.')).toBe(false)
    expect(bad((c) => (c.targetEvents as never as Record<string, Record<string, string>>).liver.done = '{patient}: the wounds are dressed.')).toBe(false)
    expect(bad((c) => (c.checklist.signIn = 'Sign-in: lying prone.'))).toBe(false)
    expect(bad((c) => delete c.checklist.timeOut)).toBe(false)
    expect(bad((c) => (c.events.freeze = 'Freeze {k} begins for {patient}.'))).toBe(false)
  })

  it('R5 wave 3: has the anaesthesia monitor\'s words (the labels it does not borrow from monitors.json and the ventilator\'s three states), plain and without a body position', () => {
    expect(Object.keys(CRYO_SUITE_COPY.monitor).sort()).toEqual(['paused', 'paw', 'pawUnit', 'running', 'spontaneous', 'title'])
    expect(CRYO_SUITE_COPY.monitor.paused).toBe('Ventilator paused')
    expect(CRYO_SUITE_COPY.monitor.running).toBe('Ventilator running')
    expect(Object.values(CRYO_SUITE_COPY.monitor).join(' ')).not.toMatch(/\b(prone|supine|blood)\b/i)
    const bad = (edit: (m: Record<string, string>) => void) => {
      const c = clone() as Record<string, Record<string, string>>
      edit(c.monitor)
      return CryoSuiteCopySchema.safeParse(c).success
    }
    expect(bad(() => {})).toBe(true)
    expect(bad((m) => delete m.paused)).toBe(false)
    expect(bad((m) => (m.extra = 'x'))).toBe(false)
    expect(bad((m) => (m.running = 'Ventilator {k}'))).toBe(false)
    expect(bad((m) => (m.paused = 'Ventilator paused, patient prone'))).toBe(false)
  })
})
