/**
 * Zod schemas for the demo content in src/content/*.json. Each mirrors an interface in src/sim/types.ts.
 * The loaders (catalogue.ts, admissions.ts, meals.ts, day.ts) parse the JSON with these at module load, so bad
 * content throws there, with the file and field named. content.test.ts and the other *.test.ts files check the real files too.
 */
import { z } from 'zod'
import { CONFIG } from '@/sim/config'
import { PHARMACY } from '@/sim/places'
import type { MealKind, MedicineForm, SimEventType } from '@/sim/types'

/** Parse a content file, or throw with the file and every failing field named. */
export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown, source: string): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new Error(`${source} is invalid: ${details}`)
  }
  return result.data as z.output<T>
}

const wordCount = (text: string): number => text.trim().split(/\s+/).length
const allUnique = (values: readonly string[]): boolean => new Set(values).size === values.length

/** Words that make a reason or caption graphic. Copy stays plain and non-graphic (the same list as roster.ts). */
const GRAPHIC_WORDS = /\b(blood|bleed\w*|gunshot|stab\w*|severed|amputat\w*|wounds?|gore|gory|mangled|crushed|guts)\b/i

/** Bin slots on the dispensing wall: columns x rows (12 x 6 = 72), so bins run 0..71. */
const BIN_COUNT = PHARMACY.bins.columns * PHARMACY.bins.rows

/**
 * Every MedicineForm, listed as keys of a Record so the compiler rejects a missing or extra form.
 * If a form is added to or removed from types.ts, this file fails to typecheck until it matches.
 */
const FORM_CHECK: Record<MedicineForm, true> = {
  tablet: true,
  capsule: true,
  sachet: true,
  'oral solution': true,
  inhaler: true,
  patch: true,
  drops: true,
}
const MEDICINE_FORMS = Object.keys(FORM_CHECK) as [MedicineForm, ...MedicineForm[]]

export const MedicineFormSchema = z.enum(MEDICINE_FORMS)

export const MedicineSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must be lower-case letters, digits or hyphens'),
  name: z.string().min(1),
  strength: z.string().min(1),
  form: MedicineFormSchema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'color must be a hex value #rrggbb'),
  bin: z
    .number()
    .int()
    .min(0, `bin must be 0..${BIN_COUNT - 1}`)
    .max(BIN_COUNT - 1, `bin must be 0..${BIN_COUNT - 1}`),
})

