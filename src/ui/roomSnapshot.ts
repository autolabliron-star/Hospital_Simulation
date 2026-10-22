/**
 * What the room panel shows, read from the simulation into small plain objects. The panel polls this at about 4 Hz
 * (never per frame) and only re-renders when the numbers or words changed. Everything here takes the sim as an argument,
 * so tests can feed it a Simulation they built themselves.
 */
import { medicineById, patientInRoom } from '@/content/catalogue'
import { staffName } from '@/content/staff'
import { OUTPATIENTS, outpatientTimeSeconds, protocolById } from '@/content/imaging'
import { areaById, type AreaId, type Rect } from '@/sim/places'
import type { Simulation } from '@/sim/Simulation'
import type { Entity, ImagingExam, ImagingModality, OrderStage, Role, ScannerState } from '@/sim/types'
import { L1_COPY } from './l1Copy'
import { completedSteps, currentStep, formatDuration, MODALITY_NAME, phaseText, sourceLabel, stepPercent } from './scanPhase'

// ---------------------------------------------------------------------------------------------
// Who is in a room
// ---------------------------------------------------------------------------------------------

const PLURAL: Record<Role, [string, string]> = {
  patient: ['patient', 'patients'],
  visitor: ['visitor', 'visitors'],
  doctor: ['doctor', 'doctors'],
  nurse: ['nurse', 'nurses'],
  pharmacist: ['pharmacist', 'pharmacists'],
  porter: ['porter', 'porters'],
  cleaner: ['cleaner', 'cleaners'],
  receptionist: ['receptionist', 'receptionists'],
  coordinator: ['coordinator', 'coordinators'],
  paramedic: ['paramedic', 'paramedics'],
  radiographer: ['radiographer', 'radiographers'],
  sonographer: ['sonographer', 'sonographers'],
  host: ['ward host', 'ward hosts'],
  labScientist: ['lab scientist', 'lab scientists'],
}

/** Staff first, then patients and visitors: the order names are listed in. */
const ROLE_ORDER: Role[] = ['doctor', 'nurse', 'pharmacist', 'radiographer', 'sonographer', 'coordinator', 'receptionist', 'paramedic', 'porter', 'host', 'labScientist', 'cleaner', 'patient', 'visitor']

export function roleWord(role: Role, count: number): string {
  return PLURAL[role][count === 1 ? 0 : 1]
}

export interface HereNow {
  total: number
  groups: { role: Role; count: number }[]
  /** A few names, staff first. */
  names: string[]
}

type Located = Pick<Entity, 'role' | 'name' | 'position'> & { fade?: number }

/** The people standing inside `rect` right now (people still fading in or out are not counted). */
export function hereNow(entities: Iterable<Located>, rect: Rect, maxNames = 4): HereNow {
  const counts = new Map<Role, number>()
  const found: Located[] = []
  for (const e of entities) {
    const { x, z } = e.position
    if (x < rect.x0 || x > rect.x1 || z < rect.z0 || z > rect.z1) continue
    if ((e.fade ?? 1) < 0.5) continue
    counts.set(e.role, (counts.get(e.role) ?? 0) + 1)
    found.push(e)
  }
  found.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return {
    total: found.length,
    groups: ROLE_ORDER.filter((r) => counts.has(r)).map((role) => ({ role, count: counts.get(role) ?? 0 })),
    names: found.slice(0, maxNames).map((e) => e.name),
  }
}

/** "2 nurses, 1 doctor" or "Nobody here right now". */
export function describeHere(h: HereNow): string {
  if (h.total === 0) return 'Nobody here right now'
  return h.groups.map((g) => `${g.count} ${roleWord(g.role, g.count)}`).join(', ')
}

// ---------------------------------------------------------------------------------------------
// Imaging access (the imaging department is wired into the Simulation by the orchestrator)
// ---------------------------------------------------------------------------------------------

export interface QueuedBooking {
  patientName: string
  protocolName?: string
  kind?: string
}

/** What the viewer needs from `sim.imaging`: the scanner states, the demo button and (if the sim has it) the waiting lists. */
export interface ImagingSimLike {
  scanners: Record<ImagingModality, ScannerState>
  startDemoScan(m: ImagingModality): boolean
  hasOperator?(m: ImagingModality): boolean
  queues?: Record<ImagingModality, { readonly waiting: readonly QueuedBooking[] }>
}

