/**
 * R5: the step-by-step procedure scripts (docs/R5-PROCEDURES.md; the sources are in docs/research/procedures.md, cited by key in each script's
 * `refs`). One JSON file per procedure in src/content/procedures/, named by its id; the loader parses each with zod at module load, so bad copy
 * throws here with the file and the field named. A script is a list of 20-40 steps, each:
 *
 *   unit      the coarse stretch of the case the step lives in (a theatre phase, a CryoStep, an exam unit); the units of a script run in order
 *   slot      (da Vinci docking and undocking) the robot's own sub-window the step is laid in, so the steps match the machine exactly
 *   caption   "Step k of n: ..." line (max 60), `why` one line on why it is done (max 160); both may be shown on screen
 *   times     `realMinutes` (the living day: the steps share their unit's window by the middle of this band) and `watchSeconds` (watch mode)
 *   focus     what the watch camera frames
 *   roles     per role: what it does (`do`), where it stands (`at`), what it looks at and works at, and what is in each hand
 *   patient   the table pose as it changes: enums switch when the step begins, numbers (tilt, prep, drape) ease over the step
 *   arms      (da Vinci console steps) the instrument an arm changes to when the step begins
 *   scope     the endoscope picture's stage key; carried forward until another step sets one
 *   event     a line for the event feed (3-6 per script), checklist: the WHO checklist the step is
 *   repeat    (cryo) the step is repeated once per needle: a run of consecutive repeat steps, played n times
 *   repeatSeconds  (a repeat step) its watch seconds from the second play on: the first needle in full, the next ones as quicker repeats
 *
 * The unions are the contract's (src/sim/types.ts): each is checked with a `Record<Union, true>`, so adding a member there fails the typecheck
 * here until it is listed. Synthetic and display-only: the sim makes no clinical decisions, and the copy stays non-graphic (no blood, no wounds).
 *
 * The scripts are PURE DATA. The engine that plays them (compile, tile a window by step weight, pose, view) is src/sim/procedure.
 */
import { z } from 'zod'
import { CONFIG } from '@/sim/config'
import {
  CRYO_STEPS,
  type Airway,
  type Awareness,
  type CryoTarget,
  type FocusId,
  type PatientArms,
  type PatientMarks,
  type PatientPoseView,
  type PatientPosition,
  type ProcAction,
  type ProcAnchor,
  type ProcMachine,
  type ProcRole,
  type ProcTarget,
  type ProcedureId,
  type ToolKind,
} from '@/sim/types'
import type { RoomPhase } from '@/sim/surgery/plan'
import { ENDOSCOPE_UI } from './endoscopeUi'
import { SURGERY_PROCEDURE_IDS } from './surgery'

// ---------------------------------------------------------------------------------------------
// Copy rules
// ---------------------------------------------------------------------------------------------

/** Words that make a line graphic (the same rule as src/content/surgery.ts). */
export const GRAPHIC_WORDS = /\b(blood|bleed\w*|gore|gory|wounds?|incisions?|guts|mangled|severed)\b/i
/** US spellings and words the UK copy avoids (the rule of src/content/ukVocabulary.test.ts; "OR" is only wrong in capitals). */
export const US_WORDS = /\bOR\b|\bcenters?\b|\bcentered\b|anesth\w*|\bdiarrhea|\bgurney|\bhospitalization|\bpediatric|\btummy\b|\bcolor\b/
/** The endoscope arm's instrument name, always the second arm. */
export const ENDOSCOPE = 'Endoscope 30°'

const line = z
  .string()
  .min(1)
  .refine((s) => s === s.trim() && !/\s{2,}/.test(s), 'no stray spaces')
  .refine((s) => !/[\r\n]/.test(s), 'one line only')
  .refine((s) => !GRAPHIC_WORDS.test(s), 'copy must be non-graphic')
  .refine((s) => !US_WORDS.test(s), 'UK vocabulary: "theatre" and "centre", never "OR" (capitals), "center" or "anesthesia"')

const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])

