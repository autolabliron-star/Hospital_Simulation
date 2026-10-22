/**
 * The patient record as the tablet shows it: plain strings and numbers, no DOM, so the same view model can later be drawn on a 3D panel in VR.
 * `recordView(data, filter)` turns the sim-side record (src/sim/records/record.ts) into the banner, the alerts, the latest observations with
 * their trends, the current lists, the filtered timeline and the past history. Every word comes from src/content/patientHistory.json (and the
 * medicine plan words from src/content/pharmacistQueries.json). Pure: node tests render it.
 *
 * The NEWS2 badge and the colour of a vital sign are a display style only: nothing in the sim reads them, and they decide nothing.
 */
import { medicineById } from '@/content/catalogue'
import { demoDate, PATIENT_HISTORY, RECORD_UI, uiText } from '@/content/patientHistory'
import { frequencyText, routeText } from '@/content/pharmacistQueries'
import { news2, type ObsSet } from '@/sim/records/obs'
import { ENTRY_KINDS, type EntryFlag, type EntryKind, type PatientRecordData } from '@/sim/records/record'

export type RecordSection = 'summary' | 'stay' | 'history'
export const RECORD_SECTIONS: readonly RecordSection[] = ['summary', 'stay', 'history'] as const
export type RecordFilter = 'all' | EntryKind
export const RECORD_FILTERS: readonly RecordFilter[] = ['all', ...ENTRY_KINDS] as const

export type Tone = 'danger' | 'warn' | 'info' | 'ok'

export interface BannerView {
  name: string
  /** "58 y · Male". */
  ageSex: string
  mrn: string
  mrnLabel: string
  /** "A2 · Ward A", or "ER" for a patient not on a ward. */
  location: string
  /** "Day 3 of stay". */
  stay: string
  /** "Admitted Tue 20 Oct 14:20". */
  admitted: string
  /** "Cardiology · Dr. Levi". */
  team: string
  code: { label: string; value: string; review: boolean }
  isolation: { label: string; value: string; on: boolean }
  /** "82.4 kg · 176 cm". */
  body: string
  bodyLabel: string
  allergy: { on: boolean; title: string; items: string[] }
}

export interface AlertView {
  tone: Tone
  text: string
}

export interface VitalView {
  id: 'rr' | 'spo2' | 'sys' | 'pulse' | 'tempC' | 'acvpu'
  label: string
  value: string
  unit: string
  /** '↑', '↓', '→' or '' (one reading only). */
  trend: string
  /** An SVG polyline in a 60 × 18 box ("0,9 12,4 ..."), or '' with fewer than two readings. */
  spark: string
  tone: Tone
}

export interface ObsView {
  /** "Today 14:00 · Ward observations". */
  when: string
  vitals: VitalView[]
  news2: { text: string; note: string; partial: string | null; tone: Tone }
}

export interface MedView {
  name: string
  strength: string
  plan: string
  next: string
  tone: Tone
  badge: string | null
}

export interface EntryView {
  key: string
  /** "Today", "Yesterday", "Mon 19 Oct": the day heading the entry falls under. */
  day: string
  time: string
  kind: EntryKind
  kindLabel: string
  text: string
  /** The values of an observation entry ("RR 16 · SpO₂ 97% · ..."), or null. */
  detail: string | null
  by: string | null
  flag: EntryFlag
}

export interface FilterView {
  id: RecordFilter
  label: string
  count: number
}

export interface HistoryView {
  allergies: { text: string; detail: string; tone: Tone }[]
  pmh: { name: string; since: string }[]
  psh: { name: string; year: string }[]
  homeMeds: { name: string; detail: string; tone: Tone }[]
  social: { label: string; value: string }[]
  immunisations: { name: string; status: string }[]
}

export interface RecordView {
  /** Set when there is no patient: the panel shows this line and nothing else. */
  empty: string | null
  title: string
  syntheticNote: string
  sections: { id: RecordSection; label: string }[]
  banner: BannerView | null
  alerts: AlertView[]
  obs: ObsView | null
  noObs: string
  problems: string[]
  meds: MedView[]
  pending: string[]
  plan: string[]
  filters: FilterView[]
  filter: RecordFilter
  entries: EntryView[]
  noEntries: string
  history: HistoryView | null
  gap: string | null
  headings: Record<string, string>
  nothing: string
}

const UI = RECORD_UI
const B = UI.banner
const VITALS = UI.vitals as Record<string, string>
const UNITS = UI.units as Record<string, string>
const DAY = 86400
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fill = (t: string, v: Record<string, string | number>): string => t.replace(/\{(\w+)\}/g, (w, k: string) => (k in v ? String(v[k]) : w))

