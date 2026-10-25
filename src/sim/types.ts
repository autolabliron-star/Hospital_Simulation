/**
 * Shared contracts for The Ideal Hospital. Every module (sim, scene, ui, content) imports from here.
 * Owned by the orchestrator: other agents ask for changes under "Change requests".
 *
 * Coordinates: metres, x east, z south (north = -z), y up. Headings: atan2(dx, dz), so heading 0 faces +z.
 */

export type Vec3 = { x: number; y: number; z: number }
export interface Vec2 {
  x: number
  z: number
}

// ---------------------------------------------------------------------------------------------
// Wards and rooms
// ---------------------------------------------------------------------------------------------

/** Ward A is the north wing (z < 0), ward B the south wing (z > 0). */
export type WardId = 'A' | 'B'
export const WARDS: readonly WardId[] = ['A', 'B'] as const

/** "A1" … "A8", "B1" … "B8". */
export type RoomId = string

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

export type Role =
  | 'patient'
  | 'visitor'
  | 'doctor'
  | 'nurse'
  | 'pharmacist'
  | 'porter'
  | 'cleaner'
  | 'receptionist'
  | 'coordinator'
  | 'paramedic'
  /** MRI, CT and X-ray technologist. */
  | 'radiographer'
  | 'sonographer'
  /** Ward host (L1): hospitality staff who serve meals with the MealBot. */
  | 'host'
  /** W4: works the automated lab (review terminal, reagent loading). */
  | 'labScientist'

export type Mood = 'neutral' | 'happy' | 'waiting' | 'unwell'

/** Icon over a head (one atlas cell each). */
export type Emote = 'none' | 'tablet' | 'pill' | 'hourglass' | 'bed' | 'check' | 'scan' | 'heart' | 'question' | 'coffee' | 'meal'

export type AnimState = 'idle' | 'walk' | 'run' | 'talk' | 'sit' | 'lie' | 'tablet' | 'give' | 'carry' | 'wave' | 'push' | 'clean'
  /** W4 health kiosk: both hands on the body-fat grips (standing). */
  | 'grip'
  /** W4: one finger forward (touch screen, SpO2 clip; standing). */
  | 'finger'
  /** W4: seated with the left arm forward into a cuff or robot tunnel (the crowd's ARM_IN line). */
  | 'armIn'
  /** R2: seated at a surgeon console: head in the viewer, both hands forward on the hand controllers. */
  | 'console'

/** Something small held in the hand (drawn by the crowd renderer). */
export type PropKind = 'none' | 'tablet' | 'folder' | 'tray' | 'coffee' | 'bag' | 'flowers'

/**
 * Something wheeled. A porter or paramedic *pushes* a wheelchair or stretcher (`vehicle` set, `riding` false); the
 * patient on it has the same `vehicle` with `riding: true` and is placed by the sim on the vehicle. Cleaners push
 * their cart; porters push linen carts.
 */
export type VehicleKind = 'none' | 'wheelchair' | 'stretcher' | 'cleaningCart' | 'linenCart'

/** Clothing: ward inpatients wear gowns; ER arrivals and visitors wear everyday clothes; staff dress by role. */
export type Outfit =
  | 'role'
  | 'gown'
  | 'everyday'
  /** R2: theatre scrubs and a cap (everyone on level 2's clinical side; you, behind the lift cover). */
  | 'theatre'

/** `recline` (L1): lying in a ward bed with the bed head raised (meals, visitors); see RoomStatus.recline. */
export type SeatPose = 'sit' | 'lie' | 'recline'

export type SeatKind =
  | 'waiting' // lobby and ER waiting rows
  | 'visitor' // the visitor chair in a patient room
  | 'cafe'
  | 'bench'
  | 'lounge' // sofas and armchairs in the lounges, quiet room and staff room
  | 'command'
  | 'triageBay' // the patient's chair or couch in a triage bay
  | 'erBay' // the trolley bed in an ER bay (pose 'lie')
  | 'bed' // a ward bed
  | 'scanTable' // MRI / CT table at its loading (out) position (pose 'lie')
  | 'xrayTable' // pose 'lie'
  | 'usCouch' // ultrasound couch (pose 'lie')
  | 'drawChair' // blood-draw chair (pose 'sit'); W4: the robot chairs are 'drawChair:robot:<i>'
  | 'kioskBp' // W4: the stool at a health kiosk's blood-pressure wing (pose 'sit')
  | 'console' // radiographer / sonographer seat (pose 'sit'); R2: the surgeon and teaching consoles are 'console:or:<surgeon|teach>'
  | 'orTable' // R2: the OR table (pose 'lie', head north): 'orTable:0'
  | 'surgeryBed' // R2: a pre-op or recovery trolley bed (pose 'lie'): 'surgeryBed:preop:<i>', 'surgeryBed:pacu:<i>'

