/**
 * The roster service of the living day (L1 day-rhythm): who is at work at which hour, which hours are quiet or night, and
 * the small API the ward staff (src/sim/people.ts, the bed-flow builder's pass) use for the safety huddle, the ward
 * shift change and the night checks. Pure functions of CONFIG, the content (src/content/staff.ts) and places.ts: no
 * randomness (the ward-change timeline takes an Rng), no sim state, safe to import from anywhere in src/sim.
 *
 * Clock hours are numbers (7.5 = 07:30) and wrap at 24; sim time `t` counts seconds from 07:30 (CONFIG.sim.startHour).
 *
 * -- Who is at work: `onShift(staffId, hour)` ------------------------------------------------------------------------
 *   Ward staff, pharmacists, hosts and the night staff follow their content shift (CONFIG.day.shifts: `day` 07-19,
 *   `night` 19-07, `office` 08-18). The ER and support staff are `day` in the content too, but the ER runs around the
 *   clock, its evening peak (18:00-22:00, CONFIG.day.erArrivalsPerHour) needs the whole day team, and the content has no
 *   night ER set, so this roster decides the cover (NIGHT_DUTY, STAY_UNTIL_NIGHT):
 *     - 19:00: the night porter and the night cleaner (content) relieve porter-1 and cleaner-1; Coordinator Eli (coord-2) goes home;
 *     - 22:00, when the night footing begins: Dr. Halima, Nurse Bianca and Nurse Femi (ER, ER nurse, triage), porter-3 and
 *       cleaner-2 go home; Dr. Sven, Nurse Joon, Nurse Greta, Receptionist Yara, Porter Ines (porter-2) and Coordinator Dana
 *       stay on "night duty", with the night porter and cleaner, and the CT and X-ray radiographers (the ER's imaging is
 *       needed at all hours);
 *     - 07:00: the day team comes back and takes over from the night staff (arriving 5-10 minutes early, through the lockers);
 *     - the MRI and ultrasound staff (office hours) go home at 18:00 and are back at 08:00;
 *     - paramedic crews belong to the ambulance service: they are not rostered and only exist during a handover.
 *   `shiftOf(staffId)` is the content shift (the roster the person belongs to); `onShift` is the truth about the hour. The ward
 *   nurses, ward doctors, pharmacists and hosts are rostered here but not enacted by the day rhythm yet (people.ts, later pass).
 *
 * -- Hours -----------------------------------------------------------------------------------------------------------
 *   `isNight(hour)`, `isQuietHour(hour)`, `isCafeOpen(hour)`, `visitingOpen(hour)`.
 *
 * -- Ward staff API (not used by the ER code; the ward nurses and doctors live in people.ts) ---------------------------
 *   `safetyHuddle(ward)`          the 4-minute huddle at the nurse hub after the morning change: window in sim time and
 *                                 the hub spots to stand at. Emit it with `huddleEvent`.
 *   `handoverPairs(ward)`         per room the two bedside HANDOVER spots (outgoing, incoming). Both are inside the room,
 *                                 never in a crossing zone or doorway (tested in places.l1.test.ts).
 *   `wardChangeTimeline(hour, rng)`  seeded times of one ward shift change at 07:00 or 19:00: the incoming nurse arrives,
 *                                 changes, huddles at the hub, then the bedside handover starts (`bedsideSeconds` per room).
 *   `nightRounds(ward, fromT, toT)`  the night nurse's quiet checks, every CONFIG.day.nightCheckEverySeconds during the
 *                                 night, room by room: a `nightCheckSeconds` look in from `RoomSpec.doorInside`.
 */
import { HOSTS, NIGHT_STAFF, STAFF, type StaffMember } from '@/content/staff'
import { fillDayTemplate } from '@/content/day'
import { CONFIG } from '../config'
import { HANDOVER, NURSE_HUB, ROOMS, roomById, type Spot } from '../places'
import type { Rng } from '../rng'
import type { RoomId, ShiftId, WardId } from '../types'
import type { World } from '../er/world'

// ---------------------------------------------------------------------------------------------
// Clock helpers
// ---------------------------------------------------------------------------------------------

