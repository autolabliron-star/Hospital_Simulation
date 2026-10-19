/**
 * Layout contract: where everything is. One floor, roof off, metres, x east, z south (north = -z).
 * Every module that needs "where things are" derives from here: the people nav graph, the robot circuits,
 * walls and colliders, decor, the minimap, the tour shots. Change numbers here and everything follows.
 * Owned by the orchestrator.
 *
 *  x=-62        -44 -40      -28        -12          12                40
 *  z=-22 ┌────────┬───┬──────────────────────────────────────────────────┐
 *        │        │lft│ staff A │A1│A2│A3│A4│ hub A │A5│A6│A7│A8│ lounge A │  ward A rooms (z -22..-16)
 *        │ TRIAGE ├───┤═════════════ ward A corridor (z -16..-12) ════════│  robot lanes at z -15.3 / -12.7
 *  z=-6  ├────────┤ s ├──────────┬───────────┬──────────────┬───────────┤
 *        │ LOBBY  │ p │ DIAGNOS- │ COMMAND   │ PHARMACY CORE│  HEALING  │  middle band (z -12..12)
 *  entr.▶│        │ i │ TICS     │ CENTER    │  (MedVend    │  ATRIUM   │
 *  z=+6  ├────────┤ n ├──────────┴───────────┴──────────────┴───────────┤
 *        │   ER   ├───┤═════════════ ward B corridor (z 12..16) ═════════│
 *        │        │lft│ supply B│B1│B2│B3│B4│ hub B │B5│B6│B7│B8│ quiet B  │  ward B rooms (z 16..22)
 *  z=+22 └────────┴───┴──────────────────────────────────────────────────┘
 *
 * Ward B is ward A mirrored in z. `wardSign(w)` is -1 for A and +1 for B: multiply a ward-A z by -1 * sign.
 */
import type { RoomId, TubeKind, VehicleKind, Vec2, Vec3, WardId } from './types'

export interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

export const BUILDING: Rect = { x0: -62, x1: 40, z0: -22, z1: 22 }

/**
 * Walls. `height` is the real storey height (glass partitions and tall props use it); `cutHeight` is the
 * architect's-model section cut every solid wall is drawn at, so the camera sees into every room.
 */
export const WALL = { height: 3.0, cutHeight: 1.3, thickness: 0.2, doorHeight: 2.3 } as const

/** Where the overview camera looks and how much it must frame. */
export const VIEW = {
  center: { x: -11, z: 0 } as Vec2,
  halfExtent: { x: 51, z: 22 } as Vec2,
} as const

/** Single floor: everything stands on y = 0. Kept as a seam for ramps or a second floor later. */
export function groundHeightAt(_x: number, _z: number): number {
  return 0
}

/** -1 for ward A (north), +1 for ward B (south). */
export function wardSign(w: WardId): -1 | 1 {
  return w === 'A' ? -1 : 1
}

// ---------------------------------------------------------------------------------------------
// Bands (|z|)
// ---------------------------------------------------------------------------------------------

/** |z| of the outer wall, the room/corridor wall and the corridor/middle-band wall. */
export const BANDS = { outer: 22, roomWall: 16, innerWall: 12 } as const
/** |z| of the corridor centre line, where people walk. */
export const CORRIDOR_CENTER = (BANDS.roomWall + BANDS.innerWall) / 2

// ---------------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------------

export type AreaId =
  | 'lobby'
  | 'triage'
  | 'er'
  | 'spine'
  | 'liftA'
  | 'liftB'
  | 'imagingHall'
  | 'mri'
  | 'mriControl'
  | 'ct'
  | 'ctControl'
  | 'xray'
  | 'ultrasound'
  /** Blood draw and changing cubicles (kept as `diagnostics`: the ER's blood-test chairs live here). */
  | 'diagnostics'
  | 'command'
  | 'core'
  | 'atrium'
  | 'corridorA'
  | 'corridorB'
  | 'staffA'
  | 'loungeA'
  | 'hubA'
  | 'supplyB'
  /** W4: the automated lab (sample track, centrifuges, analysers), split from the clean-supply room. */
  | 'lab'
  | 'quietB'
  | 'hubB'
  | `room:${string}`

export type AreaKind = 'public' | 'clinical' | 'staff' | 'robot' | 'room' | 'service'

export interface Area {
  id: AreaId
  label: string
  subtitle: string
  rect: Rect
  kind: AreaKind
  ward?: WardId
  /** Shown on the minimap. */
  mapLabel: boolean
}

function wardRect(w: WardId, x0: number, x1: number): Rect {
  return w === 'A'
    ? { x0, x1, z0: -BANDS.outer, z1: -BANDS.roomWall }
    : { x0, x1, z0: BANDS.roomWall, z1: BANDS.outer }
}

function corridorRect(w: WardId): Rect {
  return w === 'A'
    ? { x0: -40, x1: 40, z0: -BANDS.roomWall, z1: -BANDS.innerWall }
    : { x0: -40, x1: 40, z0: BANDS.innerWall, z1: BANDS.roomWall }
}

// ---------------------------------------------------------------------------------------------
// Patient rooms
// ---------------------------------------------------------------------------------------------

export const ROOM_WIDTH = 5
/** West edges of rooms 1..8 of a ward: four west of the nurse hub, four east of it. */
export const ROOM_X0 = [-25, -20, -15, -10, 5, 10, 15, 20] as const

export interface RoomSpec {
  id: RoomId
  ward: WardId
  /** 1..8 */
  number: number
  rect: Rect
  /** Door centre in the corridor wall (1.4 m opening along x). */
  door: Vec2
  doorWidth: number
  /** On the corridor centre line in front of the door. */
  doorOutside: Vec2
  /** Just inside the door. */
  doorInside: Vec2
  /** MedDrawer: pass-through cabinet in the corridor wall, beside the bed head (wall point). */
  drawer: Vec2
  /** Where a pod stops on the room lane to load the drawer. */
  podDock: Vec2
  /** Where a nurse stands inside to open the drawer and give the medicines. */
  drawerSpot: Vec2
  /** Bed centre; the bed head is against the corridor wall and the patient faces the window. */
  bed: Vec2
  bedHeading: number
  /** Patient's head when lying (for look-at and emotes). */
  pillow: Vec2
  /** Where a doctor stands at the bedside (door side of the bed). */
  bedside: Vec2
  bedsideHeading: number
  /** Visitor chair by the window. */
  chair: Vec2
}

