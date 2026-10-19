/**
 * The health kiosks as plain view models (no React, no DOM): the rows of a result (the touchscreen, your health card, the lobby panel's kiosk section and the
 * triage list all show the same fields), the steps of a session and the tiny memory of each kiosk's last result. Everything is read from the sim's
 * `HealthKioskState`s and `VitalsReading`s; nothing here is a clinical decision (a value outside its usual range is only styled, never reported).
 */
import { FIELD_KEYS, KIOSK_UI, fillUi, formatValue, inRange, stepOf, type FieldKey } from '@/content/kioskUi'
import type { HealthKioskPhase, HealthKioskState, VitalsReading } from '@/sim/types'

/** The slice of the sim these models read (a real `Simulation` satisfies it; tests pass plain objects). */
export interface KioskSim {
  vitals: {
    kiosks: readonly HealthKioskState[]
    readingsFor(personId: string): readonly VitalsReading[]
  }
}

export interface FieldRow {
  key: FieldKey
  label: string
  /** "71.4", "124/79", or the pending dash. */
  value: string
  unit: string
  measured: boolean
  /** Styled amber (never worded): the value is outside its usual range. */
  outOfRange: boolean
  /** The step now measuring this field (the screen highlights it). */
  current: boolean
}

/** Which field a phase measures (weight also gives the BMI, the finger clip also gives the pulse). */
export const PHASE_FIELD: Partial<Record<HealthKioskPhase, FieldKey>> = { height: 'height', weight: 'weight', bodyFat: 'bodyFat', spo2: 'spo2', bp: 'bp', temp: 'temp' }

function rowOf(key: FieldKey, value: string, measured: boolean, outOfRange: boolean, current: boolean): FieldRow {
  const f = KIOSK_UI.fields[key]
  return { key, label: f.label, value, unit: f.unit, measured, outOfRange, current }
}

/** The BP shown for a reading: the combined systolic and diastolic once a cuff reading is in, else null. */
export function bpPair(r: VitalsReading | null): [number, number] | null {
  if (!r) return null
  if (r.sys !== null && r.dia !== null) return [r.sys, r.dia]
  return r.bp.length > 0 ? r.bp[r.bp.length - 1] : null
}

/** The eight fields of a reading, in the order the session measures them ("—" until measured). `phase` is the step running now (or null). */
export function fieldRows(r: VitalsReading | null, phase: HealthKioskPhase | null = null): FieldRow[] {
  const now = phase === null ? null : PHASE_FIELD[phase] ?? null
  const bp = bpPair(r)
  const out: FieldRow[] = []
  for (const key of FIELD_KEYS) {
    const current = key === now || (key === 'bmi' && now === 'weight') || (key === 'pulse' && now === 'spo2')
    switch (key) {
      case 'height':
        out.push(rowOf(key, formatValue('height', r?.heightCm), r?.heightCm != null, false, current))
        break
      case 'weight':
        out.push(rowOf(key, formatValue('weight', r?.weightKg), r?.weightKg != null, false, current))
        break
      case 'bmi':
        out.push(rowOf(key, formatValue('bmi', r?.bmi), r?.bmi != null, !inRange('bmi', r?.bmi), current))
        break
      case 'bodyFat':
        out.push(rowOf(key, formatValue('bodyFat', r?.bodyFatPct), r?.bodyFatPct != null, !inRange('bodyFat', r?.bodyFatPct), current))
        break
      case 'spo2':
        out.push(rowOf(key, formatValue('spo2', r?.spo2), r?.spo2 != null, !inRange('spo2', r?.spo2), current))
        break
      case 'pulse':
        out.push(rowOf(key, formatValue('pulse', r?.pulse), r?.pulse != null, !inRange('pulse', r?.pulse), current))
        break
      case 'bp':
        out.push(bp ? rowOf(key, `${bp[0]}/${bp[1]}`, true, !inRange('sys', bp[0]) || !inRange('dia', bp[1]), current) : rowOf(key, KIOSK_UI.pending, false, false, current))
        break
      case 'temp':
        out.push(rowOf(key, formatValue('temp', r?.tempC), r?.tempC != null, !inRange('temp', r?.tempC), current))
        break
    }
  }
  return out
}