/** Clock hour (may exceed 24 on a run past midnight) for a sim time. */
export function clockHourAt(t: number): number {
  return CONFIG.sim.startHour + t / 3600
}

/** Sim time of a clock hour. */
export function timeOfClockHour(hour: number): number {
  return (hour - CONFIG.sim.startHour) * 3600
}

function wrap24(h: number): number {
  return ((h % 24) + 24) % 24
}

/** Is `hour` inside [from, to)? A range with from > to wraps midnight (night 19-07, night hours 22-06:30). */
export function inHours(range: readonly [number, number] | readonly number[], hour: number): boolean {
  const from = range[0]
  const to = range[1]
  const h = wrap24(hour)
  if (from === to) return false
  if (from === 0 && to === 24) return true
  return from < to ? h >= from && h < to : h >= from || h < to
}

/** CONFIG.day.nightHours: the hospital is on its night footing (one nurse a ward, circadian light, ER at night rates). */
export function isNight(hour: number): boolean {
  return inHours(CONFIG.day.nightHours, hour)
}

/** The same, under the name the ambulance schedule and the director use. */
export const isNightHour = isNight

/** CONFIG.day.quietHours: fewer visitors, a calmer lobby. */
export function isQuietHour(hour: number): boolean {
  return inHours(CONFIG.day.quietHours, hour)
}

/** The café is open (CONFIG.day.cafeHours); outside them it is empty and closed. */
export function isCafeOpen(hour: number): boolean {
  return inHours(CONFIG.day.cafeHours, hour)
}

/** Visitors may be on the wards: from the first arrivals until `visitorsLeaveByHour`. */
export function visitingOpen(hour: number): boolean {
  const h = wrap24(hour)
  return h >= 7.5 && h < CONFIG.day.visitorsLeaveByHour
}

// ---------------------------------------------------------------------------------------------
// The rota
// ---------------------------------------------------------------------------------------------

/** What a post is, for the handover sentence ("took over {label} from ...") and for the kit that builds its controller. */
export type PostKind = 'reception' | 'triage' | 'erDoctor' | 'erNurse' | 'porter' | 'cleaner' | 'imaging' | 'command'

export const POST_LABELS: Record<PostKind, string> = {
  reception: 'reception',
  triage: 'triage',
  erDoctor: 'the ER',
  erNurse: 'the ER',
  porter: 'transport',
  cleaner: 'housekeeping',
  imaging: 'imaging',
  command: 'the command center',
}

export interface PostRef {
  kind: PostKind
  /** Index into the controller's post table (ER_DOCTOR_POSTS[index], PORTER_BASES[index], ...). */
  index: number
}

type Window = readonly [number, number]

const ALL_DAY: Window = [0, 24]

/**
 * Night duty (see the module header): these ER and support people work around the clock in the demo, because the
 * content has no night ER set. Replace by a content `NIGHT_ER_STAFF` when it exists (Change request).
 */
export const NIGHT_DUTY: ReadonlySet<string> = new Set(['recep-1', 'nurse-T2', 'doc-ER2', 'nurse-ER2', 'porter-2', 'rad-CT', 'rad-XR', 'coord-1'])

/**
 * The ER evening peak (CONFIG.day.erArrivalsPerHour: 40-44 an hour from 18:00 to 22:00) needs the whole day team, so these
 * people stay past 19:00 and go home when the night footing begins at 22:00 (CONFIG.day.nightHours[0]).
 */
export const STAY_UNTIL_NIGHT: ReadonlySet<string> = new Set(['doc-ER1', 'nurse-ER1', 'nurse-T1', 'porter-3', 'cleaner-2'])

/** Who covers the same job: a leaver hands over to a relief or to the colleague who stays; a comer takes over from them. */
const PARTNERS: Readonly<Record<string, string>> = {
  'nurse-T1': 'nurse-T2',
  'nurse-T2': 'nurse-T1',
  'doc-ER1': 'doc-ER2',
  'doc-ER2': 'doc-ER1',
  'nurse-ER1': 'nurse-ER2',
  'nurse-ER2': 'nurse-ER1',
  'porter-1': 'porter-N',
  'porter-N': 'porter-1',
  'cleaner-1': 'cleaner-N',
  'cleaner-N': 'cleaner-1',
}