// ---------------------------------------------------------------------------------------------
// The unions the scripts use. Each is a Record keyed by the type, so the compiler rejects a missing or an extra member.
// ---------------------------------------------------------------------------------------------

const enumOf = <T extends string>(check: Record<T, unknown>) => z.enum(Object.keys(check) as [T, ...T[]])

const MACHINE_CHECK: Record<ProcMachine, true> = { daVinci: true, cryoCt: true, prosense: true }
const PROCEDURE_CHECK: Record<ProcedureId, true> = {
  'or-cholecystectomy': true,
  'or-hysterectomy': true,
  'or-prostatectomy': true,
  'cryo-kidney': true,
  'cryo-lung': true,
  'cryo-liver': true,
  'us-breastCancer': true,
  'us-fibroadenoma': true,
}
export const PROCEDURE_IDS = Object.keys(PROCEDURE_CHECK) as ProcedureId[]
const CRYO_TARGET_CHECK: Record<CryoTarget, true> = { kidney: true, lung: true, liver: true }
const POSITION_CHECK: Record<PatientPosition, true> = { supine: true, prone: true, obliqueLeftUp: true, lithotomy: true }
const ARMS_CHECK: Record<PatientArms, true> = { out: true, tucked: true, aboveHead: true, oneUp: true }
const AIRWAY_CHECK: Record<Airway, true> = { none: true, nasalCannula: true, oxygenMask: true, bagMask: true, tube: true }
const AWARENESS_CHECK: Record<Awareness, true> = { awake: true, sedated: true, asleep: true }
const MARKS_CHECK: Record<PatientMarks, true> = { none: true, marked: true, ports: true, needles: true, closed: true, dressed: true }

const ROLE_CHECK: Record<ProcRole, true> = {
  surgeon: true,
  assistant: true,
  scrub: true,
  circulator: true,
  anaesthetist: true,
  ir: true,
  ctRadiographer: true,
  sedation: true,
  cryoAnaes: true,
  breastRadiologist: true,
  sonographer: true,
}

const ACTION_CHECK: Record<ProcAction, true> = {
  idle: true,
  watchField: true,
  watchMonitor: true,
  talkPatient: true,
  checklist: true,
  chart: true,
  transferPatient: true,
  attachMonitors: true,
  preoxygenate: true,
  injectIv: true,
  bagMask: true,
  intubate: true,
  secureTube: true,
  extubate: true,
  holdBreath: true,
  tuckArms: true,
  positionPatient: true,
  legsInStirrups: true,
  tiltTable: true,
  scrubHands: true,
  gownGlove: true,
  skinPrep: true,
  drapePatient: true,
  removeDrapes: true,
  drapeRobot: true,
  markSkin: true,
  injectLocal: true,
  skinNick: true,
  insertTrocar: true,
  holdScope: true,
  insufflate: true,
  fitCatheter: true,
  fitManipulator: true,
  deployCart: true,
  driveCart: true,
  dockArm: true,
  fitInstrument: true,
  operateConsole: true,
  exchangeInstrument: true,
  passInstrument: true,
  receiveInstrument: true,
  suction: true,
  retractLap: true,
  clipLap: true,
  bagSpecimen: true,
  removeSpecimen: true,
  closeFascia: true,
  closeSkin: true,
  applyDressing: true,
  countItems: true,
  operateCt: true,
  planPaths: true,
  insertNeedle: true,
  removeNeedle: true,
  injectSaline: true,
  warmSkin: true,
  runCryoConsole: true,
  scanProbe: true,
  insertProbe: true,
  pressSite: true,
  cleanRoom: true,
  aimRobot: true,
  turnPatient: true,
}