function buildRoom(w: WardId, n: number): RoomSpec {
  const s = wardSign(w)
  const x0 = ROOM_X0[n - 1]
  const z = (absZ: number) => absZ * s
  return {
    id: `${w}${n}`,
    ward: w,
    number: n,
    rect: wardRect(w, x0, x0 + ROOM_WIDTH),
    door: { x: x0 + 1.1, z: z(BANDS.roomWall) },
    doorWidth: 1.4,
    doorOutside: { x: x0 + 1.1, z: z(CORRIDOR_CENTER) },
    doorInside: { x: x0 + 1.1, z: z(17.0) },
    drawer: { x: x0 + 4.3, z: z(BANDS.roomWall) },
    podDock: { x: x0 + 4.3, z: z(BANDS.roomWall - ROBOT.laneOffset) },
    drawerSpot: { x: x0 + 4.3, z: z(17.0) },
    bed: { x: x0 + 3.2, z: z(17.35) },
    // facing the window: ward A looks north (-z), ward B looks south (+z)
    bedHeading: w === 'A' ? Math.PI : 0,
    pillow: { x: x0 + 3.2, z: z(16.6) },
    bedside: { x: x0 + 2.2, z: z(17.6) },
    bedsideHeading: Math.PI / 2,
    chair: { x: x0 + 1.0, z: z(20.6) },
  }
}

// ---------------------------------------------------------------------------------------------
// Robots: the ceiling rail, the pharmacy core, docks and the rank
// ---------------------------------------------------------------------------------------------

/**
 * Robot geometry, ward A values (ward B mirrors z). W2: the pods HANG from a ceiling rail (nothing of them is on the
 * floor, so people never wait for a pod and pods never wait for people). Each ward has ONE closed one-way circuit, so
 * pods never meet head-on and never merge (no deadlock by construction); the rail follows it exactly:
 *   rank (charging siding, x=8) → dock line (|z|=2, westbound, past 2 MedVend top ports)
 *   → exit spur (x=-8, towards the corridor) → rail portal in the core's glass → inner line (|z|=12.7, westbound)
 *   → west U-turn (x=-27) → room line (|z|=15.3, eastbound, past every drawer chute) → east U-turn (x=27)
 *   → inner line westbound → rail portal at x=8 → rank.
 * See src/sim/meds/circuit.ts. (The "lane" names below are the circuit's lines; they are overhead.)
 */
export const ROBOT = {
  /** Lane centre lines sit this far from the corridor walls. */
  laneOffset: 0.7,
  /** U-turn centres at x = ±uturnX on the corridor centre line. */
  uturnX: 27,
  /** Robot doors in the core's corridor wall (sliding, opened by an approaching pod). */
  exitX: -8,
  entryX: 8,
  doorWidth: 1.6,
  /** The rank runs along x = rankX from the entry door to |z| = rankHeadZ. */
  rankX: 8,
  rankHeadZ: 4,
  /** The dock lane runs along |z| = dockLaneZ in front of the MedVend face. */
  dockLaneZ: 2,
  /** Corner radius inside the core and at the doors. */
  coreTurnR: 1,
  doorTurnR: 0.7,
  /**
   * Pod body (x width, z length, y height) in metres. W2: the pods HANG from a ceiling rail that follows exactly these
   * circuit lines (the lanes are no longer on the floor): the body spans `podBottomY`..`podTopY`, so everybody walks
   * underneath (doors are WALL.doorHeight = 2.3 m).
   */
  podSize: { w: 0.5, l: 0.6, h: 0.5 },
  podBottomY: 2.3,
  podTopY: 2.8,
  /** The ceiling rail (W2): its underside, and where its hangers meet the ceiling. A small bogie runs between them. */
  rail: { undersideY: 2.95, hangerTopY: 3.0, width: 0.12, depth: 0.05 },
  podsPerWard: 5,
  compartments: 4,
} as const

export const CORE: Rect = { x0: -12, x1: 12, z0: -12, z1: 12 }

export const PHARMACY = {
  /** The MedVend island: a glass-sided dispensing wall, picker gantry inside, one face per ward. */
  island: { x0: -6, x1: 6, z0: -1.2, z1: 1.2, height: 3 } as Rect & { height: number },
  /** Dock ports in path order (the pod passes x=3 first, then x=-3). */
  docks: {
    A: [{ x: 3, z: -ROBOT.dockLaneZ }, { x: -3, z: -ROBOT.dockLaneZ }] as Vec2[],
    B: [{ x: 3, z: ROBOT.dockLaneZ }, { x: -3, z: ROBOT.dockLaneZ }] as Vec2[],
  },
  /** Gantry travel on each face. */
  gantry: { xMin: -5.6, xMax: 5.6, yMin: 0.35, yMax: 2.65 },
  /**
   * W2: the dock ports are at the TOP of each MedVend face (the pods hang from the rail beside it): the picker carriage
   * rises to this height and pushes each pack across a short transfer tray into the docked pod's side hatch.
   */
  dockPortY: 2.45,
  /** Bin grid per face: columns along x, rows along y. Both faces hold every medicine at the same slot (`Medicine.bin`). */
  bins: { columns: 12, rows: 6 },
  /** Pharmacist verify desk per ward, facing the island. */
  desk: {
    A: { spot: { x: 0, z: -7 } as Vec2, heading: 0 },
    B: { spot: { x: 0, z: 7 } as Vec2, heading: Math.PI },
  },
} as const

// ---------------------------------------------------------------------------------------------
// Doors (for people; robot doors are in ROBOT)
// ---------------------------------------------------------------------------------------------

export type DoorKind = 'auto' | 'swing' | 'opening' | 'counter'

export interface DoorSpec {
  id: string
  center: Vec2
  width: number
  /** The wall the door sits in runs along this axis ('x': walkers pass through along z). */
  wallAxis: 'x' | 'z'
  a: AreaId
  b: AreaId
  kind: DoorKind
}