export interface RotaEntry {
  member: StaffMember
  /** Hours on site, clock hours. */
  hours: readonly Window[]
  /** The ER and support posts the day rhythm enacts (arrivals, handovers, leaving); null for the ward staff. */
  post: PostRef | null
  partner: string | null
}

/** Which controller index each post uses, in STAFF order (the same counters createErStaff always used). */
function postOf(m: StaffMember, counters: Record<string, number>): PostRef | null {
  const next = (k: PostKind): PostRef => ({ kind: k, index: counters[k]++ })
  switch (m.post) {
    case 'reception':
      return next('reception')
    case 'triage':
      return m.role === 'nurse' ? next('triage') : null
    case 'er':
      if (m.role === 'doctor') return next('erDoctor')
      if (m.role === 'nurse') return next('erNurse')
      return null
    case 'transport':
      return next('porter')
    case 'housekeeping':
      return next('cleaner')
    case 'imaging':
      return next('imaging')
    case 'command':
      return next('command')
    default:
      return null
  }
}

function hoursOf(m: StaffMember): readonly Window[] {
  const own = CONFIG.day.shifts[m.shift] as Window
  if (NIGHT_DUTY.has(m.id)) return [ALL_DAY]
  if (STAY_UNTIL_NIGHT.has(m.id)) return [[own[0], CONFIG.day.nightHours[0]]]
  return [own]
}

function buildRota(): RotaEntry[] {
  const counters: Record<string, number> = { reception: 0, triage: 0, erDoctor: 0, erNurse: 0, porter: 0, cleaner: 0, imaging: 0, command: 0 }
  const rota: RotaEntry[] = []
  for (const m of STAFF) {
    // paramedic crews are external: not rostered, present only while an ambulance is handed over
    if (m.role === 'paramedic') continue
    rota.push({ member: m, hours: hoursOf(m), post: postOf(m, counters), partner: PARTNERS[m.id] ?? null })
  }
  for (const m of NIGHT_STAFF) {
    // the night porter takes the first base and the night cleaner the first patrol: they relieve porter-1 and cleaner-1
    const post: PostRef | null = m.role === 'porter' ? { kind: 'porter', index: 0 } : m.role === 'cleaner' ? { kind: 'cleaner', index: 0 } : null
    rota.push({ member: m, hours: hoursOf(m), post, partner: PARTNERS[m.id] ?? null })
  }
  for (const m of HOSTS) rota.push({ member: m, hours: hoursOf(m), post: null, partner: null })
  return rota
}

export const ROTA: readonly RotaEntry[] = buildRota()
const ROTA_BY_ID = new Map(ROTA.map((r) => [r.member.id, r]))

export function rotaOf(staffId: string): RotaEntry | undefined {
  return ROTA_BY_ID.get(staffId)
}

/** The content shift a staff member belongs to. Throws on an id that is in no roster. */
export function shiftOf(staffId: string): ShiftId {
  const r = ROTA_BY_ID.get(staffId)
  if (!r) throw new Error(`shiftOf: unknown staff id "${staffId}"`)
  return r.member.shift
}

/** Is this staff member at work at the clock hour? (The module header says how night duty is decided.) */
export function onShift(staffId: string, hour: number): boolean {
  const r = ROTA_BY_ID.get(staffId)
  if (!r) throw new Error(`onShift: unknown staff id "${staffId}"`)
  return r.hours.some((w) => inHours(w, hour))
}

/** Every rostered member at work at the clock hour, in rota order. */
export function onShiftAt(hour: number): StaffMember[] {
  return ROTA.filter((r) => r.hours.some((w) => inHours(w, hour))).map((r) => r.member)
}

// ---------------------------------------------------------------------------------------------
// Shift changes (the ER and support posts)
// ---------------------------------------------------------------------------------------------

export type ChangeKind =
  /** One leaves, another takes the post over (night porter for the day porter). */
  | 'relief'
  /** One leaves; a colleague on the same job stays and takes over. */
  | 'leaveStayer'
  /** One arrives and takes over from the colleague who worked the night. */
  | 'comeStayer'
  /** One leaves, nobody takes over. */
  | 'leave'
  /** One arrives, nobody to take over from. */
  | 'come'