/** "14:05" for an abs time. */
export function timeText(abs: number): string {
  const m = Math.floor((((abs % DAY) + DAY) % DAY) / 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "Tue 20 Oct" for the calendar day of an abs time (day 0 is the demo date). */
export function dateText(abs: number): string {
  const [y, m, d] = demoDate()
  const at = new Date(Date.UTC(y, m - 1, d) + Math.floor(abs / DAY) * DAY * 1000)
  return `${WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
}

/** "Today", "Yesterday" or the date, relative to `now`. */
export function dayText(abs: number, now: number): string {
  const d = Math.floor(abs / DAY) - Math.floor(now / DAY)
  if (d === 0) return uiText('today')
  if (d === -1) return uiText('yesterday')
  return dateText(abs)
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

// --- observations -----------------------------------------------------------------------------

/** The NEWS2 points of each parameter of a set (for the colour of a value only). */
function pointsOf(o: ObsSet, id: VitalView['id']): number {
  const single: ObsSet = { at: o.at, rr: null, spo2: null, o2: null, sys: null, dia: null, pulse: null, acvpu: null, tempC: null, source: o.source }
  if (id === 'acvpu') single.acvpu = o.acvpu
  else if (id === 'spo2') single.spo2 = o.spo2
  else (single as unknown as Record<string, number | null>)[id] = (o as unknown as Record<string, number | null>)[id]
  return news2(single).score
}

const toneOfPoints = (p: number): Tone => (p >= 3 ? 'danger' : p > 0 ? 'warn' : 'ok')

const TREND_STEP: Record<string, number> = { rr: 2, spo2: 1, sys: 8, pulse: 5, tempC: 0.3 }

function series(obs: readonly ObsSet[], id: 'rr' | 'spo2' | 'sys' | 'pulse' | 'tempC'): number[] {
  const out: number[] = []
  for (const o of obs) {
    const v = o[id]
    if (v !== null) out.push(v)
  }
  return out.slice(-12)
}

function sparkOf(values: readonly number[]): string {
  if (values.length < 2) return ''
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const span = hi - lo || 1
  return values.map((v, i) => `${Math.round((i / (values.length - 1)) * 60)},${Math.round(16 - ((v - lo) / span) * 14)}`).join(' ')
}

function trendOf(values: readonly number[], step: number): string {
  if (values.length < 2) return ''
  const last = values[values.length - 1]
  const prev = values.slice(-3, -1)
  const mean = prev.reduce((a, b) => a + b, 0) / prev.length
  return last - mean >= step ? '↑' : mean - last >= step ? '↓' : '→'
}

function obsView(obs: readonly ObsSet[], now: number): ObsView | null {
  const latest = obs[obs.length - 1]
  if (!latest) return null
  const n = news2(latest)
  const vit = (id: 'rr' | 'spo2' | 'sys' | 'pulse' | 'tempC', label: string, unit: string, value: string | null): VitalView => {
    const s = series(obs, id)
    return { id, label, value: value ?? '–', unit: value === null ? '' : unit, trend: value === null ? '' : trendOf(s, TREND_STEP[id]), spark: sparkOf(s), tone: value === null ? 'info' : toneOfPoints(pointsOf(latest, id)) }
  }
  const source = latest.source === 'ward' ? uiText('obsWard') : latest.source === 'triage' ? uiText('triageObs') : uiText('kioskObs')
  return {
    when: `${dayText(latest.at, now)} ${timeText(latest.at)} · ${source}`,
    vitals: [
      vit('rr', VITALS.rr, UNITS.rr, latest.rr === null ? null : String(latest.rr)),
      vit('spo2', VITALS.spo2, latest.o2 ? UNITS.spo2O2 : UNITS.spo2, latest.spo2 === null ? null : String(latest.spo2)),
      vit('sys', VITALS.sys, UNITS.sys, latest.sys === null ? null : `${latest.sys}/${latest.dia ?? '–'}`),
      vit('pulse', VITALS.pulse, UNITS.pulse, latest.pulse === null ? null : String(latest.pulse)),
      vit('tempC', VITALS.tempC, UNITS.tempC, latest.tempC === null ? null : latest.tempC.toFixed(1)),
      {
        id: 'acvpu',
        label: VITALS.acvpu,
        value: latest.acvpu ?? '–',
        unit: '',
        trend: '',
        spark: '',
        tone: latest.acvpu === null ? 'info' : toneOfPoints(pointsOf(latest, 'acvpu')),
      },
    ],
    news2: {
      text: uiText('news2', { score: n.score }),
      note: uiText('news2Note'),
      partial: n.partial ? uiText('news2Partial', { missing: n.missing.join(', ') }) : null,
      tone: n.score >= 7 ? 'danger' : n.score >= 5 ? 'warn' : n.score >= 1 ? 'info' : 'ok',
    },
  }
}

/** One line of an observation set's values, with its NEWS2 (display only). */
export function obsLine(o: ObsSet): string {
  const n = news2(o)
  const dash = '–'
  return uiText('obsLine', {
    rr: o.rr ?? dash,
    spo2: o.spo2 === null ? dash : `${o.spo2}${o.o2 ? UNITS.spo2O2 : UNITS.spo2}`,
    bp: o.sys === null ? dash : `${o.sys}/${o.dia ?? dash}`,
    pulse: o.pulse ?? dash,
    temp: o.tempC === null ? dash : `${o.tempC.toFixed(1)} ${UNITS.tempC}`,
    acvpu: o.acvpu ?? dash,
    news: n.partial ? `${n.score}+` : n.score,
  })
}

// --- the rest -------------------------------------------------------------------------------------

function allergyText(a: PatientRecordData['history']['allergies'][number]): string {
  const type = a.type === 'intolerance' ? ` · ${uiText('intolerance')}` : ''
  return `${uiText('allergyAlert', { agent: a.agent, reaction: a.reaction, severity: a.severity })}${type}`
}

function medView(m: PatientRecordData['meds'][number], now: number): MedView {
  const med = medicineById(m.medId)
  const plan = `${routeText(med)} · ${frequencyText(med)}`
  const when = (at: number) => (Math.floor(at / DAY) > Math.floor(now / DAY) ? `${timeText(at)} (${uiText('tomorrow')})` : timeText(at))
  let next = ''
  let tone: Tone = 'info'
  if (m.next.kind === 'held') {
    next = uiText('held')
    tone = 'warn'
  } else if (m.next.kind === 'due' && m.next.at !== null) {
    next = uiText('dueNow', { time: timeText(m.next.at) })
    tone = 'warn'
  } else if (m.next.kind === 'next' && m.next.at !== null) next = uiText('nextDue', { time: when(m.next.at) })
  else if (m.next.kind === 'prn') next = m.next.at === null ? uiText('prn') : uiText('prnLast', { time: timeText(m.next.at) })
  const badge = m.status === 'oneOff' ? uiText('oneOff') : m.newThisStay ? uiText('newThisStay') : null
  return { name: m.name, strength: m.strength, plan, next, tone, badge }
}

const EMPTY_HEADINGS = { ...UI.headings }

function base(): Omit<RecordView, 'empty' | 'banner' | 'alerts' | 'obs' | 'problems' | 'meds' | 'pending' | 'plan' | 'filters' | 'entries' | 'history' | 'gap'> {
  return {
    title: UI.recordTitle,
    syntheticNote: UI.syntheticNote,
    sections: RECORD_SECTIONS.map((id) => ({ id, label: UI.sections[id] })),
    noObs: uiText('noObs'),
    filter: 'all',
    noEntries: uiText('noEntries'),
    headings: EMPTY_HEADINGS,
    nothing: uiText('nothing'),
  }
}

/** The view of a record (or of an empty bed: `data` null), with the timeline filtered to one kind of entry (or all). */
export function recordView(data: PatientRecordData | null, filter: RecordFilter = 'all'): RecordView {
  if (data === null) {
    return { ...base(), empty: uiText('noPatient'), banner: null, alerts: [], obs: null, problems: [], meds: [], pending: [], plan: [], filters: [], filter, entries: [], history: null, gap: null }
  }
  const { subject: s, history: h, now } = data
  const allergies = h.allergies
  const banner: BannerView = {
    name: s.name,
    ageSex: `${fill(B.years, { age: s.age })} · ${h.sex === 'female' ? B.female : B.male}`,
    mrn: h.mrn,
    mrnLabel: PATIENT_HISTORY.mrn.label,
    location: s.roomId !== null && s.ward !== null ? uiText('locWard', { room: s.roomId, ward: s.ward }) : uiText(s.kind === 'er' ? 'locEr' : s.kind === 'surgery' ? 'locSurgery' : 'locImaging'),
    stay: fill(B.day, { n: s.dayOfStay }),
    admitted: fill(B.admitted, { when: `${dateText(data.wardAt ?? data.arrivedAt)} ${timeText(data.wardAt ?? data.arrivedAt)}` }),
    team: fill(B.team, { team: data.team, doctor: data.doctor }),
    code: { label: B.code, value: h.codeStatus, review: h.codeReview },
    isolation: { label: B.isolation, value: h.isolation ?? PATIENT_HISTORY.isolation.none, on: h.isolation !== null },
    bodyLabel: B.bodyLabel,
    body: [data.weightKg !== null ? fill(B.weight, { kg: data.weightKg.toFixed(1) }) : null, data.heightCm !== null ? fill(B.height, { cm: data.heightCm }) : null].filter(Boolean).join(' · '),
    allergy: {
      on: allergies.length > 0,
      title: allergies.length > 0 ? B.allergies : B.nkda,
      items: allergies.map((a) => `${a.agent} (${a.reaction.toLowerCase()})`),
    },
  }

  const alerts: AlertView[] = []
  for (const a of data.alerts) {
    if (a.kind === 'allergy') {
      const al = allergies[a.index]
      alerts.push({ tone: al.severity === 'severe' || al.type === 'allergy' ? 'danger' : 'warn', text: `${allergyText(al)}${al.review ? ` · ${uiText('review')}` : ''}` })
    } else if (a.kind === 'query') alerts.push({ tone: a.allergy ? 'danger' : 'warn', text: uiText('openQuery', { meds: a.meds }) })
    else if (a.kind === 'falls') alerts.push({ tone: a.level === 'high' ? 'warn' : 'info', text: a.level === 'high' ? PATIENT_HISTORY.falls.high : PATIENT_HISTORY.falls.moderate })
    else if (a.kind === 'anticoagulant') alerts.push({ tone: 'warn', text: uiText('anticoagulated', { med: medicineById(a.medId).name }) })
    else if (a.kind === 'isolation') alerts.push({ tone: 'warn', text: `${B.isolation}: ${a.text}` })
    else alerts.push({ tone: 'info', text: `${B.code}: ${a.text}` })
  }

  const counts = new Map<RecordFilter, number>([['all', data.entries.length]])
  for (const e of data.entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  const filters: FilterView[] = RECORD_FILTERS.map((id) => ({ id, label: UI.filters[id], count: counts.get(id) ?? 0 }))
  const kindLabel = (k: EntryKind) => UI.filters[k]
  const entries: EntryView[] = []
  data.entries.forEach((e, i) => {
    if (filter !== 'all' && e.kind !== filter) return
    entries.push({
      key: `${Math.round(e.at)}-${i}`,
      day: dayText(e.at, now),
      time: timeText(e.at),
      kind: e.kind,
      kindLabel: kindLabel(e.kind),
      text: e.text,
      detail: e.obs ? obsLine(e.obs) : null,
      by: e.by,
      flag: e.flag,
    })
  })

  const history: HistoryView = {
    allergies: allergies.map((a) => ({
      text: `${a.agent}`,
      detail: `${cap(a.reaction)} · ${a.severity}${a.type === 'intolerance' ? ` · ${uiText('intolerance')}` : ''} · ${a.year}${a.review ? ` · ${uiText('review')}` : ''}`,
      tone: a.type === 'allergy' ? 'danger' : 'warn',
    })),
    pmh: h.conditions.map((c) => ({ name: c.name, since: String(c.since) })),
    psh: h.procedures.map((p) => ({ name: p.name, year: String(p.year) })),
    homeMeds: h.homeMeds.map((m) => {
      const med = medicineById(m.medId)
      return { name: `${med.name} ${med.strength}`, detail: `${frequencyText(med)} · ${m.onChart ? uiText('onChart') : uiText('notCharted')}`, tone: m.onChart ? 'ok' : 'warn' }
    }),
    social: [
      { label: uiText('smoking'), value: h.social.smoking },
      { label: uiText('alcohol'), value: h.social.alcohol },
      { label: uiText('living'), value: h.social.living },
      { label: uiText('mobility'), value: h.social.mobility },
    ],
    immunisations: h.immunisations.map((i) => ({ name: i.name, status: i.status })),
  }

  return {
    ...base(),
    empty: null,
    banner,
    alerts,
    obs: obsView(data.obs, now),
    problems: data.problems,
    meds: data.meds.map((m) => medView(m, now)),
    pending: data.pending,
    plan: data.plan,
    filters,
    filter,
    entries,
    history,
    gap: data.gap ? uiText('gap') : null,
  }
}