// ---------------------------------------------------------------------------------------------
// Assembled contract
// ---------------------------------------------------------------------------------------------

export const ROOMS: RoomSpec[] = (['A', 'B'] as WardId[]).flatMap((w) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => buildRoom(w, n)))
export const ROOM_IDS: RoomId[] = ROOMS.map((r) => r.id)
const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]))

export function roomById(id: RoomId): RoomSpec {
  const r = ROOM_BY_ID.get(id)
  if (!r) throw new Error(`Unknown room ${id}`)
  return r
}

export const AREAS: Area[] = [
  { id: 'lobby', label: 'Entrance', subtitle: 'Self check-in and reception', rect: { x0: -62, x1: -44, z0: -6, z1: 6 }, kind: 'public', mapLabel: true },
  { id: 'triage', label: 'Triage', subtitle: 'Four assessment bays', rect: { x0: -62, x1: -44, z0: -22, z1: -6 }, kind: 'clinical', mapLabel: true },
  { id: 'er', label: 'Emergency', subtitle: 'Six treatment bays', rect: { x0: -62, x1: -44, z0: 6, z1: 22 }, kind: 'clinical', mapLabel: true },
  { id: 'spine', label: 'Main corridor', subtitle: 'Links the entrance to both wards', rect: { x0: -44, x1: -40, z0: -16, z1: 16 }, kind: 'public', mapLabel: false },
  { id: 'liftA', label: 'Lifts', subtitle: '', rect: { x0: -44, x1: -40, z0: -22, z1: -16 }, kind: 'service', mapLabel: false },
  { id: 'liftB', label: 'Lifts', subtitle: '', rect: { x0: -44, x1: -40, z0: 16, z1: 22 }, kind: 'service', mapLabel: false },
  // the imaging block (R1): a corridor with waiting seats, MRI and CT with control rooms north of it, X-ray,
  // ultrasound and blood draw south of it
  { id: 'imagingHall', label: 'Imaging', subtitle: 'MRI, CT, X-ray and ultrasound', rect: { x0: -40, x1: -22, z0: -2, z1: 2 }, kind: 'clinical', mapLabel: true },
  { id: 'mri', label: 'MRI', subtitle: 'Magnetic resonance imaging', rect: { x0: -40, x1: -31, z0: -12, z1: -4.5 }, kind: 'clinical', mapLabel: true },
  { id: 'mriControl', label: 'MRI control', subtitle: '', rect: { x0: -40, x1: -31, z0: -4.5, z1: -2 }, kind: 'staff', mapLabel: false },
  { id: 'ct', label: 'CT', subtitle: 'Computed tomography', rect: { x0: -31, x1: -22, z0: -12, z1: -4.5 }, kind: 'clinical', mapLabel: true },
  { id: 'ctControl', label: 'CT control', subtitle: '', rect: { x0: -31, x1: -22, z0: -4.5, z1: -2 }, kind: 'staff', mapLabel: false },
  { id: 'xray', label: 'X-ray', subtitle: 'Radiography', rect: { x0: -40, x1: -34, z0: 2, z1: 12 }, kind: 'clinical', mapLabel: true },
  { id: 'ultrasound', label: 'Ultrasound', subtitle: '', rect: { x0: -34, x1: -28, z0: 2, z1: 12 }, kind: 'clinical', mapLabel: true },
  { id: 'diagnostics', label: 'Blood draw centre', subtitle: 'Robot blood draws and changing cubicles', rect: { x0: -28, x1: -22, z0: 2, z1: 12 }, kind: 'clinical', mapLabel: true },
  { id: 'command', label: 'Command center', subtitle: 'Every pod, room and order, live', rect: { x0: -22, x1: -12, z0: -12, z1: 12 }, kind: 'staff', mapLabel: true },
  { id: 'core', label: 'Pharmacy core', subtitle: 'MedVend dispensing wall and MedPods', rect: CORE, kind: 'robot', mapLabel: true },
  { id: 'atrium', label: 'Healing atrium', subtitle: 'Garden, café and daylight', rect: { x0: 12, x1: 40, z0: -12, z1: 12 }, kind: 'public', mapLabel: true },
  { id: 'corridorA', label: 'Ward A corridor', subtitle: '', rect: corridorRect('A'), kind: 'public', ward: 'A', mapLabel: false },
  { id: 'corridorB', label: 'Ward B corridor', subtitle: '', rect: corridorRect('B'), kind: 'public', ward: 'B', mapLabel: false },
  { id: 'staffA', label: 'Staff room', subtitle: '', rect: wardRect('A', -40, -25), kind: 'staff', ward: 'A', mapLabel: false },
  { id: 'hubA', label: 'Nurse hub A', subtitle: '', rect: wardRect('A', -5, 5), kind: 'staff', ward: 'A', mapLabel: true },
  { id: 'loungeA', label: 'Family lounge', subtitle: '', rect: wardRect('A', 25, 40), kind: 'public', ward: 'A', mapLabel: false },
  { id: 'supplyB', label: 'Clean supply', subtitle: '', rect: wardRect('B', -40, -31), kind: 'service', ward: 'B', mapLabel: false },
  // W4: the automated lab, behind the blood-draw centre across corridor B (the pneumatic tube crosses the corridor overhead)
  { id: 'lab', label: 'Lab', subtitle: 'Automated sample track and analysers', rect: wardRect('B', -31, -25), kind: 'clinical', ward: 'B', mapLabel: true },
  { id: 'hubB', label: 'Nurse hub B', subtitle: '', rect: wardRect('B', -5, 5), kind: 'staff', ward: 'B', mapLabel: true },
  { id: 'quietB', label: 'Quiet room', subtitle: '', rect: wardRect('B', 25, 40), kind: 'public', ward: 'B', mapLabel: false },
  ...ROOMS.map(
    (r): Area => ({ id: `room:${r.id}`, label: `Room ${r.id}`, subtitle: '', rect: r.rect, kind: 'room', ward: r.ward, mapLabel: false }),
  ),
]

const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]))

export function areaById(id: AreaId): Area {
  const a = AREA_BY_ID.get(id)
  if (!a) throw new Error(`Unknown area ${id}`)
  return a
}