/** The steps of a session, in order, for the progress dots (the login and the report are the ends). */
export const SESSION_STEPS: readonly HealthKioskPhase[] = ['login', 'height', 'weight', 'bodyFat', 'sit', 'spo2', 'bp', 'temp', 'report']

export interface StepDot {
  phase: HealthKioskPhase
  state: 'done' | 'current' | 'todo'
}

/** Where `phase` is in the session: the dots. The rest between two cuff readings counts as the blood pressure step. */
export function stepDots(phase: HealthKioskPhase): StepDot[] {
  const at = phase === 'bpRest' ? SESSION_STEPS.indexOf('bp') : SESSION_STEPS.indexOf(phase)
  return SESSION_STEPS.map((p, i) => ({ phase: p, state: at < 0 ? 'todo' : i < at ? 'done' : i === at ? 'current' : 'todo' }))
}

/** The cuff readings of a session as lines ("Reading 1: 128/82"), oldest first. */
export function bpLines(r: VitalsReading | null): string[] {
  if (!r) return []
  return r.bp.map((p, i) => `${fillUi(KIOSK_UI.card.bpRound, { n: i + 1 })}: ${p[0]}/${p[1]}`)
}

// ---------------------------------------------------------------------------------------------
// The touchscreen
// ---------------------------------------------------------------------------------------------

export interface KioskScreenView {
  idle: boolean
  title: string
  hint: string
  /** 0..1 through the step. */
  progress: number
  userName: string | null
  assisted: boolean
  rows: FieldRow[]
  dots: StepDot[]
  footer: string
}

export function kioskScreenView(k: HealthKioskState): KioskScreenView {
  const step = stepOf(k.phase)
  return {
    idle: k.phase === 'idle',
    title: step.title,
    hint: step.hint,
    progress: k.progress,
    userName: k.userName,
    assisted: k.assisted,
    rows: fieldRows(k.reading, k.phase),
    dots: k.phase === 'idle' ? [] : stepDots(k.phase),
    footer: KIOSK_UI.footer,
  }
}

// ---------------------------------------------------------------------------------------------
// The blood-pressure unit's screen
// ---------------------------------------------------------------------------------------------

export interface BpScreenView {
  /** Somebody is on the stool (phase sit .. bpRest). */
  inUse: boolean
  title: string
  /** "Reading 2" during a cuff reading or the rest after it, else null. */
  round: string | null
  /** The last finished cuff reading ([sys, dia]) and the pulse, or "—". */
  sys: string
  dia: string
  pulse: string
  sysOut: boolean
  diaOut: boolean
  /** Cuff pressure 0..1 and whether the cuff is working (inflating or releasing). */
  cuff: number
  measuring: boolean
  unit: string
  footer: string
}

const SEATED_PHASES: ReadonlySet<HealthKioskPhase> = new Set<HealthKioskPhase>(['sit', 'spo2', 'bp', 'bpRest'])

export function bpScreenView(k: HealthKioskState): BpScreenView {
  const ui = KIOSK_UI.bpScreen
  const inUse = SEATED_PHASES.has(k.phase)
  const last = k.reading && k.reading.bp.length > 0 ? k.reading.bp[k.reading.bp.length - 1] : null
  // while the cuff is working the screen shows dashes; the finished reading stays up through the rest and the steps after it
  const measuring = k.phase === 'bp'
  const shown = inUse && !measuring ? last : null
  const pulse = inUse ? k.reading?.pulse ?? null : null
  return {
    inUse,
    title: inUse ? ui.title : ui.free,
    round: k.phase === 'bp' || k.phase === 'bpRest' ? fillUi(ui.reading, { n: Math.max(1, k.bpRound) }) : null,
    sys: shown ? String(shown[0]) : KIOSK_UI.pending,
    dia: shown ? String(shown[1]) : KIOSK_UI.pending,
    pulse: formatValue('pulse', pulse),
    sysOut: shown ? !inRange('sys', shown[0]) : false,
    diaOut: shown ? !inRange('dia', shown[1]) : false,
    cuff: k.phase === 'bp' ? k.cuff : 0,
    measuring,
    unit: ui.unit,
    footer: KIOSK_UI.footer,
  }
}

// ---------------------------------------------------------------------------------------------
// Your health card
// ---------------------------------------------------------------------------------------------

