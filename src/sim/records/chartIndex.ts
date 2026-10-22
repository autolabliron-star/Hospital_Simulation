/**
 * The patient record's memory of the event log. The log keeps only the last 2000 events, so a patient admitted from the ER in the morning would lose
 * their ER story by the afternoon. The index tails the log (`log.since(lastId)`) and keeps, per patient and per ward room, the few event types the
 * record shows, plus the staff handovers. It only reads the log: it never writes the sim. One index per EventLog (a Jump builds a new sim with a new
 * log, so it starts a new index).
 *
 * `noteEvents(log)` is cheap (it reads only the new events); the record calls it whenever it is built, and the Change request in
 * docs/handover/patient-record.md asks for one call per 4 Hz publish so nothing is missed while the tablet is closed.
 */
import type { EventLog } from '../events'
import type { SimEvent, SimEventType } from '../types'

/** The event types about a patient (by `subjectId`) that the record keeps. */
const SUBJECT_TYPES: ReadonlySet<SimEventType> = new Set<SimEventType>([
  'patientArrived',
  'checkedIn',
  'triaged',
  'seenByDoctor',
  'testsOrdered',
  'resultsBack',
  'discharged',
  'admitted',
  'leftWithoutBeingSeen',
  'porterJob',
  'outpatientArrived',
  'scanStarted',
  'scanDone',
  'reportReady',
  'dischargeSigned',
  'wentHome',
  'bedAssigned',
  'patientBoarding',
  'admittedToWard',
  'healthCheck',
  'bloodDrawn',
  'drawByNurse',
  'samplesSent',
  'labResults',
  'surgeryArrived',
  'preOpReady',
  'theatreIn',
  'consoleStart',
  'robotUndocked',
  'theatreOut',
  'pacuOut',
  'talkedTo',
])

/** The event types about a ward room (by `roomId`) that the record keeps: the medicines' own trail is read from the orders instead. */
const ROOM_TYPES: ReadonlySet<SimEventType> = new Set<SimEventType>(['medsGiven', 'dischargeSigned', 'wentHome', 'bedAssigned', 'admittedToWard', 'talkedTo'])

/** At most this many events kept per patient or room (a long day stays bounded). */
const MAX_PER_KEY = 400
const MAX_HANDOVERS = 200

export interface ChartIndex {
  lastId: number
  /** Events were dropped from the log before the index read them. */
  gap: boolean
  readonly bySubject: Map<string, SimEvent[]>
  readonly byRoom: Map<string, SimEvent[]>
  readonly handovers: SimEvent[]
}

const INDEXES = new WeakMap<EventLog, ChartIndex>()

function keep(map: Map<string, SimEvent[]>, key: string, e: SimEvent): void {
  let list = map.get(key)
  if (!list) map.set(key, (list = []))
  list.push(e)
  if (list.length > MAX_PER_KEY) list.splice(0, list.length - MAX_PER_KEY)
}

/** Read the events the index has not seen yet. Returns the index (read-only for callers). */
export function noteEvents(log: EventLog): ChartIndex {
  let idx = INDEXES.get(log)
  if (!idx) {
    idx = { lastId: 0, gap: false, bySubject: new Map(), byRoom: new Map(), handovers: [] }
    INDEXES.set(log, idx)
  }
  const first = log.events[0]
  if (first && first.id > idx.lastId + 1) idx.gap = true
  const fresh = log.since(idx.lastId)
  for (const e of fresh) {
    if (e.subjectId && SUBJECT_TYPES.has(e.type)) keep(idx.bySubject, e.subjectId, e)
    if (e.roomId && ROOM_TYPES.has(e.type)) keep(idx.byRoom, e.roomId, e)
    if (e.type === 'shiftHandover' || e.type === 'huddle') {
      idx.handovers.push(e)
      if (idx.handovers.length > MAX_HANDOVERS) idx.handovers.splice(0, idx.handovers.length - MAX_HANDOVERS)
    }
  }
  if (fresh.length > 0) idx.lastId = fresh[fresh.length - 1].id
  return idx
}