/** The area containing the point (rooms win over the bands they sit in; edges count as inside). */
export function areaAt(x: number, z: number): Area | null {
  let best: Area | null = null
  for (const a of AREAS) {
    const r = a.rect
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
      if (a.kind === 'room') return a
      best ??= a
    }
  }
  return best
}

export const DOORS: DoorSpec[] = [
  { id: 'entrance', center: { x: -62, z: 0 }, width: 3, wallAxis: 'z', a: 'lobby', b: 'lobby', kind: 'auto' },
  { id: 'lobby-spine', center: { x: -44, z: 0 }, width: 12, wallAxis: 'z', a: 'lobby', b: 'spine', kind: 'opening' },
  { id: 'triage', center: { x: -50, z: -6 }, width: 2, wallAxis: 'x', a: 'lobby', b: 'triage', kind: 'auto' },
  { id: 'er', center: { x: -50, z: 6 }, width: 2, wallAxis: 'x', a: 'lobby', b: 'er', kind: 'auto' },
  // ambulance entrance straight into the ER, in line with the parked ambulance outside
  { id: 'ambulance', center: { x: -62, z: 10.4 }, width: 2.4, wallAxis: 'z', a: 'er', b: 'er', kind: 'auto' },
  { id: 'spine-corridorA', center: { x: -40, z: -14 }, width: 4, wallAxis: 'z', a: 'spine', b: 'corridorA', kind: 'opening' },
  { id: 'spine-corridorB', center: { x: -40, z: 14 }, width: 4, wallAxis: 'z', a: 'spine', b: 'corridorB', kind: 'opening' },
  { id: 'liftA', center: { x: -42, z: -16 }, width: 1.6, wallAxis: 'x', a: 'spine', b: 'liftA', kind: 'auto' },
  { id: 'liftB', center: { x: -42, z: 16 }, width: 1.6, wallAxis: 'x', a: 'spine', b: 'liftB', kind: 'auto' },
  { id: 'imaging', center: { x: -40, z: 0 }, width: 2, wallAxis: 'z', a: 'spine', b: 'imagingHall', kind: 'auto' },
  // MRI and CT: patients pass through the control room (MRI zone III) into the scan room (zone IV)
  { id: 'mriControl', center: { x: -38.2, z: -2 }, width: 1.4, wallAxis: 'x', a: 'imagingHall', b: 'mriControl', kind: 'auto' },
  { id: 'mriRoom', center: { x: -32.4, z: -4.5 }, width: 1.4, wallAxis: 'x', a: 'mriControl', b: 'mri', kind: 'swing' },
  { id: 'ctControl', center: { x: -29.4, z: -2 }, width: 1.4, wallAxis: 'x', a: 'imagingHall', b: 'ctControl', kind: 'auto' },
  { id: 'ctRoom', center: { x: -23.6, z: -4.5 }, width: 1.6, wallAxis: 'x', a: 'ctControl', b: 'ct', kind: 'auto' },
  { id: 'xray', center: { x: -35.6, z: 2 }, width: 1.6, wallAxis: 'x', a: 'imagingHall', b: 'xray', kind: 'auto' },
  { id: 'ultrasound', center: { x: -32.6, z: 2 }, width: 1.2, wallAxis: 'x', a: 'imagingHall', b: 'ultrasound', kind: 'swing' },
  { id: 'bloodDraw', center: { x: -26.6, z: 2 }, width: 1.6, wallAxis: 'x', a: 'imagingHall', b: 'diagnostics', kind: 'auto' },
  { id: 'commandA', center: { x: -17, z: -12 }, width: 1.6, wallAxis: 'x', a: 'corridorA', b: 'command', kind: 'auto' },
  { id: 'commandB', center: { x: -17, z: 12 }, width: 1.6, wallAxis: 'x', a: 'corridorB', b: 'command', kind: 'auto' },
  { id: 'pharmacistA', center: { x: 0, z: -12 }, width: 1.2, wallAxis: 'x', a: 'corridorA', b: 'core', kind: 'auto' },
  { id: 'pharmacistB', center: { x: 0, z: 12 }, width: 1.2, wallAxis: 'x', a: 'corridorB', b: 'core', kind: 'auto' },
  { id: 'atriumA', center: { x: 34, z: -12 }, width: 8, wallAxis: 'x', a: 'corridorA', b: 'atrium', kind: 'opening' },
  { id: 'atriumB', center: { x: 34, z: 12 }, width: 8, wallAxis: 'x', a: 'corridorB', b: 'atrium', kind: 'opening' },
  { id: 'staffA', center: { x: -33, z: -16 }, width: 1.2, wallAxis: 'x', a: 'corridorA', b: 'staffA', kind: 'swing' },
  { id: 'loungeA', center: { x: 33, z: -16 }, width: 2, wallAxis: 'x', a: 'corridorA', b: 'loungeA', kind: 'opening' },
  { id: 'supplyB', center: { x: -33, z: 16 }, width: 1.2, wallAxis: 'x', a: 'corridorB', b: 'supplyB', kind: 'swing' },
  { id: 'lab', center: { x: -26.3, z: 16 }, width: 1.4, wallAxis: 'x', a: 'corridorB', b: 'lab', kind: 'swing' },
  { id: 'quietB', center: { x: 33, z: 16 }, width: 2, wallAxis: 'x', a: 'corridorB', b: 'quietB', kind: 'opening' },
  { id: 'hubA', center: { x: 0, z: -16 }, width: 2, wallAxis: 'x', a: 'corridorA', b: 'hubA', kind: 'counter' },
  { id: 'hubB', center: { x: 0, z: 16 }, width: 2, wallAxis: 'x', a: 'corridorB', b: 'hubB', kind: 'counter' },
  ...ROOMS.map(
    (r): DoorSpec => ({
      id: `room:${r.id}`,
      center: r.door,
      width: r.doorWidth,
      wallAxis: 'x',
      a: r.ward === 'A' ? 'corridorA' : 'corridorB',
      b: `room:${r.id}`,
      kind: 'swing',
    }),
  ),
]

// ---------------------------------------------------------------------------------------------
// Staff anchors
// ---------------------------------------------------------------------------------------------