export interface CardView {
  /** 'running' while the session is on, 'done' after a full one, 'stopped' after a partial one. */
  state: 'running' | 'done' | 'stopped'
  kiosk: number
  title: string
  stepTitle: string | null
  hint: string | null
  progress: number
  dots: StepDot[]
  rows: FieldRow[]
  bp: string[]
  /** The line under the slip: "Sent to triage · Simulated", the stopped line, or null while running. */
  sent: string | null
  footer: string
}

/** Your reading when the session is over: the newest 'player' reading of the vitals service, or the memory of the kiosk, or null. */
export function yourLastReading(sim: KioskSim, kiosk: number): VitalsReading | null {
  const list = sim.vitals.readingsFor('player')
  if (list.length > 0) return list[list.length - 1]
  const mem = lastReadings[kiosk]
  return mem && mem.source === 'player' ? mem : null
}

export function readCard(sim: KioskSim, kiosk: number): CardView {
  const k = sim.vitals.kiosks[kiosk]
  const ui = KIOSK_UI.card
  if (k && k.kind === 'player' && k.phase !== 'idle') {
    const step = stepOf(k.phase)
    return {
      state: 'running',
      kiosk,
      title: ui.title,
      stepTitle: fillUi(ui.step, { title: step.title }),
      hint: step.hint,
      progress: k.progress,
      dots: stepDots(k.phase),
      rows: fieldRows(k.reading, k.phase),
      bp: bpLines(k.reading),
      sent: null,
      footer: KIOSK_UI.footer,
    }
  }
  const r = yourLastReading(sim, kiosk)
  return {
    state: r?.partial ? 'stopped' : 'done',
    kiosk,
    title: ui.doneTitle,
    stepTitle: null,
    hint: null,
    progress: 1,
    dots: [],
    rows: fieldRows(r),
    bp: bpLines(r),
    sent: r?.partial ? ui.stopped : ui.sent,
    footer: ui.slipFooter,
  }
}

// ---------------------------------------------------------------------------------------------
// The lobby panel's kiosk section
// ---------------------------------------------------------------------------------------------

export interface KioskSectionRow {
  n: number
  free: boolean
  /** "Free", or "Name · Step". */
  line: string
  assisted: boolean
  /** "Last: BP 124/79 · SpO₂ 98% · 36.6 °C", or "No sessions yet". */
  last: string
  today: string
}

export interface KioskSectionView {
  title: string
  rows: KioskSectionRow[]
  /** "with the guide": added to a row whose user the guide is helping. */
  assistedLabel: string
  disclaimer: string
}

/** One short line of a finished reading: the BP, the SpO2 and the temperature, whichever were measured. */
export function summaryOf(r: VitalsReading): string {
  const ui = KIOSK_UI.section
  const parts: string[] = []
  const bp = bpPair(r)
  if (bp) parts.push(fillUi(ui.bpSummary, { sys: bp[0], dia: bp[1] }))
  if (r.spo2 !== null) parts.push(fillUi(ui.spo2Summary, { spo2: formatValue('spo2', r.spo2) }))
  if (r.tempC !== null) parts.push(fillUi(ui.tempSummary, { temp: formatValue('temp', r.tempC) }))
  return parts.join(' · ')
}

export function readKioskSection(sim: KioskSim): KioskSectionView {
  const ui = KIOSK_UI.section
  const rows: KioskSectionRow[] = sim.vitals.kiosks.map((k) => {
    const free = k.phase === 'idle'
    const last = lastReadings[k.index]
    const summary = last ? summaryOf(last) : ''
    return {
      n: k.index + 1,
      free,
      line: free ? ui.free : fillUi(ui.using, { name: k.userName ?? '', step: stepOf(k.phase).title }),
      assisted: k.assisted && !free,
      last: summary !== '' ? fillUi(ui.last, { summary }) : ui.noLast,
      today: fillUi(ui.today, { n: k.sessionsToday }),
    }
  })
  return { title: ui.title, rows, assistedLabel: ui.assisted, disclaimer: KIOSK_UI.disclaimer }
}

// ---------------------------------------------------------------------------------------------
// The memory of each kiosk's last result
// ---------------------------------------------------------------------------------------------