export const MedicinesSchema = z
  .array(MedicineSchema)
  .min(1)
  .superRefine((medicines, ctx) => {
    const ids = new Set<string>()
    const bins = new Set<number>()
    medicines.forEach((m, i) => {
      if (ids.has(m.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate medicine id "${m.id}"` })
      ids.add(m.id)
      if (bins.has(m.bin)) ctx.addIssue({ code: 'custom', path: [i, 'bin'], message: `duplicate bin ${m.bin}` })
      bins.add(m.bin)
    })
  })

// ---------------------------------------------------------------------------------------------
// How a given name reads (W3 wave B): which realistic body (render only) wears which name
// ---------------------------------------------------------------------------------------------

/** Lower-case, accent-free form of a name ("Tomás" and "Tomas" are the same name). */
const plainName = (name: string): string => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const PresentationName = z
  .string()
  .regex(/^\p{Lu}[\p{L}'-]*$/u, 'a name is one word: a capital letter, then letters, apostrophes or hyphens')

/**
 * The given names the people of the world carry, by how the person is drawn: `female` and `male` pick a woman's or a man's avatar and hair,
 * `either` (a unisex name, or a surname used as a given name) leaves the choice to the seeded draw. A name is in exactly one list. Purely a
 * rendering hint: the simulation has no gender and never reads these lists.
 */
export const PresentationSchema = z
  .strictObject({
    female: z.array(PresentationName).min(1),
    male: z.array(PresentationName).min(1),
    either: z.array(PresentationName).min(1),
  })
  .superRefine((lists, ctx) => {
    const seen = new Map<string, string>()
    for (const key of ['female', 'male', 'either'] as const) {
      lists[key].forEach((name, i) => {
        const plain = plainName(name)
        const before = seen.get(plain)
        if (before !== undefined) ctx.addIssue({ code: 'custom', path: [key, i], message: `"${name}" is already in the ${before} list; a name is in exactly one list` })
        else seen.set(plain, key)
      })
    }
  })
export type Presentation = 'female' | 'male' | 'either'

// ---------------------------------------------------------------------------------------------
// Inpatients and their day plan (L1)
// ---------------------------------------------------------------------------------------------

/** A clock hour on a quarter hour, e.g. 10.25 is 10:15. */
const QuarterHour = z.number().refine((h) => Number.isInteger(h * 4), 'a clock hour on a quarter hour, e.g. 10.25')

/**
 * What a patient does today. `goingHome` leaves at `atHour` (inside CONFIG.beds.dischargeHours); `staying` stays on the ward.
 */
export const StaySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('goingHome'), atHour: QuarterHour }),
  z.strictObject({ kind: z.literal('staying') }),
])
export const LeavesBySchema = z.enum(['walk', 'wheelchair'])
export type PatientStay = z.infer<typeof StaySchema>
export type LeavesBy = z.infer<typeof LeavesBySchema>

export const PatientSchema = z.strictObject({
  id: z.string().regex(/^pt-[A-Za-z0-9-]+$/, 'id must look like pt-A1'),
  name: z.string().min(1),
  age: z.number().int().min(24).max(89),
  roomId: z.string().min(1),
  reason: z.string().min(1),
  usualMeds: z
    .array(z.string().min(1))
    .min(2)
    .max(4)
    .refine((ids) => new Set(ids).size === ids.length, 'usualMeds must not repeat a medicine'),
  /** L1: whether the patient goes home today, and when. */
  stay: StaySchema,
  /** L1: how the patient leaves (a wheelchair with a porter for older or less mobile patients). */
  leavesBy: LeavesBySchema,
  /** L1: the day of stay today, counting the day of admission as day 1. A patient going home says "after {days} days". */
  dayOfStay: z.number().int().min(1),
})

/** The discharge plan: 5 or 6 patients go home today, inside the discharge window, enough of them before 11:00, both wards. */
function checkDischargePlan(patients: readonly z.output<typeof PatientSchema>[], ctx: z.RefinementCtx): void {
  const [from, to] = CONFIG.beds.dischargeHours
  const goingHome = patients.flatMap((p, index) => (p.stay.kind === 'goingHome' ? [{ index, id: p.id, ward: p.roomId.charAt(0), atHour: p.stay.atHour }] : []))
  if (goingHome.length < 5 || goingHome.length > 6) {
    ctx.addIssue({ code: 'custom', path: [], message: `${goingHome.length} patients go home today; the plan needs 5 or 6` })
  }
  for (const g of goingHome) {
    if (g.atHour < from || g.atHour > to) {
      ctx.addIssue({ code: 'custom', path: [g.index, 'stay', 'atHour'], message: `${g.id} goes home at ${g.atHour}, outside the discharge window ${from}..${to}` })
    }
  }
  const beforeEleven = goingHome.filter((g) => g.atHour < 11).length
  if (beforeEleven < CONFIG.beds.beforeNoon) {
    ctx.addIssue({ code: 'custom', path: [], message: `${beforeEleven} discharges before 11:00; the plan needs at least ${CONFIG.beds.beforeNoon}` })
  }
  for (const ward of ['A', 'B']) {
    if (!goingHome.some((g) => g.ward === ward)) {
      ctx.addIssue({ code: 'custom', path: [], message: `nobody goes home from ward ${ward}; both wards need a discharge` })
    }
  }
}

export const PatientsSchema = z
  .array(PatientSchema)
  .min(1)
  .superRefine((patients, ctx) => {
    const ids = new Set<string>()
    const rooms = new Set<string>()
    patients.forEach((p, i) => {
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate patient id "${p.id}"` })
      ids.add(p.id)
      if (rooms.has(p.roomId)) ctx.addIssue({ code: 'custom', path: [i, 'roomId'], message: `two patients in room ${p.roomId}` })
      rooms.add(p.roomId)
    })
    checkDischargePlan(patients, ctx)
  })

// ---------------------------------------------------------------------------------------------
// Admission profiles (L1): the ward record an admitted ER patient gets. Display data only.
// ---------------------------------------------------------------------------------------------

const Age = z.number().int().min(24).max(89)

/** A plain ward reason: 3 to 8 words, no stray spaces, nothing graphic. */
const WardReason = z
  .string()
  .refine((t) => t === t.trim() && wordCount(t) >= 3 && wordCount(t) <= 8, 'a ward reason is 3 to 8 words with no stray spaces')
  .refine((t) => !GRAPHIC_WORDS.test(t), 'ward reasons must be non-graphic')