export interface Spot {
  at: Vec2
  heading: number
}

/** Nurse hub work spots per ward (charting at the station). */
export const NURSE_HUB: Record<WardId, Spot[]> = {
  A: [
    { at: { x: -2.5, z: -18.6 }, heading: 0 },
    { at: { x: 2.5, z: -18.6 }, heading: 0 },
    { at: { x: 0, z: -20 }, heading: 0 },
  ],
  B: [
    { at: { x: -2.5, z: 18.6 }, heading: Math.PI },
    { at: { x: 2.5, z: 18.6 }, heading: Math.PI },
    { at: { x: 0, z: 20 }, heading: Math.PI },
  ],
}

/** Command center coordinator seats, facing the live wall on the west side. */
export const COMMAND_SEATS: Spot[] = [-6, -2, 2, 6].map((z) => ({ at: { x: -17.6, z }, heading: -Math.PI / 2 }))
export const COMMAND_WALL = { x: -21.6, z0: -9, z1: 9, height: 2.6 } as const

// ---------------------------------------------------------------------------------------------
// Imaging (R1): one scanner per modality. The building, the sim and the animated machines all read these.
// ---------------------------------------------------------------------------------------------

export type ImagingModalityId = 'mri' | 'ct' | 'xray' | 'us'

export interface ScannerAnchors {
  modality: ImagingModalityId
  /** The scan room. */
  area: AreaId
  /** The control room (MRI, CT) or the room itself (X-ray booth, ultrasound). */
  controlArea: AreaId
  /**
   * The patient on the table or couch: lying, centre of the body, head toward `heading`'s back (the crowd convention:
   * the head is behind the centre). `out` is where they get on; `in` is the scan position (MRI and CT: in the bore).
   */
  table: { out: Vec2; in: Vec2; heading: number; height: number }
  /** MRI magnet or CT gantry centre (bore axis along x); X-ray tube park position; ultrasound cart. */
  machine: Vec2
  /** Where the radiographer or sonographer works (sitting at the console, standing at the booth, on the stool). */
  operator: Spot
  /** Where staff stand to help the patient on and off the table. */
  assist: Spot
}

export const IMAGING: Record<ImagingModalityId, ScannerAnchors> = {
  mri: {
    modality: 'mri',
    area: 'mri',
    controlArea: 'mriControl',
    // head first into the bore: the patient faces up, head east (toward the magnet)
    table: { out: { x: -37.6, z: -8.6 }, in: { x: -34.1, z: -8.6 }, heading: -Math.PI / 2, height: 0.78 },
    machine: { x: -34.0, z: -8.6 },
    operator: { at: { x: -36.6, z: -3.35 }, heading: Math.PI },
    assist: { at: { x: -37.6, z: -7.1 }, heading: Math.PI },
  },
  ct: {
    modality: 'ct',
    area: 'ct',
    controlArea: 'ctControl',
    table: { out: { x: -28.4, z: -8.6 }, in: { x: -25.6, z: -8.6 }, heading: -Math.PI / 2, height: 0.8 },
    machine: { x: -25.4, z: -8.6 },
    operator: { at: { x: -27.6, z: -3.35 }, heading: Math.PI },
    assist: { at: { x: -28.4, z: -7.1 }, heading: Math.PI },
  },
  xray: {
    modality: 'xray',
    area: 'xray',
    controlArea: 'xray',
    // the table runs north-south; the ceiling tube rides a rail above it; the wall detector is on the west wall
    table: { out: { x: -37.4, z: 8.4 }, in: { x: -37.4, z: 8.4 }, heading: Math.PI, height: 0.75 },
    machine: { x: -37.4, z: 6.0 },
    operator: { at: { x: -35.0, z: 3.4 }, heading: -Math.PI / 2 },
    assist: { at: { x: -36.2, z: 8.4 }, heading: -Math.PI / 2 },
  },
  us: {
    modality: 'us',
    area: 'ultrasound',
    controlArea: 'ultrasound',
    table: { out: { x: -31.6, z: 8.6 }, in: { x: -31.6, z: 8.6 }, heading: Math.PI, height: 0.7 },
    machine: { x: -29.6, z: 9.8 },
    // the sonographer sits on a stool at the patient's right, facing them
    operator: { at: { x: -30.3, z: 8.4 }, heading: -Math.PI / 2 },
    assist: { at: { x: -30.3, z: 8.4 }, heading: -Math.PI / 2 },
  },
}

/**
 * Where people appear and disappear (they fade in and out on the spot, so the building needs no outside paths):
 * walk-ins and visitors through the main entrance, ambulance patients through the ER's ambulance door, and
 * patients admitted from the ER leave in the lifts "to the wards upstairs".
 */
export const ARRIVALS = {
  entrance: { at: { x: -60.8, z: 0 }, heading: Math.PI / 2 } as Spot,
  ambulance: { at: { x: -60.8, z: 10.4 }, heading: Math.PI / 2 } as Spot,
} as const
export const DEPARTURES = {
  entrance: { x: -60.8, z: 0 } as Vec2,
  /** Standing spots inside each lift lobby. */
  lifts: [{ x: -42, z: -19 }, { x: -42, z: 19 }] as Vec2[],
} as const

/**
 * How far ahead of the person pushing a vehicle its rider sits (metres, along the pusher's heading), by vehicle.
 * The crowd renderer draws the vehicle and the rider there, so the sim must place riders at the same offset.
 * A stretcher is long: its head-end handle is 0.4 m in front of the porter, so its centre is 1.45 m ahead.
 */
export const VEHICLE_AHEAD: Record<VehicleKind, number> = { none: 0, wheelchair: 0.8, stretcher: 1.45, cleaningCart: 0.8, linenCart: 0.8 }

/**
 * W3: each vehicle's floor footprint as [half width across, half length along the pusher's heading] (metres), centred VEHICLE_AHEAD in front
 * of the pusher. Your body cannot pass through it. The same numbers as the crowd's drawn footprint (actors/crowd/gear.ts VEHICLE_FOOTPRINT).
 */