/** The reading a kiosk's session ended with, by kiosk (null until one has). Written by `trackKiosk`; the panel and the card read it. */
export const lastReadings: (VitalsReading | null)[] = [null, null]
const seen: (VitalsReading | null)[] = [null, null]

/**
 * Remember a session's reading when it ends: call once a frame per kiosk. A kiosk's `reading` is one object that fills in until the session ends, then
 * becomes null: the last object seen is that session's result. Allocates nothing.
 */
export function trackKiosk(k: HealthKioskState): void {
  const prev = seen[k.index]
  if (k.reading === prev) return
  if (prev !== null && k.reading === null) lastReadings[k.index] = prev
  seen[k.index] = k.reading
}

/** Forget everything (a Jump gives a new hospital). */
export function resetKioskMemory(): void {
  for (let i = 0; i < lastReadings.length; i++) {
    lastReadings[i] = null
    seen[i] = null
  }
}

// ---------------------------------------------------------------------------------------------
// The triage desk's results screen: the latest kiosk readings of patients waiting for triage
// ---------------------------------------------------------------------------------------------

/** The slice of the sim the triage list reads: the ER board's cases and the vitals service. */
export interface TriageSim {
  world: { er: { cases: ReadonlyMap<string, { id: string; name: string; state: string; arrivedAt: number }> } }
  vitals: { readingsFor(personId: string): readonly VitalsReading[] }
}

export interface TriageRow {
  id: string
  name: string
  bp: string
  spo2: string
  temp: string
  bpOut: boolean
  spo2Out: boolean
  tempOut: boolean
}

/** The state of a patient who is waiting to be called to a triage bay. */
export const WAITING_TRIAGE = 'waitingTriage'

/** The newest kiosk reading of a person, or null. */
export function latestKioskReading(sim: Pick<TriageSim, 'vitals'>, personId: string): VitalsReading | null {
  const list = sim.vitals.readingsFor(personId)
  for (let i = list.length - 1; i >= 0; i--) if (list[i].source === 'kiosk') return list[i]
  return null
}

/** The patients waiting for triage who have a kiosk reading, longest waiting first: at most `max` rows, and how many there are in all. */
export function triageRows(sim: TriageSim, max = 5): { rows: TriageRow[]; total: number } {
  const waiting: { id: string; name: string; arrivedAt: number; reading: VitalsReading }[] = []
  for (const c of sim.world.er.cases.values()) {
    if (c.state !== WAITING_TRIAGE) continue
    const reading = latestKioskReading(sim, c.id)
    if (reading) waiting.push({ id: c.id, name: c.name, arrivedAt: c.arrivedAt, reading })
  }
  waiting.sort((a, b) => a.arrivedAt - b.arrivedAt || (a.id < b.id ? -1 : 1))
  const rows = waiting.slice(0, max).map((w): TriageRow => {
    const r = w.reading
    const bp = bpPair(r)
    return {
      id: w.id,
      name: w.name,
      bp: bp ? `${bp[0]}/${bp[1]}` : KIOSK_UI.pending,
      spo2: r.spo2 !== null ? `${formatValue('spo2', r.spo2)}%` : KIOSK_UI.pending,
      temp: formatValue('temp', r.tempC),
      bpOut: bp ? !inRange('sys', bp[0]) || !inRange('dia', bp[1]) : false,
      spo2Out: !inRange('spo2', r.spo2),
      tempOut: !inRange('temp', r.tempC),
    }
  })
  return { rows, total: waiting.length }
}

/** A number that changes whenever the triage list would paint differently (who waits and how many readings they have), cheap enough for a 4 Hz check. */
export function triageVersion(sim: TriageSim): number {
  let h = 0x811c9dc5
  for (const c of sim.world.er.cases.values()) {
    if (c.state !== WAITING_TRIAGE) continue
    const list = sim.vitals.readingsFor(c.id)
    if (list.length === 0) continue
    for (let i = 0; i < c.id.length; i++) h = Math.imul(h ^ c.id.charCodeAt(i), 0x01000193)
    h = Math.imul(h ^ list.length, 0x01000193)
    h = Math.imul(h ^ (list[list.length - 1].partial ? 1 : 2), 0x01000193)
  }
  return h >>> 0
}