/** A place to sit or lie, exported by the building layout (src/scene/building/layout) and used by the sim. */
export interface SeatSpec {
  id: string
  kind: SeatKind
  /** The area it is in (an AreaId from places.ts). */
  area: string
  /** Where the body sits (hip) or lies (centre), and which way it faces. */
  x: number
  z: number
  heading: number
  pose: SeatPose
  /** Seat or mattress height (m). */
  height: number
  /** A walkable spot in front of the seat where the person stands before sitting down. */
  approach: Vec2
}

/** Simulation level of detail. */
export type SimTier = 'near' | 'mid' | 'far'

export interface Entity {
  id: string
  role: Role
  name: string
  /** Written by the sim (interpolated between fixed steps). y comes from groundHeightAt. */
  position: Vec3
  heading: number
  /** m/s, drives the gait. */
  speed: number
  anim: AnimState
  emote: Emote
  mood: Mood
  tier: SimTier
  /** Deterministic per-person variety: outfit, height, idle offset. */
  variant: number
  /** Patient pathway stage, for the inspect card. */
  stage?: string
  /** The room a patient lies in, or the room a staff member is working in right now. */
  roomId?: RoomId
  seated?: { seatId: string; pose: SeatPose }
  lookAt?: Vec3 | null
  /** Clothing class (default 'role'). */
  outfit?: Outfit
  prop?: PropKind
  vehicle?: VehicleKind
  /** True for the person sitting or lying on the vehicle; false or absent for the one pushing it. */
  riding?: boolean
  /** 0..1 visibility: people fade in where they arrive and fade out where they leave (never pop). Default 1. */
  fade?: number
}

// ---------------------------------------------------------------------------------------------
// Medicines and orders
// ---------------------------------------------------------------------------------------------

export type MedicineForm = 'tablet' | 'capsule' | 'sachet' | 'oral solution' | 'inhaler' | 'patch' | 'drops'

/** One entry of the fixed demo catalogue (src/content/medicines.json). Display data only: no clinical rules. */
export interface Medicine {
  id: string
  /** Generic name, e.g. "Paracetamol". */
  name: string
  /** Unit-dose strength, e.g. "500 mg". */
  strength: string
  form: MedicineForm
  /** Pack colour on the dispensing wall and in the pod (hex). */
  color: string
  /** Bin slot on the dispensing wall (0-based, unique). */
  bin: number
}

/** Synthetic inpatient (src/content/patients.json). */
export interface PatientRecord {
  id: string
  /** Obviously synthetic name. */
  name: string
  age: number
  roomId: RoomId
  /** Plain-language reason for the stay, e.g. "Recovering after knee surgery". */
  reason: string
  /** Catalogue ids the doctor usually prescribes on rounds (the sim picks a few per order). */
  usualMeds: string[]
}

export interface OrderItem {
  medId: string
  qty: number
}

/** The order rail, in order. */
export type OrderStage = 'prescribed' | 'verified' | 'picking' | 'enRoute' | 'inDrawer' | 'given'
export const ORDER_STAGES: readonly OrderStage[] = ['prescribed', 'verified', 'picking', 'enRoute', 'inDrawer', 'given'] as const

export interface Order {
  id: string
  ward: WardId
  roomId: RoomId
  patientId: string
  items: OrderItem[]
  prescriberId: string
  /**
   * 'sim' orders come from doctors' rounds; 'presenter' orders from the live prescribing panel; 'schedule' orders
   * from the fixed dose waves (L1); 'discharge' orders are the take-home medicines of a patient going home (L1).
   */
  source: 'sim' | 'presenter' | 'schedule' | 'discharge'
  /** Sim time the order was written. */
  createdAt: number
  /** Sim time the dose is due; the nurse is sent when the drawer is loaded and this is near. */
  doseAt: number
  stage: OrderStage
  /** Sim time each stage was reached (KPIs come from here and from the event log). */
  stageAt: Partial<Record<OrderStage, number>>
  podId?: string
  /** Sim time the order was cancelled because its patient left the room before it was picked (L1). */
  cancelledAt?: number
}

// ---------------------------------------------------------------------------------------------
// Robots (MedPods), the dispensing wall and drawers
// ---------------------------------------------------------------------------------------------

export type PodState =
  | 'charging' //   waiting in the rank (charging pads), no order
  | 'toDock' //     order assigned, driving to a free dock port
  | 'loading' //    docked, the picker drops packs in
  | 'enRoute' //    sealed, driving to the room's drawer
  | 'delivering' // docked at the drawer, transferring packs
  | 'returning' //  empty, driving back to the rank

/** Light ring colour: teal = carrying medicine, amber = held up behind the pod ahead on the rail, green = just delivered, white = idle. */
export type PodLight = 'white' | 'teal' | 'amber' | 'green'