export type SimView = Pick<Simulation, 'entities' | 'meds' | 't' | 'life'> & { imaging?: ImagingSimLike | null }

/** `sim.imaging`, or undefined until the imaging department exists ("Imaging is starting up"). */
export function imagingOf(sim: object): ImagingSimLike | undefined {
  return (sim as { imaging?: ImagingSimLike | null }).imaging ?? undefined
}

// ---------------------------------------------------------------------------------------------
// Scanner view
// ---------------------------------------------------------------------------------------------

export interface ScannerView {
  modality: ImagingModality
  modalityName: string
  phase: ScannerState['phase']
  phaseText: string
  /** A patient is on the way to or on the scanner. */
  busy: boolean
  examId: string | null
  protocol: string | null
  patientName: string | null
  sourceText: string | null
  operatorName: string | null
  step: number
  steps: number
  stepNames: string[]
  percent: number
  remainingText: string | null
  completed: number[]
  /** A demo patient has already been asked for and is on the way. */
  demoPending: boolean
  queueLabel: 'Next in queue' | 'Next booked'
  queueText: string
}

function protocolOfBooking(b: QueuedBooking): string {
  return b.protocolName ? `, ${b.protocolName}` : ''
}

/** The head of the scanner's waiting list, e.g. "Next in queue: Gregor Ashby, MRI brain". */
function queueSummary(imaging: ImagingSimLike, m: ImagingModality, exam: ImagingExam | null, simT: number): Pick<ScannerView, 'queueLabel' | 'queueText' | 'demoPending'> {
  const waiting = imaging.queues?.[m]?.waiting
  if (waiting) {
    const head = waiting[0]
    return {
      queueLabel: 'Next in queue',
      queueText: head ? `${head.kind === 'demo' ? 'Demo patient' : head.patientName}${protocolOfBooking(head)}` : 'nobody waiting',
      demoPending: waiting.some((b) => b.kind === 'demo'),
    }
  }
  // The sim does not list its queue: say what the day's bookings show instead, and call it that.
  const next = OUTPATIENTS.find((o) => protocolById(o.protocol).modality === m && o.name !== exam?.patientName && outpatientTimeSeconds(o) >= simT - 300)
  return {
    queueLabel: 'Next booked',
    queueText: next ? `${next.name}, ${protocolById(next.protocol).name}, ${next.time}` : 'no more bookings today',
    demoPending: false,
  }
}

export function scannerView(imaging: ImagingSimLike, m: ImagingModality, simT: number): ScannerView {
  const s = imaging.scanners[m]
  const exam = s.exam
  const total = exam?.sequences.length ?? 0
  const stepName = exam && s.sequence >= 0 ? (exam.sequences[Math.min(s.sequence, total - 1)]?.name ?? null) : null
  const busy = s.phase !== 'idle' || exam !== null
  return {
    modality: m,
    modalityName: MODALITY_NAME[m],
    phase: s.phase,
    phaseText: phaseText(s.phase, { modality: m, stepName }),
    busy,
    examId: exam?.id ?? null,
    protocol: exam?.protocol ?? null,
    patientName: exam?.patientName ?? null,
    sourceText: exam ? sourceLabel(exam.source) : null,
    operatorName: s.operatorId ? staffName(s.operatorId) : null,
    step: currentStep(s, total),
    steps: total,
    stepNames: exam ? exam.sequences.map((q) => q.name) : [],
    percent: stepPercent(s),
    remainingText: exam && s.phase !== 'idle' ? formatDuration(s.remaining) : null,
    completed: completedSteps(s, total),
    ...queueSummary(imaging, m, exam, simT),
  }
}

// ---------------------------------------------------------------------------------------------
// Ward room, pharmacy core, other rooms
// ---------------------------------------------------------------------------------------------

const STAGE_LABEL: Record<OrderStage, string> = {
  prescribed: 'Prescribed',
  verified: 'Verified',
  picking: 'Being picked',
  enRoute: 'On its way',
  inDrawer: 'In the drawer',
  given: 'Given',
}