export interface Change {
  key: string
  /** Clock hour of the change; 24 and above are the next morning. */
  hour: number
  kind: ChangeKind
  leaver: RotaEntry | null
  comer: RotaEntry | null
  stayer: RotaEntry | null
}

const EPS = 1e-6

/** Is this rota entry at work at the clock hour? */
export function worksAt(r: RotaEntry, hour: number): boolean {
  return r.hours.some((w) => inHours(w, hour))
}

/**
 * Every enacted shift change from clock hour `from` up to (not including) `to`, in time order. A change is a boundary
 * of somebody's hours: relief pairs are one change, a leaver or comer with a colleague who stays is one change with a
 * `stayer`, and anybody with nobody to hand to is a `leave` or `come`.
 */
export function shiftChanges(from: number = CONFIG.day.startHour, to: number = CONFIG.day.startHour + 24): Change[] {
  const raw: { r: RotaEntry; hour: number; kind: 'leave' | 'come' }[] = []
  for (const r of ROTA) {
    if (r.post === null) continue
    for (const w of r.hours) {
      if (w[0] === 0 && w[1] === 24) continue
      for (const day of [0, 24, 48]) {
        for (const [hour, kind] of [[w[0] + day, 'come'], [w[1] + day, 'leave']] as const) {
          if (hour < from || hour >= to) continue
          const before = worksAt(r, hour - EPS)
          const after = worksAt(r, hour + EPS)
          if (kind === 'come' && !before && after) raw.push({ r, hour, kind })
          else if (kind === 'leave' && before && !after) raw.push({ r, hour, kind })
        }
      }
    }
  }
  const used = new Set<number>()
  const out: Change[] = []
  raw.sort((a, b) => a.hour - b.hour || (a.r.member.id < b.r.member.id ? -1 : 1))
  raw.forEach((e, i) => {
    if (used.has(i)) return
    used.add(i)
    const partner = e.r.partner ? ROTA_BY_ID.get(e.r.partner) ?? null : null
    const mirror = partner ? raw.findIndex((o, j) => !used.has(j) && o.r === partner && Math.abs(o.hour - e.hour) < EPS && o.kind !== e.kind) : -1
    const key = `${e.r.member.id}@${e.hour}`
    if (partner && mirror >= 0) {
      used.add(mirror)
      const leaver = e.kind === 'leave' ? e.r : partner
      const comer = e.kind === 'come' ? e.r : partner
      out.push({ key, hour: e.hour, kind: 'relief', leaver, comer, stayer: null })
    } else if (partner && worksAt(partner, e.hour - EPS) && worksAt(partner, e.hour + EPS)) {
      out.push(
        e.kind === 'leave'
          ? { key, hour: e.hour, kind: 'leaveStayer', leaver: e.r, comer: null, stayer: partner }
          : { key, hour: e.hour, kind: 'comeStayer', leaver: null, comer: e.r, stayer: partner },
      )
    } else {
      out.push(
        e.kind === 'leave'
          ? { key, hour: e.hour, kind: 'leave', leaver: e.r, comer: null, stayer: null }
          : { key, hour: e.hour, kind: 'come', leaver: null, comer: e.r, stayer: null },
      )
    }
  })
  return out
}

// ---------------------------------------------------------------------------------------------
// The ward staff API
// ---------------------------------------------------------------------------------------------

export interface HuddleWindow {
  ward: WardId
  /** Sim time the huddle starts and ends. */
  startT: number
  endT: number
  seconds: number
  /** Where the nurses (and the coordinator, who joins by screen from the command center) stand. */
  spots: readonly Spot[]
}

/** The morning safety huddle at a ward's nurse hub (CONFIG.day.safetyHuddle: 07:33, 4 min). Doctors start rounds. */
export function safetyHuddle(ward: WardId): HuddleWindow {
  const { atHour, seconds } = CONFIG.day.safetyHuddle
  const startT = timeOfClockHour(atHour)
  return { ward, startT, endT: startT + seconds, seconds, spots: NURSE_HUB[ward] }
}