const TOOL_CHECK: Record<ToolKind, true> = {
  none: true,
  tablet: true,
  syringe: true,
  oxygenMask: true,
  bagValveMask: true,
  laryngoscope: true,
  breathingTube: true,
  ecgLeads: true,
  gelPad: true,
  tableRemote: true,
  scrubBrush: true,
  gown: true,
  prepStick: true,
  drapeSheet: true,
  marker: true,
  scalpel: true,
  veressNeedle: true,
  trocar8: true,
  trocar12: true,
  laparoscope: true,
  gasLine: true,
  catheter: true,
  manipulator: true,
  robotInstrument: true,
  lapSuction: true,
  lapGrasper: true,
  lapClipApplier: true,
  retrievalBag: true,
  specimenPot: true,
  needleHolder: true,
  forceps: true,
  scissors: true,
  skinGlue: true,
  dressing: true,
  countBoard: true,
  gauze: true,
  cryoNeedle: true,
  cryoProbe: true,
  usTransducer: true,
  salineSyringe: true,
  warmGauze: true,
  iceBag: true,
  ctRemote: true,
  mouse: true,
}

/** Every anchor belongs to the machine whose room it is in. */
const ANCHOR_MACHINE: Record<ProcAnchor, ProcMachine> = {
  tableSurgeon: 'daVinci',
  assistant: 'daVinci',
  assistantWait: 'daVinci',
  scrub: 'daVinci',
  scrubWait: 'daVinci',
  circulator: 'daVinci',
  anaesHead: 'daVinci',
  anaesStool: 'daVinci',
  drive: 'daVinci',
  driveEnd: 'daVinci',
  drape: 'daVinci',
  sink0: 'daVinci',
  sink1: 'daVinci',
  surgeonConsole: 'daVinci',
  tableWest: 'daVinci',
  tableWestHead: 'daVinci',
  tableFoot: 'daVinci',
  scrubBackTable: 'daVinci',
  anaesLeft: 'daVinci',
  circulatorCount: 'daVinci',
  ctInsert: 'cryoCt',
  ctConsole: 'cryoCt',
  ctHeadSouth: 'cryoCt',
  ctAnaesHead: 'cryoCt',
  ctFoot: 'cryoCt',
  ctSideSouth: 'cryoCt',
  ctSideNorth: 'cryoCt',
  ctControlScan: 'cryoCt',
  ctControlPlan: 'cryoCt',
  ctControlStand: 'cryoCt',
  usDoctor: 'prosense',
  usConsole: 'prosense',
  usHead: 'prosense',
  usDoor: 'prosense',
}

const TARGET_CHECK: Record<ProcTarget, true> = {
  patientFace: true,
  patientChest: true,
  abdomen: true,
  pelvis: true,
  perineum: true,
  port0: true,
  port1: true,
  port2: true,
  port3: true,
  assistantPort: true,
  visionMonitor: true,
  anaesMonitor: true,
  mayo: true,
  backTable: true,
  robotCart: true,
  consoleViewer: true,
  sink: true,
  patient: true,
  ctField: true,
  needleEntry: true,
  ctFace: true,
  robotGuide: true,
  cryoScreen: true,
  roomScreen: true,
  ctScreen: true,
  planScreen: true,
  ctAnaesMachine: true,
  breast: true,
  usFace: true,
  usScreen: true,
  prosenseScreen: true,
}

const FOCUS_CHECK: Record<FocusId, true> = {
  room: true,
  head: true,
  abdomen: true,
  pelvis: true,
  legs: true,
  ports: true,
  robotCart: true,
  console: true,
  endoscope: true,
  mayo: true,
  backTable: true,
  sink: true,
  stretcher: true,
  ctTable: true,
  ctGantry: true,
  needle: true,
  iceBall: true,
  cryoConsole: true,
  controlRoom: true,
  usScreen: true,
  breast: true,
  ctHead: true,
  ctRoom: true,
  usRoom: true,
  prosenseConsole: true,
}

/** The theatre phases a da Vinci case passes through in the room (a type-level copy of `ROOM_PHASES`, src/sim/surgery/plan.ts, which a test compares). */
const ROOM_PHASE_CHECK: Record<RoomPhase, true> = {
  in: true,
  induction: true,
  positioning: true,
  ports: true,
  docking: true,
  console: true,
  undocking: true,
  closing: true,
  emergence: true,
  out: true,
}