export interface WardRoomView {
  kind: 'ward'
  roomId: string
  /** The live occupant; age and reason are null when the bed is empty or only reserved. */
  patient: { name: string; age: number | null; reason: string | null }
  drawer: { loaded: boolean; lightOn: boolean; items: { name: string; strength: string; qty: number; color: string }[] }
  orders: { id: string; stage: string; meds: string }[]
  here: HereNow
}

export interface PharmacyView {
  kind: 'pharmacy'
  podsBusy: number
  podsCharging: number
  podsTotal: number
  /** One entry per ward face whose picker is working an order. */
  picking: { ward: string; orderId: string; roomId: string; pack: number; packs: number }[]
  /** Orders waiting for the pharmacist or the picker, oldest first (at most `QUEUE_SHOWN`). */
  queue: { orderId: string; roomId: string; stage: string }[]
  queueTotal: number
  here: HereNow
}

export interface GenericRoomView {
  kind: 'generic'
  label: string
  subtitle: string
  here: HereNow
}

export type RoomView = WardRoomView | PharmacyView | GenericRoomView

const QUEUE_SHOWN = 5

function medList(items: { medId: string; qty: number }[]): string {
  return items
    .map((i) => {
      const m = medicineById(i.medId)
      return `${m.name} ${m.strength}${i.qty > 1 ? ` ×${i.qty}` : ''}`
    })
    .join(', ')
}

/** Who is in a ward bed now: the live occupant from `sim.life`, or the bed state when it is empty. The demo roster is used only when `sim.life` has no entry for the room. */
function occupantOf(sim: Pick<SimView, 'life'>, roomId: string): WardRoomView['patient'] {
  const room = sim.life.rooms.get(roomId)
  if (!room) {
    const p = patientInRoom(roomId)
    return { name: p.name, age: p.age, reason: p.reason }
  }
  return { name: room.patientName ?? L1_COPY.bedStates[room.bed].label, age: room.patientAge ?? null, reason: room.patientReason ?? null }
}

export function roomView(sim: SimView, area: AreaId): RoomView {
  const a = areaById(area)
  const here = hereNow(sim.entities.values(), a.rect)

  if (area === 'core') {
    let busy = 0
    let charging = 0
    for (const d of sim.meds.fleet.drivers) {
      if (d.pod.state === 'charging') charging++
      else busy++
    }
    const picking: PharmacyView['picking'] = []
    for (const ward of ['A', 'B'] as const) {
      const g = sim.meds.dispensers[ward].gantry
      const order = g.orderId ? sim.meds.orders.get(g.orderId) : undefined
      if (order && g.state !== 'idle') picking.push({ ward, orderId: order.id, roomId: order.roomId, pack: Math.min(order.items.length, g.itemIndex + 1), packs: order.items.length })
    }
    const waiting = [...sim.meds.orders.values()].filter((o) => o.stage === 'prescribed' || o.stage === 'verified').sort((x, y) => x.createdAt - y.createdAt)
    return {
      kind: 'pharmacy',
      podsBusy: busy,
      podsCharging: charging,
      podsTotal: busy + charging,
      picking,
      queue: waiting.slice(0, QUEUE_SHOWN).map((o) => ({ orderId: o.id, roomId: o.roomId, stage: STAGE_LABEL[o.stage] })),
      queueTotal: waiting.length,
      here,
    }
  }

  if (a.kind === 'room' && area.startsWith('room:')) {
    const roomId = area.slice('room:'.length)
    const patient = occupantOf(sim, roomId)
    const drawer = sim.meds.drawers.get(roomId)
    const orders = [...sim.meds.orders.values()].filter((o) => o.roomId === roomId && o.stage !== 'given').sort((x, y) => x.createdAt - y.createdAt)
    return {
      kind: 'ward',
      roomId,
      patient,
      drawer: {
        loaded: drawer?.state === 'loaded',
        lightOn: drawer?.lightOn ?? false,
        items: (drawer?.items ?? []).map((i) => {
          const m = medicineById(i.medId)
          return { name: m.name, strength: m.strength, qty: i.qty, color: m.color }
        }),
      },
      orders: orders.map((o) => ({ id: o.id, stage: STAGE_LABEL[o.stage], meds: medList(o.items) })),
      here,
    }
  }

  return { kind: 'generic', label: a.label, subtitle: a.subtitle, here }
}
