import { describe, expect, it } from 'vitest'
import type { CasePhase, RobotPhase } from '@/sim/types'
import raw from './surgery.json'
import { ROBOT_PHASE_KEYS, SURGERY_COPY, SURGERY_EVENT_FIELDS, SURGERY_EVENT_TYPES, SURGERY_PROCEDURE_IDS, SurgeryCopySchema, THEATRE_PHASE_KEYS, surgeryLine, type SurgeryEventType } from './surgery'

/** Every case phase of the contract (types.ts CasePhase), in order. The compile-time check below fails if one is missing here. */
const CASE_PHASES = ['scheduled', 'arrived', 'preOp', 'toTheatre', 'in', 'induction', 'positioning', 'ports', 'docking', 'console', 'undocking', 'closing', 'emergence', 'out', 'pacu', 'phase2', 'leaving', 'done'] as const satisfies readonly CasePhase[]
/** The two states the theatre shows between cases (TheatreState.phase). */
const THEATRE_ONLY = ['idle', 'turnover'] as const
/** Every robot phase of the contract (types.ts RobotPhase). */
const ROBOT_PHASES = ['stowed', 'draping', 'draped', 'deploying', 'driving', 'docking', 'targeting', 'docked', 'undocking', 'returning', 'cleaning'] as const satisfies readonly RobotPhase[]
/** The R2 event types (types.ts SimEventType). */
const R2_EVENTS = ['surgeryArrived', 'preOpReady', 'theatreIn', 'robotDocked', 'consoleStart', 'instrumentExchange', 'robotUndocked', 'theatreOut', 'pacuOut', 'turnoverDone'] as const

type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
// Compile-time: the arrays above name every member of the unions (a missing one makes the `true` below fail to typecheck).
const phasesComplete: Missing<CasePhase, (typeof CASE_PHASES)[number]> extends never ? true : false = true
const robotComplete: Missing<RobotPhase, (typeof ROBOT_PHASES)[number]> extends never ? true : false = true
const eventsComplete: Missing<SurgeryEventType, (typeof R2_EVENTS)[number]> extends never ? true : false = true

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
const sorted = (xs: readonly string[]): string[] => [...xs].sort()

/** Every string of the copy, with its dotted path. */
function strings(o: unknown, path = ''): [string, string][] {
  if (typeof o === 'string') return [[path, o]]
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}

