/**
 * Where the imaging suite's people stand, sit and lie: the building's seats (scan tables, couch, consoles, the hall's
 * waiting chairs, the changing cubicles) and the spots derived from the contract anchors (places.ts `IMAGING`).
 *
 * The building layout exports the seats (src/scene/building/layout). Everything here prefers the real seat and falls back
 * to a spot computed from the anchors if the layout has not got it (a test with a bare registry, a layout still being
 * built), so the sim runs either way; a fallback table is not in the seat registry, which is safe because one scanner
 * holds one patient at a time.
 */
import { seatSpot } from '../er/spots'
import { isWalkable } from '../nav/layout'
import { DOORS, DRAW_CENTRE, IMAGING, areaById, type ScannerAnchors, type Spot } from '../places'
import type { SeatRegistry } from '../seats'
import type { ImagingModality, SeatKind, SeatSpec, Vec2 } from '../types'
import { MODALITIES } from '../types'

const CLEAR = 0.3

/** The first walkable candidate (with a margin), else the last. */
export function firstWalkable(candidates: readonly Vec2[], margin = CLEAR): Vec2 {
  for (const c of candidates) if (isWalkable(c.x, c.z, margin)) return { x: c.x, z: c.z }
  const last = candidates[candidates.length - 1]
  return { x: last.x, z: last.z }
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

const TABLE_KIND: Record<ImagingModality, SeatKind> = { mri: 'scanTable', ct: 'scanTable', xray: 'xrayTable', us: 'usCouch' }
const DOOR_FOR: Record<ImagingModality, string> = { mri: 'mriControl', ct: 'ctControl', xray: 'xray', us: 'ultrasound' }
const INNER_DOOR: Partial<Record<ImagingModality, string>> = { mri: 'mriRoom', ct: 'ctRoom' }

export interface Station {
  /** Where the operator stands (or, with a `seat`, where the seat's approach is). */
  at: Vec2
  heading: number
  /** The console seat or stool she sits on while working the machine, if the layout has one. */
  seat: SeatSpec | null
}

export interface ScannerSites {
  modality: ImagingModality
  anchors: ScannerAnchors
  /** The table or couch seat the patient lies on (a synthetic one if the layout has none). */
  tableSeat: SeatSpec
  /** True if `tableSeat` is in the registry (claim and release it there). */
  tableInRegistry: boolean
  /** Where the operator works the machine. */
  station: Station
  /** Where the operator stands to help the patient on and off the table. */
  handler: Spot
  /** MRI and CT: the spots in the control room, by the inner door, where the screening talk happens. */
  screen: { patient: Vec2; operator: Spot } | null
  /** The hall spot in front of this scanner's door (the demo patient appears here). */
  hallDoor: Vec2
  /** X-ray chest: where a standing patient stands at the wall detector (west wall), facing it. */
  wall: Spot | null
}

export interface Cubicle {
  /** The cubicle's seat if the layout has one, else a synthetic spot. */
  seat: SeatSpec | null
  /** Where the patient stands to change. */
  at: Vec2
  /** The walkable spot outside it. */
  approach: Vec2
  heading: number
}

export interface ImagingSites {
  scanners: Record<ImagingModality, ScannerSites>
  cubicles: Cubicle[]
  /** Where a patient stands in the hall when every waiting seat is taken. */
  hallStand: Vec2[]
}

function seatBy(seats: SeatRegistry, kind: SeatKind, near: Vec2, within: number): SeatSpec | null {
  let best: SeatSpec | null = null
  let bestD = Infinity
  for (const s of seats.all) {
    if (s.kind !== kind) continue
    const d = dist(s, near)
    if (d < bestD && d <= within) {
      best = s
      bestD = d
    }
  }
  return best
}

function doorOf(id: string) {
  const d = DOORS.find((x) => x.id === id)
  if (!d) throw new Error(`Unknown door ${id}`)
  return d
}

function scannerSites(seats: SeatRegistry, m: ImagingModality): ScannerSites {
  const a = IMAGING[m]
  const realTable = seatBy(seats, TABLE_KIND[m], a.table.out, 2.5)
  const tableSeat: SeatSpec = realTable ?? {
    id: `${TABLE_KIND[m]}:${m}:synthetic`,
    kind: TABLE_KIND[m],
    area: a.area,
    x: a.table.out.x,
    z: a.table.out.z,
    heading: a.table.heading,
    pose: 'lie',
    height: a.table.height,
    approach: { x: a.assist.at.x, z: a.assist.at.z },
  }
  const consoleSeat = seatBy(seats, 'console', a.operator.at, 0.8)
  // MRI, CT and the ultrasound stool: sit. X-ray: stand at the booth (in front of the console seat if there is one).
  const sits = m !== 'xray' && consoleSeat !== null
  const station: Station = sits
    ? { at: consoleSeat!.approach, heading: consoleSeat!.heading, seat: consoleSeat }
    : { at: consoleSeat && m === 'xray' ? consoleSeat.approach : a.operator.at, heading: a.operator.heading, seat: null }
  // the sonographer helps the patient from her stool; the others stand at the assist spot, unless that is where the
  // patient gets on (two people cannot share a spot): then she stands to the side of it
  let handler: Spot = m === 'us' ? { at: station.at, heading: a.operator.heading } : { at: a.assist.at, heading: a.assist.heading }
  if (dist(handler.at, tableSeat.approach) < 0.7) {
    const side = firstWalkable([seatSpot(tableSeat, 'nurse'), seatSpot(tableSeat, 'doctor'), handler.at])
    handler = { at: side, heading: Math.atan2(tableSeat.x - side.x, tableSeat.z - side.z) }
  }

  let screen: ScannerSites['screen'] = null
  const innerId = INNER_DOOR[m]
  if (innerId) {
    const inner = doorOf(innerId)
    const control = areaById(a.controlArea).rect
    const z = (control.z0 + control.z1) / 2
    const patient = firstWalkable([{ x: inner.center.x - 0.2, z }, { x: inner.center.x - 0.9, z }, { x: inner.center.x - 1.6, z }])
    const operator = firstWalkable([{ x: patient.x - 1.1, z }, { x: patient.x - 1.6, z }, { x: patient.x - 0.6, z: z + 0.5 }])
    screen = { patient, operator: { at: operator, heading: Math.atan2(patient.x - operator.x, patient.z - operator.z) } }
  }

  const door = doorOf(DOOR_FOR[m])
  const hallZ = (areaById('imagingHall').rect.z0 + areaById('imagingHall').rect.z1) / 2
  const side = door.center.z < hallZ ? -1 : 1
  const hallDoor = firstWalkable([
    { x: door.center.x, z: hallZ + side * 0.9 },
    { x: door.center.x + 0.9, z: hallZ + side * 0.9 },
    { x: door.center.x - 0.9, z: hallZ + side * 0.9 },
    { x: door.center.x, z: hallZ },
  ])

  const wall: Spot | null = m === 'xray' ? { at: firstWalkable([{ x: a.table.out.x - 1.7, z: a.table.out.z }, { x: a.table.out.x - 1.5, z: a.table.out.z }, a.assist.at]), heading: -Math.PI / 2 } : null

  return { modality: m, anchors: a, tableSeat, tableInRegistry: realTable !== null, station, handler, screen, hallDoor, wall }
}

/** Resolve every site from the registry. Cheap; call once per simulation. */
export function buildSites(seats: SeatRegistry): ImagingSites {
  const scanners = {} as Record<ImagingModality, ScannerSites>
  for (const m of MODALITIES) scanners[m] = scannerSites(seats, m)

  // W4: the MRI changing cubicles are the draw centre's anchors on its east wall (`DRAW_CENTRE.cubicles`: `at` inside, `approach` outside)
  const cubicles: Cubicle[] = DRAW_CENTRE.cubicles.map((c) => ({ seat: null, at: { x: c.at.x, z: c.at.z }, approach: { x: c.approach.x, z: c.approach.z }, heading: c.heading }))

  const hall = areaById('imagingHall').rect
  const hallStand: Vec2[] = []
  for (let i = 0; i < 12; i++) {
    const x = hall.x0 + 3.2 + i * 1.4
    const z = (hall.z0 + hall.z1) / 2 + (i % 2 === 0 ? 0.85 : -0.85)
    if (x < hall.x1 - 0.8 && isWalkable(x, z, CLEAR)) hallStand.push({ x, z })
  }
  return { scanners, cubicles, hallStand }
}

/** Who is in which changing cubicle (one person per cubicle). */
export class CubiclePool {
  private readonly by: (string | null)[]

  constructor(readonly cubicles: readonly Cubicle[]) {
    this.by = cubicles.map(() => null)
  }

  /** The first free cubicle, now held by `id`; null if all are taken. */
  claim(id: string): Cubicle | null {
    const held = this.by.indexOf(id)
    if (held >= 0) return this.cubicles[held]
    const i = this.by.indexOf(null)
    if (i < 0) return null
    this.by[i] = id
    return this.cubicles[i]
  }

  release(id: string): void {
    const i = this.by.indexOf(id)
    if (i >= 0) this.by[i] = null
  }

  holder(i: number): string | null {
    return this.by[i] ?? null
  }

  get busy(): number {
    return this.by.filter((x) => x !== null).length
  }
}