/**
 * The units of each machine, in the order a case passes through them. da Vinci: the theatre phases; cryo: the CryoStep sequence of a case
 * (including the lung's anchor steps, once `CRYO_STEPS` has them); ProSense: the exam's provisional units (wave 3 settles them).
 */
export const UNITS: Record<ProcMachine, readonly string[]> = {
  daVinci: Object.keys(ROOM_PHASE_CHECK),
  cryoCt: CRYO_STEPS.filter((s) => s !== 'idle' && s !== 'turnover'),
  // ProSense (src/sim/imaging/prosense.ts): the units are the windows of the exam's own session, so the steps tile it exactly. check: the sonographer
  // checks the console, the patient not yet in the room; arrive: the walk in and lying down; survey / drape: the exam's explain and positioning
  // phases; place, freeze1, thaw, freeze2 (and, for a fibroadenoma whose lump needs the probe moved, relocate and freeze3): one per exam sequence
  // (each with the pause after it); cleanup: the exam's cleanup phase (the probe out, the dressing, the aftercare talk, the walk out).
  prosense: ['check', 'arrive', 'survey', 'drape', 'place', 'freeze1', 'thaw', 'freeze2', 'relocate', 'freeze3', 'cleanup'],
}

/** Units a case may pass through without any step (zero-length for most targets). */
export const OPTIONAL_UNITS: Record<ProcMachine, readonly string[]> = { daVinci: [], cryoCt: ['anchorFreeze', 'anchorThaw'], prosense: ['relocate', 'freeze3'] }

/**
 * The machine's own sub-windows of a unit, in order: a unit listed here has its steps laid into these slots (every step names one; the slots
 * are covered in order). The da Vinci robot splits the docking phase into DOCK_SPLIT parts and the undocking phase into UNDOCK_SPLIT parts
 * (src/sim/surgery/robot.ts).
 */
export const SLOTS_BY_UNIT: Record<ProcMachine, Readonly<Record<string, readonly string[]>>> = {
  daVinci: { docking: ['deploying', 'driving', 'docking', 'targeting'], undocking: ['undocking', 'returning'] },
  cryoCt: {},
  prosense: {},
}

/** Who can have a line in each machine's scripts, in the order of the published `ProcedureView.roles`. */
export const ROLES_BY_MACHINE: Record<ProcMachine, readonly ProcRole[]> = {
  daVinci: ['surgeon', 'assistant', 'scrub', 'circulator', 'anaesthetist'],
  cryoCt: ['ir', 'ctRadiographer', 'sedation', 'cryoAnaes'],
  prosense: ['breastRadiologist', 'sonographer'],
}

/** Which machine and which `key` (the SurgeryProcedure, CryoTarget or imaging protocol id) each procedure id is. */
export const PROCEDURE_META: Record<ProcedureId, { machine: ProcMachine; key: string }> = {
  'or-cholecystectomy': { machine: 'daVinci', key: 'cholecystectomy' },
  'or-hysterectomy': { machine: 'daVinci', key: 'hysterectomy' },
  'or-prostatectomy': { machine: 'daVinci', key: 'prostatectomy' },
  'cryo-kidney': { machine: 'cryoCt', key: 'kidney' },
  'cryo-lung': { machine: 'cryoCt', key: 'lung' },
  'cryo-liver': { machine: 'cryoCt', key: 'liver' },
  'us-breastCancer': { machine: 'prosense', key: 'us-cryo-breast' },
  'us-fibroadenoma': { machine: 'prosense', key: 'us-cryo-fibroadenoma' },
}

/** Steps per script: the gallbladder's has 32, the pelvic operations 34 and 37 (the docking and undocking slots add to the research tables' 29-32). */
export const STEP_COUNT_RANGE = [20, 40] as const
export const CHECKLISTS = ['signIn', 'timeOut', 'signOut'] as const
/** The da Vinci arms a script may change an instrument on (arm index 1 is the endoscope). */
export const ARM_KEYS = ['0', '2', '3'] as const

// ---------------------------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------------------------