describe('surgery.json', () => {
  it('parses against its schema, and rejects a missing key, an extra key and a wrong placeholder', () => {
    expect(SurgeryCopySchema.safeParse(raw).success).toBe(true)
    const noPhase = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    delete noPhase.phases.docking
    expect(SurgeryCopySchema.safeParse(noPhase).success).toBe(false)
    const noRobotPhase = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    delete noRobotPhase.robotPhases.targeting
    expect(SurgeryCopySchema.safeParse(noRobotPhase).success).toBe(false)
    const extra = structuredClone(raw) as unknown as Record<string, Record<string, unknown>>
    extra.outcomes.transfer = 'Elsewhere'
    expect(SurgeryCopySchema.safeParse(extra).success).toBe(false)
    const wrongField = structuredClone(raw) as unknown as Record<string, Record<string, string>>
    wrongField.events.robotDocked = 'The da Vinci 5 (simulated) is docked for {patient} ({procedure}). Docking took {minutes} min. {room}'
    expect(SurgeryCopySchema.safeParse(wrongField).success).toBe(false)
    const missingField = structuredClone(raw) as unknown as Record<string, Record<string, string>>
    missingField.events.turnoverDone = 'The robotic theatre is clean and ready.'
    expect(SurgeryCopySchema.safeParse(missingField).success).toBe(false)
  })

  it('gives every procedure a name, a short name, a port layout, four arms with the endoscope on arm index 1, and 2 to 4 exchanges', () => {
    expect(sorted(Object.keys(SURGERY_COPY.procedures))).toEqual(sorted(['cholecystectomy', 'hysterectomy', 'prostatectomy']))
    expect(SURGERY_PROCEDURE_IDS).toEqual(['cholecystectomy', 'hysterectomy', 'prostatectomy'])
    for (const id of SURGERY_PROCEDURE_IDS) {
      const p = SURGERY_COPY.procedures[id]
      expect(p.name, id).toMatch(/^Robotic \w+ \(.+\)$/)
      expect(p.short.length, id).toBeGreaterThan(0)
      expect(p.instruments, id).toHaveLength(4)
      expect(p.instruments[1], id).toBe('Endoscope 30°')
      expect(p.instruments.filter((n) => n.startsWith('Endoscope')), id).toHaveLength(1)
      expect(new Set(p.instruments).size, id).toBe(4)
      expect(p.exchanges.length, id).toBeGreaterThanOrEqual(2)
      expect(p.exchanges.length, id).toBeLessThanOrEqual(4)
      for (const name of p.exchanges) expect(name.length, id).toBeGreaterThan(0)
    }
  })

  it('uses an oblique port layout for cholecystectomy and transverse for the others', () => {
    expect(SURGERY_COPY.procedures.cholecystectomy.portLayout).toBe('oblique')
    expect(SURGERY_COPY.procedures.hysterectomy.portLayout).toBe('transverse')
    expect(SURGERY_COPY.procedures.prostatectomy.portLayout).toBe('transverse')
  })

  it('has a label for every case phase, plus the theatre idle and turnover states, and each label is a short phrase', () => {
    expect(sorted(Object.keys(SURGERY_COPY.phases))).toEqual(sorted([...CASE_PHASES, ...THEATRE_ONLY]))
    expect(sorted(THEATRE_PHASE_KEYS)).toEqual(sorted([...CASE_PHASES, ...THEATRE_ONLY]))
    expect(SURGERY_COPY.phases.induction).toBe('Anaesthesia induction')
    expect(SURGERY_COPY.phases.docking).toBe('Docking the robot')
    expect(SURGERY_COPY.phases.console).toBe('Console time')
    for (const [path, text] of strings(SURGERY_COPY.phases)) {
      expect(text.length, path).toBeGreaterThan(0)
      expect(text.length, path).toBeLessThanOrEqual(60)
      expect(placeholders(text), path).toEqual([])
    }
  })

  it('has a label for every robot phase', () => {
    expect(sorted(Object.keys(SURGERY_COPY.robotPhases))).toEqual(sorted(ROBOT_PHASES))
    expect(sorted(ROBOT_PHASE_KEYS)).toEqual(sorted(ROBOT_PHASES))
    expect(SURGERY_COPY.robotPhases.driving).toBe('Driving in on the laser crosshair')
    expect(SURGERY_COPY.robotPhases.targeting).toBe('Targeting: arms swinging into place')
  })

  it('has one event line for every R2 event type, each using exactly its listed placeholders and ending in a full stop', () => {
    expect(sorted(Object.keys(SURGERY_COPY.events))).toEqual(sorted(R2_EVENTS))
    expect(sorted(SURGERY_EVENT_TYPES)).toEqual(sorted(R2_EVENTS))
    for (const type of R2_EVENTS) {
      const text = SURGERY_COPY.events[type]
      expect(new Set(placeholders(text)), type).toEqual(new Set(SURGERY_EVENT_FIELDS[type]))
      expect(text, type).toMatch(/\.$/)
      expect(text.length, type).toBeLessThanOrEqual(120)
    }
  })

  it('names the robot only as "da Vinci 5 (simulated)"', () => {
    for (const [path, text] of strings(SURGERY_COPY)) {
      for (const m of text.matchAll(/da Vinci/g)) {
        expect(text.slice(m.index, m.index + 'da Vinci 5 (simulated)'.length), path).toBe('da Vinci 5 (simulated)')
      }
    }
  })

  it('has the two outcomes the contract names', () => {
    expect(SURGERY_COPY.outcomes.home).toBe('Day case: home today')
    expect(SURGERY_COPY.outcomes.ward).toBe('To the surgical ward upstairs')
  })

  it('fills an event line from its typed values, and leaves no brace behind', () => {
    expect(surgeryLine('robotDocked', { patient: 'Ana Costa', procedure: 'Gallbladder', minutes: 8 })).toBe(
      'The da Vinci 5 (simulated) is docked for Ana Costa (Gallbladder). Docking took 8 min.',
    )
    expect(surgeryLine('instrumentExchange', { surgeon: 'Dr. Elena', arm: 2, instrument: 'Clip applier' })).toBe('Dr. Elena changed arm 2 to Clip applier.')
    expect(surgeryLine('turnoverDone', { minutes: 42 })).toBe('The robotic theatre is clean and ready after 42 min.')
    for (const type of R2_EVENTS) {
      const vars = Object.fromEntries(SURGERY_EVENT_FIELDS[type].map((f) => [f, f === 'minutes' || f === 'arm' ? 3 : 'Ana Costa']))
      expect(surgeryLine(type, vars as never), type).not.toMatch(/[{}]/)
    }
  })

  it('rejects a call that leaves out a field of its line (a type error, checked here by the compiler)', () => {
    // @ts-expect-error robotDocked needs {patient}, {procedure} and {minutes}
    const partial = surgeryLine('robotDocked', { patient: 'Ana Costa', procedure: 'Gallbladder' })
    expect(partial).toContain('{minutes}')
  })

  it('keeps the copy non-graphic: no blood, incision, gore or wounds', () => {
    for (const [path, text] of strings(SURGERY_COPY)) expect(text, path).not.toMatch(/\b(blood|incisions?|gore|wounds?|bleed\w*)\b/i)
  })

  it('keeps every line plain: one line, no exclamation mark', () => {
    for (const [path, text] of strings(SURGERY_COPY)) {
      expect(text, path).not.toMatch(/[\r\n]/)
      expect(text, path).not.toMatch(/!/)
    }
  })

  it('the compile-time unions are complete', () => {
    expect([phasesComplete, robotComplete, eventsComplete]).toEqual([true, true, true])
  })
})