export const AdmissionProfileSchema = z.strictObject({
  id: z.string().regex(/^adm-[a-z0-9-]+$/, 'id looks like adm-chest-pain'),
  /** The ER or ambulance reasons (as written in people.json) that can lead to this profile. */
  reasons: z
    .array(z.string().min(1))
    .min(1)
    .refine(allUnique, 'a profile must not repeat a reason'),
  wardReason: WardReason,
  /** Youngest and oldest age the profile draws from: [low, high]. */
  ageRange: z.tuple([Age, Age]).refine(([low, high]) => low <= high, 'ageRange is [youngest, oldest]'),
  usualMeds: z
    .array(z.string().min(1))
    .min(2)
    .max(4)
    .refine(allUnique, 'usualMeds must not repeat a medicine'),
})
export type AdmissionProfile = z.infer<typeof AdmissionProfileSchema>

export const AdmissionsSchema = z.strictObject({
  profiles: z
    .array(AdmissionProfileSchema)
    .min(1)
    .superRefine((profiles, ctx) => {
      const ids = new Set<string>()
      profiles.forEach((p, i) => {
        if (ids.has(p.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate profile id "${p.id}"` })
        ids.add(p.id)
      })
    }),
})

// ---------------------------------------------------------------------------------------------
// Meals (L1): a fixed demo menu, three meals of six dishes. No diet logic.
// ---------------------------------------------------------------------------------------------

export const DishSchema = z.strictObject({
  name: z
    .string()
    .refine((t) => t === t.trim() && wordCount(t) >= 1 && wordCount(t) <= 3 && t.length <= 32, 'a dish name is 1 to 3 words, up to 32 characters'),
  description: z
    .string()
    .refine((t) => t === t.trim() && t.length > 0 && t.length <= 90 && !/[\r\n]/.test(t), 'a dish description is one line, up to 90 characters'),
})
export type Dish = z.infer<typeof DishSchema>

const DishesSchema = z
  .array(DishSchema)
  .length(6, 'each meal has exactly 6 dishes')
  .refine((dishes) => allUnique(dishes.map((d) => d.name)), 'dish names must be unique within a meal')

/** One key per MealKind: a missing or extra meal fails to typecheck (the same trick as FORM_CHECK). */
const MEAL_CHECK: Record<MealKind, true> = { breakfast: true, lunch: true, dinner: true }
export const MEAL_KINDS = Object.keys(MEAL_CHECK) as MealKind[]

export const MealsSchema = z.strictObject({
  breakfast: DishesSchema,
  lunch: DishesSchema,
  dinner: DishesSchema,
})

// ---------------------------------------------------------------------------------------------
// The HUD words (L1): the Jump menu, the Beds panel, the room panel and the KPI additions. Plain strings, some with {placeholders}.
// ---------------------------------------------------------------------------------------------

const Words = z.string().min(1)
const BedStateCopySchema = z.strictObject({ label: Words, short: Words, detail: Words })

export const UiSchema = z.strictObject({
  simulated: Words,
  jump: z.strictObject({
    title: Words,
    button: Words,
    buttonTitle: Words,
    closeLabel: Words,
    closeTitle: Words,
    listLabel: Words,
    now: Words,
    nowChip: Words,
    hint: Words,
    overlay: Words,
  }),
  beds: z.strictObject({
    title: Words,
    wardA: Words,
    wardB: Words,
    dischargesToday: Words,
    beforeNoon: Words,
    admissionsToday: Words,
    boarding: Words,
    boardingNone: Words,
    boardingLongest: Words,
    boardingTile: Words,
    onTheWay: Words,
    predicted: Words,
    predictedValue: Words,
    predictedNext: Words,
    inProgress: Words,
    legend: z.strictObject({ occupied: Words, going: Words, clean: Words, ready: Words, reserved: Words }),
  }),
  kpi: z.strictObject({
    bedsHeading: Words,
    bedsOccupiedReady: Words,
    dischargesBeforeNoon: Words,
    erBoarding: Words,
    erBoardingNone: Words,
    erBoardingValue: Words,
    mealsOnTime: Words,
  }),
  room: z.strictObject({
    patient: Words,
    bedState: Words,
    todaysPlan: Words,
    dayOfStay: Words,
    admittedFromEr: Words,
    emptyReady: Words,
    emptyNeedsCleaning: Words,
    emptyCleaning: Words,
    reservedFor: Words,
    onTheWay: Words,
    boardingIn: Words,
    since: Words,
    nextDose: Words,
    nextDoseDue: Words,
    nextDoseAt: Words,
    nextDoseWave: Words,
    noMoreDoses: Words,
    meals: Words,
    mealBeingServed: Words,
    mealNotServed: Words,
    mealServed: Words,
    mealEaten: Words,
    mealNext: Words,
    mealsDone: Words,
    discharge: Words,
    dischargeGoing: Words,
    dischargeSigned: Words,
    dischargeLeaving: Words,
    dischargeStaying: Words,
    dischargeNotPlanned: Words,
    bay: Words,
  }),
  bedStates: z.strictObject({
    occupied: BedStateCopySchema,
    dischargeSigned: BedStateCopySchema,
    leaving: BedStateCopySchema,
    needsCleaning: BedStateCopySchema,
    cleaning: BedStateCopySchema,
    ready: BedStateCopySchema,
    reserved: BedStateCopySchema,
  }),
})

// ---------------------------------------------------------------------------------------------
// The day (L1): moment labels for the Jump menu, and one sentence template per L1 event type.
// ---------------------------------------------------------------------------------------------

/**
 * The L1 event types with a sentence template, and the placeholders each template may use. The sim fills
 * every listed placeholder with `fillDayTemplate` (src/content/day.ts).
 */
export const DAY_EVENT_FIELDS = {
  dischargeSigned: ['doctor', 'patient', 'room'],
  wentHome: ['patient', 'days'],
  roomCleaned: ['room'],
  bedAssigned: ['room', 'patient', 'bay'],
  patientBoarding: ['patient', 'bay', 'room'],
  admittedToWard: ['nurse', 'patient', 'room'],
  huddle: ['hub', 'topic'],
  shiftHandover: ['nurse', 'ward', 'colleague'],
  mealServed: ['host', 'dish', 'room'],
  trayCollected: ['host', 'room'],
  doseWave: ['time', 'count'],
} as const satisfies Record<string, readonly string[]>
export type DayEventType = keyof typeof DAY_EVENT_FIELDS
export const DAY_EVENT_TYPES = Object.keys(DAY_EVENT_FIELDS) as DayEventType[]

/** Compile-time check: every L1 template type is a real SimEventType (typecheck fails if one is missing from types.ts). */
export type DayEventsAreSimEvents = DayEventType extends SimEventType ? true : never
export const DAY_EVENTS_ARE_SIM_EVENTS: DayEventsAreSimEvents = true

/** A `{name}` placeholder in a template. */
export const PLACEHOLDER = /\{([A-Za-z]+)\}/g

const MomentSchema = z.strictObject({
  hour: z.number(),
  label: z
    .string()
    .refine((t) => t === t.trim() && wordCount(t) >= 1 && wordCount(t) <= 6, 'a moment label is 1 to 6 words'),
  caption: z
    .string()
    .refine((t) => t === t.trim() && t.length > 0 && t.length <= 110 && !/[\r\n]/.test(t), 'a caption is one line, up to 110 characters')
    .refine((t) => !GRAPHIC_WORDS.test(t), 'captions must be non-graphic'),
})
export type DayMoment = z.infer<typeof MomentSchema>

const EventTemplate = z
  .string()
  .min(1)
  .refine((t) => !/[\r\n]/.test(t), 'a template is one line')

export const DaySchema = z.strictObject({
  moments: z
    .array(MomentSchema)
    .min(1)
    .superRefine((moments, ctx) => {
      const hours = CONFIG.day.moments
      if (moments.length !== hours.length) {
        ctx.addIssue({ code: 'custom', path: [], message: `${moments.length} moments; CONFIG.day.moments has ${hours.length}` })
        return
      }
      moments.forEach((m, i) => {
        if (m.hour !== hours[i]) ctx.addIssue({ code: 'custom', path: [i, 'hour'], message: `hour ${m.hour} should be ${hours[i]} (CONFIG.day.moments)` })
      })
      if (!allUnique(moments.map((m) => m.label))) ctx.addIssue({ code: 'custom', path: [], message: 'moment labels must be unique' })
    }),
  events: z.record(z.string(), EventTemplate).superRefine((events, ctx) => {
    const known = DAY_EVENT_TYPES as readonly string[]
    for (const type of DAY_EVENT_TYPES) {
      if (!Object.hasOwn(events, type)) ctx.addIssue({ code: 'custom', path: [type], message: `no template for event "${type}"` })
    }
    for (const [type, template] of Object.entries(events)) {
      if (!known.includes(type)) {
        ctx.addIssue({ code: 'custom', path: [type], message: `"${type}" is not an L1 event type` })
        continue
      }
      const allowed = DAY_EVENT_FIELDS[type as DayEventType] as readonly string[]
      for (const [, name] of template.matchAll(PLACEHOLDER)) {
        if (!allowed.includes(name)) ctx.addIssue({ code: 'custom', path: [type], message: `{${name}} is not a field of "${type}" (allowed: ${allowed.join(', ')})` })
      }
      if (/[{}]/.test(template.replace(PLACEHOLDER, ''))) ctx.addIssue({ code: 'custom', path: [type], message: 'stray brace; placeholders look like {room}' })
    }
  }),
  ui: UiSchema,
})