export interface Pod {
  id: string
  ward: WardId
  /** Arc length along the ward's robot circuit (metres). The circuit is one closed one-way loop. */
  s: number
  position: Vec3
  heading: number
  speed: number
  state: PodState
  light: PodLight
  orderId?: string
  /** One medicine id (or null) per locked compartment. */
  compartments: (string | null)[]
  /** Why the pod is stopped, if it is: shown in the inspect card. */
  waitingFor: 'pod' | 'dock' | 'drawer' | null
  /** 0..1, drains while driving and recharges in the rank. */
  battery: number
}

export type GantryState = 'idle' | 'toBin' | 'picking' | 'toPort' | 'dropping'

/** The picker carriage on one face of the dispensing wall (face A serves ward A, face B serves ward B). */
export interface Gantry {
  ward: WardId
  state: GantryState
  /** Carriage position along the wall (x, world) and height (y, world). */
  x: number
  y: number
  orderId?: string
  /** Index into the order's items of the pack being handled. */
  itemIndex: number
  /** Which dock port (index into PHARMACY.docks[ward]) the order is loading at. */
  port: number
  /** Seconds left in the current timed state. */
  timer: number
}

export type DrawerState = 'empty' | 'loaded'

export interface Drawer {
  roomId: RoomId
  state: DrawerState
  /** Orders whose packs are in the drawer (only ever this room's patient). */
  orderIds: string[]
  items: OrderItem[]
  /** Sim time the first pack went in. */
  loadedAt?: number
  /** Room-side light: on when the dose is due. */
  lightOn: boolean
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

export type SimEventType =
  | 'orderCreated'
  | 'orderVerified'
  | 'podAssigned'
  | 'podDocked'
  | 'itemPicked'
  | 'podDeparted'
  | 'podArrived'
  | 'drawerLoaded'
  | 'podReturned'
  | 'nurseNotified'
  | 'medsGiven'
  // the ER pathway (M3)
  | 'patientArrived'
  | 'checkedIn'
  | 'triaged'
  | 'seenByDoctor'
  | 'testsOrdered'
  | 'resultsBack'
  | 'discharged'
  | 'admitted'
  | 'leftWithoutBeingSeen'
  // the rest of the hospital (M3)
  | 'visitorArrived'
  | 'visitorLeft'
  | 'porterJob'
  | 'bayCleaned'
  // imaging (R1)
  | 'outpatientArrived'
  | 'scanStarted'
  | 'scanSequence'
  | 'scanDone'
  | 'reportReady'
  // living day & bed flow (L1)
  | 'dischargeSigned'
  | 'wentHome'
  | 'roomCleaned'
  | 'bedAssigned'
  | 'patientBoarding'
  | 'admittedToWard'
  | 'huddle'
  | 'shiftHandover'
  | 'mealServed'
  | 'trayCollected'
  | 'doseWave'
  // walk-in (W1): you, the doctor
  | 'youPrescribed'
  | 'talkedTo'
  // smart diagnostics (W4): health kiosks, robot blood draws, the automated lab
  | 'healthCheck'
  | 'drawTicket'
  | 'drawCalled'
  | 'bloodDrawn'
  | 'drawByNurse'
  | 'samplesSent'
  | 'samplesReceived'
  | 'labResults'
  // robotic surgery on level 2 (R2)
  | 'surgeryArrived'
  | 'preOpReady'
  | 'theatreIn'
  | 'robotDocked'
  | 'consoleStart'
  | 'instrumentExchange'
  | 'robotUndocked'
  | 'theatreOut'
  | 'pacuOut'
  | 'turnoverDone'
  // the WHO surgical safety checklist and the recovery discharge criteria (F-30)
  | 'whoSignIn'
  | 'whoTimeOut'
  | 'whoSignOut'
  | 'pacuDischarge'

export interface SimEvent {
  /** Sequential, stable across replays with the same seed. */
  id: number
  /** Sim time in seconds. */
  t: number
  type: SimEventType
  /** One plain sentence for the event line. */
  text: string
  orderId?: string
  podId?: string
  roomId?: RoomId
  /** The person who acted (doctor, pharmacist, nurse). */
  actorId?: string
  /** The person the event is about (an ER patient, a visitor). */
  subjectId?: string
}

/** The ER pathway stages, in order, for the journey rail and the inspect card. */
export type PatientStage =
  | 'arriving'
  | 'checkIn'
  | 'waitingTriage'
  | 'triage'
  | 'waitingDoctor'
  | 'inBay'
  | 'tests'
  | 'decision'
  | 'leaving'
  | 'admittedOut'
  | 'gone'

// ---------------------------------------------------------------------------------------------
// Keys (reserved in one place; see skill pitfall "key conflicts")
// ---------------------------------------------------------------------------------------------

export interface KeyMap {
  tour: string
  prescribe: string
  pause: string
  speed1: string
  speed2: string
  speed4: string
  /** S1: the fast speeds (watch a case play out) and the skip ahead (+15 min; with Shift, the next milestone). */
  speed10: string
  speed30: string
  skip: string
  follow: string
  overview: string
  cleanScreen: string
  /** Open the "Go to…" room menu. */
  goTo: string
  /** Mute / unmute the scanner sounds. */
  mute: string
  /** Open the "Jump to…" moments-of-the-day menu (L1). */
  jump: string
  /** R2: switch the overview between Level 1 and Level 2 (the robotic surgery suite). */
  level: string
  /** Realism mode on or off (the R pill, src/ui/walk/realism.store.ts). */
  realism: string
  /** Presentation mode (the architectural walkthrough) on or off, and its next shot (src/ui/present). */
  present: string
  presentNext: string
  // walk-in (W1)
  /** Switch between walking and the overview. */
  walk: string
  /** First person / third person while walking. */
  firstPerson: string
  /** Use what you face (prescribe, talk, open, sit…). */
  interact: string
  /** Walk faster. */
  hurry: string
  /** Switch which shoulder the walk camera rides over (it also swaps by itself when a wall is at your side). */
  shoulderSwap: string
  forward: string
  back: string
  left: string
  right: string
}

/**
 * S1 "Showcase": how the day opens. `showcase` (the app's default) has every machine and room at work from the first
 * second and the da Vinci already at the console; `quiet` is the R2 day (and what `new Simulation(seed)` builds).
 */
export type OpeningKind = 'showcase' | 'quiet'

/** S1: the sim speeds the HUD offers (1×, 2×, 4×, then the fast speeds for watching a case play out). */
export const SIM_SPEEDS = [1, 2, 4, 10, 30] as const
export type SimSpeed = (typeof SIM_SPEEDS)[number]

/** S1: a service that can place work already under way at a warm start (opening, Jump, Skip). Logs nothing. */
export interface InFlightService {
  warmInFlight(t: number): void
}

export const DEFAULT_KEYMAP: KeyMap = {
  tour: 'KeyT',
  prescribe: 'KeyP',
  pause: 'Space',
  speed1: 'Digit1',
  speed2: 'Digit2',
  speed4: 'Digit4',
  speed10: 'Digit0',
  speed30: 'Digit3',
  skip: 'BracketRight',
  follow: 'KeyF',
  overview: 'Escape',
  cleanScreen: 'KeyH',
  goTo: 'KeyG',
  mute: 'KeyM',
  jump: 'KeyJ',
  level: 'KeyL',
  realism: 'KeyR',
  present: 'KeyC',
  presentNext: 'KeyN',
  walk: 'Tab',
  firstPerson: 'KeyV',
  interact: 'KeyE',
  hurry: 'ShiftLeft',
  shoulderSwap: 'KeyQ',
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
}

// ---------------------------------------------------------------------------------------------
// Imaging (R1): one scanner per modality; the sim writes ScannerState, the scene animates from it
// ---------------------------------------------------------------------------------------------

export type ImagingModality = 'mri' | 'ct' | 'xray' | 'us'
export const MODALITIES: readonly ImagingModality[] = ['mri', 'ct', 'xray', 'us'] as const

export type BodyPart = 'brain' | 'head' | 'lumbarSpine' | 'cervicalSpine' | 'knee' | 'chest' | 'abdomen' | 'pelvis' | 'ankle' | 'wrist' | 'neck' | 'kidneys' | 'breast'

/**
 * What an ultrasound step does (docs/research/cryoablation.md). Absent = 'sweep' (a scan). The cryoablation protocol (ProSense,
 * liquid nitrogen) runs 'place' (the cryoprobe guided into the tumour), 'freeze', 'thaw', 'freeze': while freezing the ice ball grows
 * with `progress`, while thawing it softens and shrinks a little.
 */
export type ScanStep = 'sweep' | 'place' | 'freeze' | 'thaw'

export type ScanPlane = 'axial' | 'sagittal' | 'coronal' | 'projection' | 'sweep' | 'scout'

/** MRI weightings, CT phases, or none (X-ray, ultrasound). */
export type ScanContrast = 'T1' | 'T2' | 'FLAIR' | 'DWI' | 'PD' | 'STIR' | 'plain' | 'arterial' | 'portal' | 'none'

/** One step of an exam: an MRI sequence, a CT scout or phase, an X-ray view, an ultrasound sweep. */
export interface ScanSequence {
  /** Shown in the viewer, e.g. "T2 sagittal", "Topogram", "AP view", "Right kidney". */
  name: string
  plane: ScanPlane
  contrast: ScanContrast
  /** Sim seconds the acquisition takes (an X-ray exposure is well under a second; positioning is separate). */
  seconds: number
  /** Number of slices / images this step produces (the viewer builds them up as `progress` runs). */
  images: number
  /** Ultrasound only: what the step does (ScanStep); absent = 'sweep'. */
  step?: ScanStep
}

export interface ImagingExam {
  id: string
  modality: ImagingModality
  bodyPart: BodyPart
  /** Human protocol name, e.g. "MRI lumbar spine", "CT head (non-contrast)". */
  protocol: string
  sequences: ScanSequence[]
  /** The person being scanned (an ER patient or an outpatient entity id) and their synthetic name. */
  patientId: string
  patientName: string
  source: 'er' | 'outpatient' | 'demo'
  /** Deterministic seed for the simulated images of this exam. */
  imageSeed: number
}

export type ScannerPhase =
  | 'idle' //        nobody on the table
  | 'prep' //        safety screening / changing / explaining (patient in the room or control room)
  | 'positioning' // on the table: coil, pillows, lasers (MRI/CT), tube aligned (X-ray), gel (ultrasound)
  | 'tableIn' //     the table carries the patient into the bore (MRI/CT); others pass through at once
  | 'scanning' //    a sequence is acquiring (`sequence`, `progress`)
  | 'tableOut' //    back out of the bore
  | 'cleanup' //     the patient gets off; the room is wiped down

export interface ScannerState {
  modality: ImagingModality
  phase: ScannerPhase
  exam: ImagingExam | null
  /** Index of the current step in exam.sequences (-1 before the first). */
  sequence: number
  /** 0..1 through the current step while scanning. */
  progress: number
  /** Seconds left in the whole exam (estimate, for the viewer). */
  remaining: number
  /** Seconds since this phase began. */
  phaseTime: number
  /** MRI/CT: 0 = table out, 1 = patient at the scan position. The sim moves the patient with it. */
  tablePos: number
  /**
   * What the machine is doing right now, 0..1: MRI gradient activity (knocking, lights), CT rotor speed (fraction of
   * full speed), X-ray exposure flash, ultrasound probe contact. Drives animation and sound.
   */
  activity: number
  /**
   * X-ray: tube over the table (0) or at the wall detector (1). Ultrasound: probe position 0..1 along the sweep; during a cryoablation
   * the ice ball's size, 0 (none) .. 1 (full size, the end of the second freeze), carried across the freeze-thaw-freeze steps.
   */
  detail: number
  /** The radiographer or sonographer working it. */
  operatorId: string | null
}

// ---------------------------------------------------------------------------------------------
// Living day & bed flow (L1): beds that turn over, shifts, meals and MealBots. See docs/L1-LIVING-DAY.md.
// ---------------------------------------------------------------------------------------------

/** One ward bed's lifecycle, in order (the door tile, the bedside screen and the command wall show it). */
export type BedState =
  | 'occupied' //        a patient lives here
  | 'dischargeSigned' // the doctor signed today's planned discharge on rounds
  | 'leaving' //         take-home medicines, family, changing, walking out
  | 'needsCleaning' //   empty, waiting for a cleaner
  | 'cleaning' //        a cleaner is in the room; a porter brings fresh linen
  | 'ready' //           clean and made up
  | 'reserved' //        assigned to a named patient who is on the way (or boarding in the ER)
export const BED_STATES: readonly BedState[] = ['occupied', 'dischargeSigned', 'leaving', 'needsCleaning', 'cleaning', 'ready', 'reserved'] as const

export type MealKind = 'breakfast' | 'lunch' | 'dinner'
export type RoomMeal = 'none' | 'served' | 'eaten'

/** Which roster a staff member works (hours in CONFIG.day.shifts). */
export type ShiftId = 'day' | 'night' | 'office'

/** A ward room as L1 sees it. The sim mutates these in place; renderers and the HUD only read. */
export interface RoomStatus {
  roomId: RoomId
  bed: BedState
  /** The inpatient (entity id) in the room, leaving it, or on the way to it; null when the bed is empty. */
  patientId: string | null
  patientName: string | null
  /** The occupant's synthetic details for the room panel (inpatients from content, admissions from their profile). */
  patientAge?: number
  /** Plain-language reason for the stay, e.g. "Observation after a fall". */
  patientReason?: string
  /** Day of stay today (the admission day is day 1). */
  dayOfStay?: number
  /** Sim time the bed entered its current state. */
  since: number
  /** A reserved bed's patient waiting in an ER bay, and since when (sim seconds). */
  boarding?: { bayId: string; since: number }
  meal: RoomMeal
  /** 0 = flat, 1 = bed head fully raised (about 45°). The scene tilts the backrest; the sim poses the patient. */
  recline: number
  /** Bumped on every change a bedside screen or door tile shows; canvases redraw only when it changes. */
  version: number
}

export type MealBotState =
  | 'offsite' //    downstairs in the kitchen (invisible)
  | 'toWard' //     up the service lift and along the corridor to the first meal stop
  | 'serving' //    stop to stop while the host carries trays in
  | 'collecting' // the collection run: trays back onto the shelves
  | 'returning' //  back to the service lift, fading out

/** Light ring: peach = carrying meals, amber = waiting or yielding, white = empty. */
export type MealBotLight = 'white' | 'peach' | 'amber'

/** A meal robot. It drives in the people corridor (never on the MedPod lanes or through robot doors). */
export interface MealBot {
  id: string
  ward: WardId
  position: Vec3
  heading: number
  speed: number
  state: MealBotState
  light: MealBotLight
  meal: MealKind | null
  /** Full tray shelves (0..CONFIG.meals.shelves). */
  trays: number
  /** 0..1: fades in and out at the service lift. */
  fade: number
  /** Tray cabinet door: 0 = shut, 1 = open (the host is taking or returning a tray). */
  door: number
  waitingFor: 'person' | 'host' | null
}

/** What L1 adds to the Simulation for renderers and the HUD (`sim.life`; read-only outside the sim). */
export interface LivingDayView {
  /** Clock hour of t = 0: CONFIG.sim.startHour by default; a Jump rebuilds the sim with another. */
  readonly startHour: number
  readonly rooms: ReadonlyMap<RoomId, RoomStatus>
  readonly mealBots: ReadonlyMap<string, MealBot>
}

// ---------------------------------------------------------------------------------------------
// Walk-in (W1): you are a doctor inside the hospital, GTA-style. See docs/W1-WALK-IN.md.
// ---------------------------------------------------------------------------------------------

/** The camera mode: the architect's overview, walking, or one of the two flights between them. */
export type PlayerMode = 'overview' | 'toWalk' | 'walk' | 'toOverview'
/** Behind the shoulder, or through your own eyes. */
export type PlayerViewKind = 'third' | 'first'

/** You, as the sim and the HUD see you. The player system writes it every frame; everybody else only reads. */
export interface PlayerView {
  /** The entity id of your avatar in `sim.entities` (role `doctor`). */
  readonly id: 'player'
  x: number
  z: number
  heading: number
  /** m/s, drives the gait. */
  speed: number
  mode: PlayerMode
  view: PlayerViewKind
}

// ---------------------------------------------------------------------------------------------
// Smart diagnostics (W4): entrance health kiosks, the robot blood-draw centre and the automated lab. See docs/W4-DIAGNOSTICS.md.
// All values are synthetic and display-only: the sim never branches on a value (no clinical decisions). An "outside the usual range" look is
// a UI style from content ranges, never a flag here.
// ---------------------------------------------------------------------------------------------

export type VitalsSource = 'kiosk' | 'triage' | 'player'

export interface VitalsReading {
  id: string
  personId: string
  personName: string
  /** Sim seconds when the session ended (or was cut short). */
  at: number
  source: VitalsSource
  /** Which kiosk (0, 1), or null for a triage reading. */
  station: number | null
  sys: number | null
  dia: number | null
  pulse: number | null
  spo2: number | null
  tempC: number | null
  heightCm: number | null
  weightKg: number | null
  bmi: number | null
  bodyFatPct: number | null
  /** Every cuff reading of the session, in order ([sys, dia]). */
  bp: [number, number][]
  /** The session ended early (called to triage, walked away). */
  partial: boolean
}

export type HealthKioskPhase = 'idle' | 'calling' | 'login' | 'height' | 'weight' | 'bodyFat' | 'sit' | 'spo2' | 'bp' | 'bpRest' | 'temp' | 'report'
export type HealthSessionKind = 'full' | 'vitals' | 'player'

/** One health kiosk, read by the scene every frame (no allocation: the sim mutates it in place). */
export interface HealthKioskState {
  index: number
  phase: HealthKioskPhase
  /** Seconds into the phase, and 0..1 through it. */
  phaseTime: number
  progress: number
  kind: HealthSessionKind | null
  userId: string | null
  userName: string | null
  /** Which cuff reading (1, 2, 3) during 'bp' / 'bpRest'. */
  bpRound: number
  /** Cuff inflation 0..1 (rises, holds, falls during each reading). */
  cuff: number
  /** The reading so far (fields fill in as each step finishes), or null when idle. */
  reading: VitalsReading | null
  /** The guide is helping this user. */
  assisted: boolean
  sessionsToday: number
  /** Bumped whenever anything a screen shows changes (canvas screens repaint only then, at most 2 Hz). */
  version: number
}

export type TubeKind = 'citrate' | 'serum' | 'heparin' | 'EDTA' | 'fluoride'
export type CapColour = 'lightBlue' | 'gold' | 'green' | 'lavender' | 'grey'
/** P: booked outpatient; V: priority (ER, 80+). */
export type TicketClass = 'P' | 'V'

export interface DrawTicket {
  /** "P023", "V004". */
  id: string
  cls: TicketClass
  patientId: string
  patientName: string
  orderId: string
  issuedAt: number
  calledAt: number | null
  station: number | null
  state: 'waiting' | 'called' | 'drawing' | 'done'
}

export type DrawPhase =
  | 'idle'
  | 'calling'
  | 'cardScan'
  | 'armIn'
  | 'cuff'
  | 'sanitise'
  | 'veinScan'
  | 'needleIn'
  | 'filling'
  | 'needleOut'
  | 'bandage'
  | 'release'
  | 'awaitPorter'
  | 'armMoved'
  | 'fallbackToNurse'
  | 'reset'

/** One robot blood-draw station (MagicNurse / Aletta-like), read by the scene every frame. */
export interface DrawStationState {
  index: number
  phase: DrawPhase
  phaseTime: number
  progress: number
  ticket: string | null
  patientId: string | null
  patientName: string | null
  /** The tubes of this draw in order of draw, and which one is filling (index), its fill 0..1 and inversions done. */
  tubes: TubeKind[]
  tube: number
  tubeFill: number
  inversions: number
  /** Tourniquet 0..1, needle advance 0..1, scan head position 0..1 along the forearm. */
  cuff: number
  needle: number
  scan: number
  /** The labelled tray has been brought to this robot. */
  trayHere: boolean
  /** The supervising nurse is at this station (fallback, arm moved). */
  attendantId: string | null
  light: 'white' | 'teal' | 'amber' | 'green'
  attempts: number
  drawsToday: number
  robotDrawsToday: number
  nurseDrawsToday: number
  version: number
}

/** The automatic tube-prep machine (Techno Medica BC-ROBO-like). */
export interface TubePrepState {
  phase: 'idle' | 'picking' | 'labelling' | 'output'
  progress: number
  ticket: string | null
  /** Patients waiting for their tubes. */
  queue: number
  /** The bin the gripper is at (0..7), or -1; the tube it holds, or null. */
  bin: number
  held: TubeKind | null
  /** Tickets whose labelled trays are waiting in the output rack. */
  rack: string[]
  traysToday: number
  version: number
}

export type LabPriority = 'stat' | 'routine'
export type SampleStage =
  | 'ordered'
  | 'labelled'
  | 'drawn'
  | 'inTube'
  | 'received'
  | 'onTrack'
  | 'centrifuge'
  | 'decap'
  | 'analysing'
  | 'recap'
  | 'archived'

/** One tube of blood, from labelling to the fridge archive. */
export interface Sample {
  id: string
  orderId: string
  patientId: string
  tube: TubeKind
  cap: CapColour
  tests: string[]
  priority: LabPriority
  stage: SampleStage
  stageAt: Partial<Record<SampleStage, number>>
  /** Where it is: on the prep tray, flying in the pneumatic tube, on the lab track, inside a module. `s` is metres along that line (the sim's), `sDraw` the render-interpolated value. */
  where: { line: 'none' | 'tray' | 'pneumatic' | 'track' | 'module'; s: number; sDraw: number; module: string | null; source: number }
  qc: 'ok' | 'haemolysed'
  /** Render slot 0..63 (LabState.slots), stable while the sample is in the lab or in flight; -1 otherwise. */
  slot: number
  archiveSlot: number
}

export type AnalyserKind = 'haematology' | 'chemistry' | 'immunoassay' | 'coagulation'
/** Names, units and usual ranges live in content (src/content/lab.json). */
export interface LabValue {
  analyte: string
  value: number
}
export interface LabTestResult {
  testId: string
  values: LabValue[]
  measuredAt: number
  verifiedAt: number | null
  verifiedBy: 'auto' | string | null
}
export interface LabOrder {
  id: string
  patientId: string
  patientName: string
  source: 'er' | 'outpatient' | 'preScan' | 'background' | 'demo'
  panel: string
  tests: string[]
  priority: LabPriority
  sampleIds: string[]
  ticket: string | null
  drawnBy: 'robot' | 'nurse' | 'external' | null
  orderedAt: number
  drawnAt: number | null
  receivedAt: number | null
  completeAt: number | null
  results: LabTestResult[]
}
export interface CentrifugeState {
  index: number
  phase: 'idle' | 'loading' | 'spinning' | 'unloading'
  load: number
  capacity: number
  /** Rotor speed 0..1 (eases up and down) and lid opening 0..1. */
  rpm01: number
  lid: number
  program: LabPriority | null
  timeLeft: number
}
export interface AnalyserState {
  kind: AnalyserKind
  queue: number
  /** The sample being aspirated, and the probe dip 0..1. */
  aspirating: string | null
  probe: number
  running: number
  testsToday: number
}
/** The automated lab, read by the scene every frame. */
export interface LabState {
  pneumatic: { inFlight: string | null; queued: number; sentToday: number }
  /** Render slots: slot i holds a sample id or null (fixed length 64, never reallocated). */
  slots: (string | null)[]
  centrifuges: CentrifugeState[]
  analysers: Record<AnalyserKind, AnalyserState>
  reviewQueue: number
  archived: number
  kpis: { samplesToday: number; onTrack: number; medianTatMin: number | null; autoVerifiedPct: number | null }
  version: number
}

// ---------------------------------------------------------------------------------------------
// Robotic surgery on level 2 (R2): a da Vinci 5 suite and the lifts. See docs/R2-SURGERY.md. Synthetic and display-only: the sim
// follows a seeded plan per case (no clinical decisions); the scene reads these every frame, mutated in place, `version` bumped on change.
// ---------------------------------------------------------------------------------------------

export type SurgeryProcedure = 'cholecystectomy' | 'hysterectomy' | 'prostatectomy'

/** A case from the day list to going home (or up to the surgical ward). The theatre phases are `in` .. `out`. */
export type CasePhase =
  | 'scheduled'
  | 'arrived' // at the entrance, reception, the lift
  | 'preOp' // in a pre-op bay: gown, checks
  | 'toTheatre' // on the stretcher to the OR
  | 'in' // wheels in, onto the table
  | 'induction'
  | 'positioning' // positioning, prep and draping the patient
  | 'ports'
  | 'docking' // deploy for docking, drive with the laser, dock the endoscope arm, targeting
  | 'console'
  | 'undocking'
  | 'closing'
  | 'emergence'
  | 'out' // wheels out, onto the stretcher
  | 'pacu'
  | 'phase2' // day cases: the lounge recliner before going home
  | 'leaving'
  | 'done'

export interface SurgeryCaseView {
  id: string
  /** The patient's entity id once they have arrived. */
  patientId: string | null
  name: string
  procedure: SurgeryProcedure
  phase: CasePhase
  /** Planned wheels-in (sim seconds). */
  plannedIn: number
  wheelsIn: number | null
  dockedAt: number | null
  consoleStart: number | null
  consoleEnd: number | null
  wheelsOut: number | null
  /** Where they go after recovery, from the seeded plan. */
  outcome: 'home' | 'ward'
  /** The pre-op or recovery bay seat they are in, if any. */
  bay: string | null
}

export type RobotPhase =
  | 'stowed'
  | 'draping'
  | 'draped'
  | 'deploying' // "deploy for docking": arms fold to the docking pose
  | 'driving' // the cart drives in, the laser crosshair on
  | 'docking' // the endoscope arm docks to its port
  | 'targeting' // the boom turns and the other arms swing onto their ports
  | 'docked'
  | 'undocking'
  | 'returning'
  | 'cleaning'

/** One of the four arms (1 holds the endoscope in the classic layout; here arm index 1 is the camera). */
export interface RobotArmState {
  index: 0 | 1 | 2 | 3
  /** The instrument fitted (a display name from content), '' when none. */
  instrument: string
  /** The port it pivots about (sim coordinates, y above the floor), or null when free. */
  port: Vec3 | null
  /** Sterile drape on 0..1, and how far it has swung onto its port 0..1. */
  drape: number
  engage: number
  /** Force-feedback reading for the console display 0..1 (synthetic, display only). */
  force: number
  exchanges: number
}

export interface RobotState {
  phase: RobotPhase
  /** The patient cart's base on the floor (sim coordinates) and heading. */
  cart: { x: number; z: number; heading: number }
  /** Boom yaw relative to the cart (rad), boom height above the floor (m) and how far it reaches out 0..1. */
  boomYaw: number
  boomHeight: number
  boomExtend: number
  laser: boolean
  arms: RobotArmState[]
  /** Seed of the console-phase tip motion (shared by the arms and the endoscope view). */
  motionSeed: number
  /** Sim time the current robot phase began. */
  phaseSince: number
  version: number
}

export interface TheatreKpis {
  casesToday: number
  firstCaseOnTime: boolean | null
  /** Minutes, the latest completed values (null before the first). */
  dockingMin: number | null
  consoleMin: number | null
  turnoverMin: number | null
  pacuMin: number | null
  /** Share of the session the room had a patient in it, 0..1. */
  utilisation: number | null
}

export interface TheatreState {
  caseId: string | null
  phase: CasePhase | 'idle' | 'turnover'
  phaseSince: number
  phaseEnds: number | null
  /** The surgical lights on (from induction to emergence). */
  lights: boolean
  surgeonAtConsole: boolean
  /** You (or the overview viewer) at the teaching console. */
  teachingInUse: boolean
  cases: SurgeryCaseView[]
  kpis: TheatreKpis
  version: number
}

export interface SurgeryBayState {
  seatId: string
  kind: 'preOp' | 'pacu'
  patientId: string | null
  since: number
  curtain: boolean
}

export interface SurgeryState {
  theatre: TheatreState
  robot: RobotState
  bays: SurgeryBayState[]
  version: number
}

export type LiftCarPhase = 'idle' | 'opening' | 'open' | 'closing' | 'moving'

export interface LiftCarState {
  shaft: 'A' | 'B'
  index: 0 | 1
  /** The level it is at (or left from, while moving), and where it is going. */
  level: 1 | 2
  target: 1 | 2 | null
  phase: LiftCarPhase
  /** Doors open 0..1 and travel progress 0..1 while moving. */
  doors: number
  travel: number
}

export interface LiftsState {
  cars: LiftCarState[]
  version: number
}