const camel = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'camelCase, starting with a lower-case letter')
/** A source of docs/research/procedures.md section 13 by its number: "procedures:5" is source [5]. No URLs and no titles in the JSON. */
const refKey = z.string().regex(/^procedures:[1-9]\d*$/, 'a source of docs/research/procedures.md by number: "procedures:5" for [5] (no URLs, no titles)')

const PatientPoseSchema = z.strictObject({
  position: enumOf(POSITION_CHECK),
  headTiltDeg: z.number().min(-45).max(45),
  rollDeg: z.number().min(-30).max(30),
  arms: enumOf(ARMS_CHECK),
  airway: enumOf(AIRWAY_CHECK),
  awareness: enumOf(AWARENESS_CHECK),
  prep: z.number().min(0).max(1),
  drape: z.number().min(0).max(1),
  marks: enumOf(MARKS_CHECK),
  catheter: z.boolean(),
  manipulator: z.boolean(),
})

/** What a step changes in the patient: enums switch when the step begins, numbers ease to the value over the step. */
const PatientDeltaSchema = PatientPoseSchema.partial()

const RoleLineSchema = z.strictObject({
  do: enumOf(ACTION_CHECK),
  at: enumOf(ANCHOR_MACHINE),
  look: enumOf(TARGET_CHECK).optional(),
  work: enumOf(TARGET_CHECK).optional(),
  left: enumOf(TOOL_CHECK).optional(),
  right: enumOf(TOOL_CHECK).optional(),
})

const StepSchema = z
  .strictObject({
    id: camel,
    unit: z.string().min(1),
    slot: z.string().min(1).optional(),
    repeat: z.boolean().optional(),
    repeatSeconds: z.number().min(8).max(180).optional(),
    caption: line.max(60),
    why: line.max(160),
    realMinutes: z.tuple([z.number().min(0.1).max(120), z.number().min(0.1).max(120)]),
    watchSeconds: z.number().min(8).max(180),
    focus: enumOf(FOCUS_CHECK),
    roles: z.partialRecord(enumOf(ROLE_CHECK), RoleLineSchema),
    patient: PatientDeltaSchema.optional(),
    arms: z.partialRecord(z.enum(ARM_KEYS), line).optional(),
    scope: camel.optional(),
    event: line.optional(),
    checklist: z.enum(CHECKLISTS).optional(),
  })
  .superRefine((step, ctx) => {
    if (step.realMinutes[0] > step.realMinutes[1]) ctx.addIssue({ code: 'custom', path: ['realMinutes'], message: 'realMinutes is [lo, hi] with lo <= hi' })
    for (const name of placeholdersOf(step.caption)) {
      if (name !== 'k' && name !== 'n') ctx.addIssue({ code: 'custom', path: ['caption'], message: `{${name}} is not a caption field (only {k} and {n})` })
    }
    if (/[{}]/.test(step.caption.replace(/\{[kn]\}/g, ''))) ctx.addIssue({ code: 'custom', path: ['caption'], message: 'stray brace; placeholders look like {k}' })
    for (const key of ['why', 'event'] as const) {
      const text = step[key]
      if (text !== undefined && /[{}]/.test(text)) ctx.addIssue({ code: 'custom', path: [key], message: `${key} has no placeholders` })
    }
    if (step.event !== undefined && !step.event.endsWith('.')) ctx.addIssue({ code: 'custom', path: ['event'], message: 'an event line ends with a full stop' })
    if (step.repeat === true && step.patient !== undefined) ctx.addIssue({ code: 'custom', path: ['patient'], message: 'a repeated step cannot change the patient' })
    if (step.repeatSeconds !== undefined && step.repeat !== true) ctx.addIssue({ code: 'custom', path: ['repeatSeconds'], message: 'only a repeat step has repeatSeconds (its watch seconds from the second play on)' })
    if (step.repeatSeconds !== undefined && step.repeatSeconds > step.watchSeconds) ctx.addIssue({ code: 'custom', path: ['repeatSeconds'], message: 'a quicker repeat lasts no longer than the first play (watchSeconds)' })
  })