/** The `huddle` event sentence ("Nurse hub A huddle: <topic>."). The topic text is content: the caller passes it. */
export function huddleEvent(world: World, ward: WardId, topic: string, actorId?: string): void {
  const text = fillDayTemplate('huddle', { hub: `Nurse hub ${ward}`, topic })
  world.say('huddle', text, actorId ? { actorId } : {})
}

export interface HandoverPair {
  roomId: RoomId
  /** Where the outgoing nurse stands, and where the incoming nurse stands (both inside the room, on the door side of the bed). */
  outgoing: Spot
  incoming: Spot
}

/** The bedside handover spots of every room in a ward. */
export function handoverPairs(ward: WardId): HandoverPair[] {
  return ROOMS.filter((r) => r.ward === ward).map((r) => ({ roomId: r.id, outgoing: HANDOVER[r.id][0], incoming: HANDOVER[r.id][1] }))
}

export interface WardChangeTimeline {
  /** Sim times (seconds): the incoming nurse reaches the entrance, is at the lockers, huddles with the outgoing nurse at
   * the hub, and starts the first bedside handover; the outgoing nurse leaves after the last one. */
  arriveT: number
  lockersDoneT: number
  huddleStartT: number
  huddleEndT: number
  bedsideStartT: number
  /** Seconds one bedside handover lasts (both nurses and the patient; at most CONFIG.day.bedsideHandoverSeconds[1]). */
  bedsideSeconds: number
}

/**
 * One ward's shift change at clock hour `hour` (07:00 or 19:00), seeded by `rng` (fork it per ward). The incoming nurse
 * arrives `arriveEarlySeconds` early, changes at the lockers, and the hub huddle starts at the hour.
 */
export function wardChangeTimeline(hour: number, rng: Rng): WardChangeTimeline {
  const d = CONFIG.day
  const at = timeOfClockHour(hour)
  const arriveT = at - rng.between(d.arriveEarlySeconds)
  const lockersDoneT = arriveT + 90 + rng.between(d.lockerSeconds)
  const huddleStartT = Math.max(lockersDoneT + 30, at)
  const huddleEndT = huddleStartT + rng.between(d.huddleSeconds)
  return { arriveT, lockersDoneT, huddleStartT, huddleEndT, bedsideStartT: huddleEndT + 20, bedsideSeconds: rng.between(d.bedsideHandoverSeconds) }
}

export interface NightCheck {
  roomId: RoomId
  /** Just inside the door (RoomSpec.doorInside), and the heading that looks at the bed. */
  spot: Spot
  seconds: number
}

export interface NightRound {
  /** Sim time the round starts (22:00, 00:00, 02:00, 04:00, 06:00). */
  startT: number
  ward: WardId
  /** The rooms in walking order. */
  checks: NightCheck[]
}

/** A night nurse's quiet checks of every room, every CONFIG.day.nightCheckEverySeconds while it is night. */
export function nightRounds(ward: WardId, fromT: number, toT: number): NightRound[] {
  const d = CONFIG.day
  const rounds: NightRound[] = []
  const first = timeOfClockHour(d.nightHours[0])
  const every = d.nightCheckEverySeconds
  const rooms = ROOMS.filter((r) => r.ward === ward)
  for (let k = Math.floor((fromT - first) / every); first + k * every <= toT; k++) {
    const startT = first + k * every
    if (startT < fromT || startT > toT || !isNight(clockHourAt(startT))) continue
    rounds.push({
      startT,
      ward,
      checks: rooms.map((r) => {
        const spot = r.doorInside
        return { roomId: r.id, spot: { at: spot, heading: Math.atan2(r.bed.x - spot.x, r.bed.z - spot.z) }, seconds: d.nightCheckSeconds }
      }),
    })
  }
  return rounds
}

/** The spot a night nurse looks into a room from (`RoomSpec.doorInside`). */
export function nightCheckSpot(roomId: RoomId): Spot {
  const r = roomById(roomId)
  return { at: r.doorInside, heading: Math.atan2(r.bed.x - r.doorInside.x, r.bed.z - r.doorInside.z) }
}