export const VEHICLE_HALF: Record<VehicleKind, readonly [number, number]> = {
  none: [0, 0],
  wheelchair: [0.36, 0.5],
  stretcher: [0.4, 1.05],
  cleaningCart: [0.33, 0.5],
  linenCart: [0.36, 0.5],
}

export const LOBBY = {
  entrance: { x: -61, z: 0 } as Vec2,
  reception: { at: { x: -52, z: -3 }, heading: Math.PI / 2 } as Spot,
  kiosks: [{ x: -57, z: 3 }, { x: -55, z: 3 }] as Vec2[],
} as const

/** Doctors' office: where doctors start and return between rounds (the staff room on ward A). */
export const DOCTORS_BASE: Spot = { at: { x: -33, z: -19 }, heading: 0 }

export const ATRIUM = {
  garden: { x: 22, z: 0 } as Vec2,
  cafe: { at: { x: 34, z: 3 }, heading: Math.PI / 2 } as Spot,
} as const

// ---------------------------------------------------------------------------------------------
// Living day & bed flow (L1). See docs/L1-LIVING-DAY.md.
// ---------------------------------------------------------------------------------------------

/**
 * Where a MealBot fades in and out: inside each ward's lift lobby on its west side, facing the lift door to the spine, so
 * it is out of the way of the porters' stretchers at the lift standing spots (DEPARTURES.lifts, x = -42).
 */
export const SERVICE_LIFT: Record<WardId, Spot> = {
  A: { at: { x: -43.2, z: -20.4 }, heading: 0 },
  B: { at: { x: -43.2, z: 20.4 }, heading: Math.PI },
}

/** A MealBot's footprint (x width across its heading, l length along it, h height), metres. */
export const MEALBOT_SIZE = { w: 0.6, l: 1.1, h: 1.25 } as const

/**
 * Meal stops: one per pair of neighbouring rooms, on the room side of the corridor half way between the two doors.
 * Each stop is clear of both room doors (door.x ± 1.0) and of the corridor centre line people walk on (|z| = 14).
 * The bot parks heading east; the host walks to each room's door. (W2: the pods are overhead, so no lane to keep off.)
 */
export interface MealStop {
  id: string
  ward: WardId
  rooms: [RoomId, RoomId]
  at: Vec2
  heading: number
}

export const MEAL_STOPS: MealStop[] = (['A', 'B'] as WardId[]).flatMap((w) =>
  [1, 3, 5, 7].map((n): MealStop => ({
    id: `meal:${w}${n}`,
    ward: w,
    rooms: [`${w}${n}`, `${w}${n + 1}`],
    at: { x: ROOM_X0[n - 1] + 3.6, z: wardSign(w) * 14.65 },
    heading: Math.PI / 2,
  })),
)

/**
 * Bedside handover (L1 shift change): the outgoing and incoming nurse stand on the door side of the bed, facing it,
 * with the patient. Both spots are inside the room, so no handover ever stands in a doorway.
 * The night nurse's quiet check uses `RoomSpec.doorInside`.
 */
export const HANDOVER: Record<RoomId, [Spot, Spot]> = Object.fromEntries(
  ROOMS.map((r) => {
    const s = wardSign(r.ward)
    const x = r.rect.x0 + 2.2
    return [r.id, [{ at: { x, z: s * 17.6 }, heading: Math.PI / 2 }, { at: { x, z: s * 18.7 }, heading: Math.PI / 2 }]]
  }),
)

/** Staff room (ward A): where staff change at the lockers at the start and end of a shift, facing the lockers. */
export const STAFF_ROOM = {
  door: { x: -33, z: -16 } as Vec2,
  lockers: [-39, -38, -37].map((x): Spot => ({ at: { x, z: -20.75 }, heading: Math.PI })),
} as const

// ---------------------------------------------------------------------------------------------
// Walk-in (W1). See docs/W1-WALK-IN.md.
// ---------------------------------------------------------------------------------------------

/** Where you start: outside the main entrance, facing the doors. */
export const PLAYER_SPAWN: Spot = { at: { x: -66, z: 0 }, heading: Math.PI / 2 }

/**
 * The paved apron in front of the main entrance. Only you walk here (the people of the sim appear and leave at the
 * entrance), so it is NOT part of the people's nav layout: the player's collision adds it to `isWalkable`.
 */
export const PLAYER_PLAZA: Rect = { x0: -74, x1: -62, z0: -9, z1: 9 }

/**
 * Ceiling height per area in walk mode (metres; the overview never draws ceilings). Default WALL.height. `null`: open to
 * the sky through a glass roof (the healing atrium keeps its daylight).
 */
export function ceilingHeight(area: AreaId): number | null {
  if (area === 'atrium') return null
  return WALL.height
}

/**
 * Hanging wayfinding signs at eye level (walk mode): a two-sided panel hanging across the walking line at `at`.
 * `heading` is the panel's facing direction (one face looks along it, the other the opposite way); the builder works
 * out each face's arrows from the geometry, so both faces read correctly. The words come from src/content/signs.json
 * (keyed by `id`); `points` says which areas it points to.
 */
export interface SignAnchor {
  id: string
  at: Vec2
  heading: number
  points: AreaId[]
}

export const SIGNS: SignAnchor[] = [
  // from the lobby into the main corridor
  { id: 'lobby-east', at: { x: -45.5, z: 0 }, heading: -Math.PI / 2, points: ['corridorA', 'corridorB', 'imagingHall'] },
  // at the main corridor's ends, before each ward
  { id: 'spine-north', at: { x: -42, z: -12.5 }, heading: Math.PI, points: ['corridorA', 'liftA'] },
  { id: 'spine-south', at: { x: -42, z: 12.5 }, heading: 0, points: ['corridorB', 'liftB'] },
  // inside each ward corridor, near its west end and near the atrium
  { id: 'wardA-west', at: { x: -36, z: -14 }, heading: -Math.PI / 2, points: ['hubA', 'core', 'atrium'] },
  { id: 'wardB-west', at: { x: -36, z: 14 }, heading: -Math.PI / 2, points: ['hubB', 'core', 'atrium'] },
  { id: 'wardA-east', at: { x: 30, z: -14 }, heading: Math.PI / 2, points: ['hubA', 'command', 'lobby'] },
  { id: 'wardB-east', at: { x: 30, z: 14 }, heading: Math.PI / 2, points: ['hubB', 'command', 'lobby'] },
]