export const ProcedureScriptSchema = z
  .strictObject({
    id: enumOf(PROCEDURE_CHECK),
    machine: enumOf(MACHINE_CHECK),
    key: z.string().min(1),
    name: line,
    short: line,
    refs: z.array(refKey).min(1),
    anaesthesia: z.enum(['general', 'sedation', 'local']),
    start: PatientPoseSchema,
    /** da Vinci only: the instrument on each arm when the arms have docked, by arm index; index 1 is the endoscope. */
    robotArms: z.tuple([line, z.literal(ENDOSCOPE), line, line]).optional(),
    steps: z.array(StepSchema).min(STEP_COUNT_RANGE[0]).max(STEP_COUNT_RANGE[1]),
  })
  .superRefine((script, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
    const meta = PROCEDURE_META[script.id]
    if (meta.machine !== script.machine) issue(['machine'], `${script.id} runs on ${meta.machine}`)
    if (meta.key !== script.key) issue(['key'], `${script.id} has key "${meta.key}"`)
    const machine = script.machine
    const units = UNITS[machine]
    const slotsOf = SLOTS_BY_UNIT[machine]
    const roles = ROLES_BY_MACHINE[machine]

    // da Vinci copy: the arms' instruments each have an endoscope picture
    if (machine === 'daVinci') {
      if (script.robotArms === undefined) issue(['robotArms'], 'a da Vinci script lists its four arms')
      else {
        script.robotArms.forEach((name, i) => {
          if (!(name in ENDOSCOPE_UI.instruments)) issue(['robotArms', i], `"${name}" has no endoscope look (src/content/endoscopeUi.json)`)
        })
        if (new Set(script.robotArms).size !== 4) issue(['robotArms'], 'an arm cannot repeat an instrument')
      }
    } else if (script.robotArms !== undefined) issue(['robotArms'], 'only a da Vinci script has robot arms')

    // units: valid and in order, each once (steps of a unit are contiguous)
    let last = -1
    const seen = new Set<string>()
    const ids = new Set<string>()
    let watchTotal = 0
    script.steps.forEach((step, i) => {
      const at = ['steps', i]
      const u = units.indexOf(step.unit)
      if (u < 0) issue([...at, 'unit'], `"${step.unit}" is not a unit of ${machine} (${units.join(', ')})`)
      else if (u < last) issue([...at, 'unit'], `unit "${step.unit}" is out of order: the units of ${machine} run ${units.join(', ')}`)
      else last = u
      seen.add(step.unit)
      if (ids.has(step.id)) issue([...at, 'id'], `duplicate step id "${step.id}"`)
      ids.add(step.id)
      watchTotal += step.watchSeconds
      if (step.watchSeconds < CONFIG.procedure.minWatchStepSeconds) issue([...at, 'watchSeconds'], `a step lasts at least ${CONFIG.procedure.minWatchStepSeconds} s`)
      for (const role of Object.keys(step.roles) as ProcRole[]) {
        if (!roles.includes(role)) issue([...at, 'roles', role], `"${role}" is not a role of ${machine} (${roles.join(', ')})`)
        const anchor = step.roles[role]?.at
        if (anchor !== undefined && ANCHOR_MACHINE[anchor] !== machine) issue([...at, 'roles', role, 'at'], `anchor "${anchor}" is not a spot of ${machine}`)
      }
      if (step.arms !== undefined) {
        if (machine !== 'daVinci' || step.unit !== 'console') issue([...at, 'arms'], 'arm changes belong to the console steps of a da Vinci script')
        for (const [arm, name] of Object.entries(step.arms)) {
          if (!(name in ENDOSCOPE_UI.instruments)) issue([...at, 'arms', arm], `"${name}" has no endoscope look (src/content/endoscopeUi.json)`)
          else if (ENDOSCOPE_UI.instruments[name].look === 'endoscope') issue([...at, 'arms', arm], 'the endoscope stays on arm 2')
        }
      }
      if (step.repeat === true && machine !== 'cryoCt') issue([...at, 'repeat'], 'only cryo steps repeat (once per needle)')
    })
    for (const unit of units) {
      if (!seen.has(unit) && !OPTIONAL_UNITS[machine].includes(unit)) issue(['steps'], `unit "${unit}" has no step: every unit a case passes through needs at least one`)
    }

    // slots: a slotted unit has a slot on every step, in order, and every slot is covered
    for (const unit of units) {
      const idx = script.steps.map((s, i) => (s.unit === unit ? i : -1)).filter((i) => i >= 0)
      const slots = slotsOf[unit]
      if (slots === undefined) {
        for (const i of idx) if (script.steps[i].slot !== undefined) issue(['steps', i, 'slot'], `unit "${unit}" has no slots`)
        continue
      }
      let prev = -1
      const covered = new Set<string>()
      for (const i of idx) {
        const slot = script.steps[i].slot
        if (slot === undefined) {
          issue(['steps', i, 'slot'], `every step of "${unit}" names its slot (${slots.join(', ')})`)
          continue
        }
        const s = slots.indexOf(slot)
        if (s < 0) issue(['steps', i, 'slot'], `"${slot}" is not a slot of "${unit}" (${slots.join(', ')})`)
        else if (s < prev) issue(['steps', i, 'slot'], `slot "${slot}" is out of order in "${unit}" (${slots.join(', ')})`)
        else prev = s
        covered.add(slot)
      }
      for (const slot of slots) if (idx.length > 0 && !covered.has(slot)) issue(['steps'], `slot "${slot}" of "${unit}" has no step`)
    }

    // repeats: one run of consecutive repeat steps, inside one unit
    const rep = script.steps.map((s, i) => (s.repeat === true ? i : -1)).filter((i) => i >= 0)
    if (rep.length > 0) {
      if (rep[rep.length - 1] - rep[0] + 1 !== rep.length) issue(['steps'], 'the repeat steps must be consecutive')
      if (new Set(rep.map((i) => script.steps[i].unit)).size > 1) issue(['steps'], 'the repeat steps must be in one unit')
    }

    const [lo, hi] = CONFIG.procedure.watchTotalSeconds
    if (watchTotal < lo || watchTotal > hi) issue(['steps'], `the watch seconds add up to ${watchTotal}; they must be within ${lo}-${hi}`)
  })

export type ProcedureScript = z.output<typeof ProcedureScriptSchema>
export type ProcedureStep = ProcedureScript['steps'][number]
/** One role's line in a step. */
export type ProcRoleLine = NonNullable<ProcedureStep['roles'][ProcRole]>
/** The patient pose a script starts from. */
export type ProcPatientStart = PatientPoseView

/** Parse one script, or throw with the source named and every failing field listed. */
export function parseScript(data: unknown, source: string): ProcedureScript {
  const result = ProcedureScriptSchema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`${source} is invalid: ${details}`)
  }
  return result.data
}

// ---------------------------------------------------------------------------------------------
// The loader: one JSON file per procedure, named by its id. A script that is not written yet is simply absent.
// ---------------------------------------------------------------------------------------------

const FILES = import.meta.glob<unknown>('./procedures/*.json', { eager: true, import: 'default' })

function load(): Partial<Record<ProcedureId, ProcedureScript>> {
  const out: Partial<Record<ProcedureId, ProcedureScript>> = {}
  for (const [path, json] of Object.entries(FILES)) {
    const script = parseScript(json, path)
    const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '')
    if (base !== script.id) throw new Error(`${path}: the file is named "${base}" but holds the script "${script.id}"`)
    out[script.id] = script
  }
  return out
}

/** Every procedure script written so far (the other scripts arrive in later waves). */
export const PROCEDURE_SCRIPTS: Partial<Record<ProcedureId, ProcedureScript>> = load()

export function scriptFor(id: ProcedureId): ProcedureScript | undefined {
  return PROCEDURE_SCRIPTS[id]
}

/** The cryo targets (the `key` of a cryo script). */
export const CRYO_TARGETS = Object.keys(CRYO_TARGET_CHECK) as CryoTarget[]
/** The da Vinci procedures (the `key` of an OR script). */
export const OR_PROCEDURES = SURGERY_PROCEDURE_IDS