// ---------------------------------------------------------------------------------------------
// Ceiling rail (W2). See docs/W2-CEILING-RAIL.md.
// ---------------------------------------------------------------------------------------------

/**
 * Per room: the slim glass chute on the corridor face of the wall above the MedDrawer. A pod docked on the rail at
 * `room.podDock` (overhead) drops the packs into a funnel that folds out from the wall under it; they slide down the
 * chute into the top of the drawer cabinet (at WALL.cutHeight). `x`/`z` is the chute's centre line on the wall face.
 */
export interface DrawerChute {
  roomId: RoomId
  x: number
  z: number
  topY: number
  bottomY: number
  /** Where the funnel reaches out to, under the docked pod (= room.podDock). */
  funnelTo: Vec2
}

export const DRAWER_CHUTES: DrawerChute[] = ROOMS.map((r) => {
  const s = wardSign(r.ward)
  return {
    roomId: r.id,
    x: r.drawer.x,
    // on the corridor face of the room wall, a little proud of it
    z: s * (BANDS.roomWall - WALL.thickness / 2 - 0.09),
    topY: ROBOT.podBottomY - 0.05,
    bottomY: WALL.cutHeight,
    funnelTo: r.podDock,
  }
})

// ---------------------------------------------------------------------------------------------
// Smart diagnostics (W4): entrance health kiosks, the robot blood-draw centre, the pneumatic tube and the automated lab.
// See docs/W4-DIAGNOSTICS.md. Builders (scene) and services (sim) read these; the layout tests are the judge of clearances.
// ---------------------------------------------------------------------------------------------

/** One health kiosk (China 健康一体机): a tower against the lobby's south wall with a weighing platform in front, and a blood-pressure wing with a stool beside it. */
export interface HealthKioskAnchor {
  index: number
  /** Tower centre on the floor; it is 0.56 wide (x) and 0.42 deep (z), its screen faces -z (north, into the lobby). */
  tower: Vec2
  /** The platform's centre: where you stand facing the tower (heading 0, +z). */
  stand: Spot
  /** The BP wing's desk centre (0.50 wide, 0.48 deep); the arm tunnel's mouth faces the stool (the crowd's ARM_IN line, src/scene/actors/crowd/armIn.ts). */
  wing: Vec2
  /** The stool in front of the wing (seat 'kioskBp:<i>', height 0.45 like every plain seat), facing the wing (heading 0). */
  bpSeat: Spot
}
export const HEALTH_KIOSKS: HealthKioskAnchor[] = [-53.95, -52.35].map((x, index) => ({
  index,
  tower: { x, z: 5.45 },
  stand: { at: { x, z: 4.98 }, heading: 0 },
  wing: { x: x + 0.6, z: 5.36 },
  bpSeat: { at: { x: x + 0.6, z: 4.62 }, heading: 0 },
}))
/** One shared line for both kiosks: the front spot, then back along -z (north) at `pitch`. */
export const HEALTH_LINE = { front: { x: -53.15, z: 3.7 } as Vec2, pitch: 0.8, heading: 0, capacity: 4 }
/** Where the kiosk guide stands between helping elderly users. */
export const HEALTH_GUIDE: Spot = { at: { x: -51.0, z: 3.9 }, heading: -Math.PI / 2 }

/** One robot blood-draw station: the cabinet against the corridor wall, the patient chair in front, facing it. */
export interface DrawRobotAnchor {
  index: number
  /** Cabinet centre on the floor; 0.82 wide (x), 0.62 deep (z); its enclosed arm tunnel reaches 0.4 m out towards the chair. */
  cabinet: Vec2
  /** The patient chair (seat 'drawChair:robot:<i>', height 0.45), facing the cabinet (heading 0, +z). */
  chair: Spot
  /** Where the supervising nurse stands to help or draw by hand (the patient's right side). */
  assist: Spot
  /** The tube riser from the cabinet up to the pneumatic trunk (x, z on the floor). */
  riser: Vec2
}
export const DRAW_CENTRE = {
  robots: [-26.9, -25.2, -23.5].map(
    (x, index): DrawRobotAnchor => ({
      index,
      cabinet: { x, z: 11.43 },
      chair: { at: { x, z: 10.25 }, heading: 0 },
      assist: { at: { x: x - 0.6, z: 10.3 }, heading: Math.PI / 2 },
      riser: { x: x - 0.25, z: 11.78 },
    }),
  ),
  /** The tube-prep machine (BC-ROBO-like, 0.60 wide along the wall, 0.755 deep) against the west wall, facing east; its tray outlet, and where the nurse takes the tray. */
  prep: {
    center: { x: -27.5225, z: 6.45 } as Vec2,
    heading: Math.PI / 2,
    tray: { x: -27.15, y: 0.95, z: 6.45 } as Vec3,
    nurse: { at: { x: -26.6, z: 6.45 }, heading: -Math.PI / 2 } as Spot,
    /** The tube kind in each of the 8 bins (the colour the gripper goes to): `TubePrepState.bin` indexes this. */
    bins: ['citrate', 'serum', 'serum', 'heparin', 'EDTA', 'EDTA', 'fluoride', 'serum'] as readonly TubeKind[],
  },
  /** Waiting bench seats along the west wall, facing east ('waiting:draw:<i>'). */
  bench: [7.7, 8.35, 9.0].map((z): Spot => ({ at: { x: -27.55, z }, heading: Math.PI / 2 })),
  /** The check-in kiosk inside the door (ticket printer): device and the guest spot in front of it. */
  checkIn: { device: { x: -24.6, z: 2.35 } as Vec2, guest: { at: { x: -24.6, z: 3.0 }, heading: Math.PI } as Spot, capacity: 2 },
  /** The queue screen above the door, facing into the room. */
  queueScreen: { x: -26.6, y: 2.55, z: 2.12, heading: 0 },
  /** Standing spots in the imaging hall by the door when the bench is full. */
  overflow: [
    { x: -25.0, z: 1.15 },
    { x: -24.2, z: 1.15 },
    { x: -23.4, z: 1.15 },
  ] as Vec2[],
  /** The supervising nurse's watch spot, facing the three robots. */
  nurse: { at: { x: -25.1, z: 8.6 }, heading: 0 } as Spot,
  /** A wall send station at the east end for tubes the nurse drew by hand. */
  manualSend: { x: -22.42, z: 11.66 } as Vec2,
  /** The changing cubicles on the east wall (MRI patients change here): the spot inside, the approach outside. */
  cubicles: [4.6, 6.0, 7.4].map((z) => ({ at: { x: -22.8, z } as Vec2, approach: { x: -24.0, z } as Vec2, heading: Math.PI / 2 })),
} as const

/**
 * The single-tube pneumatic line (no carrier: the tube itself flies, about 10 m/s). A clear trunk under the ceiling (centre 2.85 m) along the
 * draw room's south wall, through that wall at x -27.8, west along corridor B's north wall, across the corridor at x -29.9 (0.72 m and more
 * from the ward-B pod rail's U-turn; the rule is 0.45 m) and down into the lab's receive station. Each robot (and the manual send station)
 * joins it with a riser. Paths and the flight profile: src/sim/pneumaticPath.ts.
 */
export const PNEUMATIC = {
  outerDiameter: 0.063,
  y: 2.85,
  trunk: [
    { x: -22.42, y: 2.85, z: 11.78 },
    { x: -27.8, y: 2.85, z: 11.78 },
    { x: -27.8, y: 2.85, z: 12.15 },
    { x: -29.9, y: 2.85, z: 12.15 },
    { x: -29.9, y: 2.85, z: 16.5 },
    { x: -29.9, y: 1.45, z: 16.5 },
  ] as Vec3[],
  /** Riser bottoms: robots 0..2 (out of the cabinet top), then the manual send station (index 3). */
  sources: [
    { x: -27.15, y: 1.05, z: 11.78 },
    { x: -25.45, y: 1.05, z: 11.78 },
    { x: -23.75, y: 1.05, z: 11.78 },
    { x: -22.42, y: 1.65, z: 11.78 },
  ] as Vec3[],
  profile: { vMax: 10, accel: 20, decel: 25 },
} as const

export type LabModuleKind = 'receive' | 'camera' | 'centrifuge' | 'decapper' | 'haematology' | 'chemistry' | 'immunoassay' | 'coagulation' | 'recapper' | 'archive'
/** A module on the outer side of the lab track: its id, kind, footprint centre and size (along the track, across it), and its stop on the track (`at`, the point beside it). */
export interface LabModuleAnchor {
  id: string
  kind: LabModuleKind
  center: Vec2
  along: number
  across: number
  at: Vec2
}
/**
 * The automated lab. A one-way U track on a 0.86 m bench (outbound lane on the module side, return lane inside, 0.12 apart, turntables at both
 * ends): west leg x -30.0 (z 16.95 -> 20.7), south leg z 21.0 (x -29.7 -> -26.25), east leg x -25.95 (z 20.7 -> 18.4), arcs r 0.3. The
 * modules sit on the outer side, in sample order. Paths and stops: src/sim/labTrack.ts.
 */
export const LAB = {
  benchY: 0.86,
  laneGap: 0.12,
  /** The U's centre line, in order. */
  track: [
    { x: -30.0, z: 16.95 },
    { x: -30.0, z: 20.7 },
    { x: -29.7, z: 21.0 },
    { x: -26.25, z: 21.0 },
    { x: -25.95, z: 20.7 },
    { x: -25.95, z: 18.4 },
  ] as Vec2[],
  turnRadius: 0.3,
  /** The pneumatic receive station and sorter, where the trunk drops in. */
  receive: { x: -29.9, z: 16.5 } as Vec2,
  modules: [
    { id: 'camera', kind: 'camera', center: { x: -30.0, z: 17.35 }, along: 0.3, across: 0.35, at: { x: -30.0, z: 17.35 } },
    { id: 'cfg0', kind: 'centrifuge', center: { x: -30.6, z: 17.95 }, along: 0.7, across: 0.7, at: { x: -30.0, z: 17.95 } },
    { id: 'cfg1', kind: 'centrifuge', center: { x: -30.6, z: 18.75 }, along: 0.7, across: 0.7, at: { x: -30.0, z: 18.75 } },
    { id: 'decap', kind: 'decapper', center: { x: -30.55, z: 19.45 }, along: 0.5, across: 0.6, at: { x: -30.0, z: 19.45 } },
    { id: 'haem', kind: 'haematology', center: { x: -29.25, z: 21.5 }, along: 0.85, across: 0.75, at: { x: -29.25, z: 21.0 } },
    { id: 'chem', kind: 'chemistry', center: { x: -28.05, z: 21.5 }, along: 1.45, across: 0.75, at: { x: -28.05, z: 21.0 } },
    { id: 'immuno', kind: 'immunoassay', center: { x: -26.8, z: 21.5 }, along: 0.95, across: 0.75, at: { x: -26.8, z: 21.0 } },
    { id: 'coag', kind: 'coagulation', center: { x: -25.5, z: 20.1 }, along: 0.6, across: 0.7, at: { x: -25.95, z: 20.1 } },
    { id: 'recap', kind: 'recapper', center: { x: -25.5, z: 19.4 }, along: 0.45, across: 0.6, at: { x: -25.95, z: 19.4 } },
    { id: 'archive', kind: 'archive', center: { x: -25.5, z: 18.75 }, along: 0.7, across: 0.7, at: { x: -25.95, z: 18.75 } },
  ] as LabModuleAnchor[],
  /** The review terminal inside the U, and the scientist's spots. */
  terminal: { at: { x: -28.0, z: 19.3 }, heading: Math.PI / 2 } as Spot,
  tech: [
    { at: { x: -28.0, z: 19.3 }, heading: Math.PI / 2 },
    { at: { x: -29.05, z: 18.1 }, heading: -Math.PI / 2 },
  ] as Spot[],
  statusTotem: { x: -28.1, z: 16.45 } as Vec2,
  /** Where you stand in corridor B to look in (E). */
  viewpoint: { x: -28.0, z: 15.4 } as Vec2,
} as const
