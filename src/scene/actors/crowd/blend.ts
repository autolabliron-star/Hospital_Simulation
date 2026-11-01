// Ported from Waltz City (src/scene/actors/crowd/blend.ts); the modes and the anim mapping are the hospital's.
/**
 * Pose modes and the blender that moves between them.
 *
 * A person is always in exactly one "mode" (relaxed, talking, pushing a chair, lying in bed, ...) but the
 * body never jumps between modes: the blender holds one weight per mode, the weights always add up to 1
 * and a change of mode moves them along a smooth curve over 0.25 s. If the mode changes again half way,
 * the new blend starts from the weights as they are right now, so nothing snaps.
 *
 * Standing, seated and lying people use the same blender; the seated and lying modes are just more entries.
 */
import type { AnimState, ProcAction, PropKind, SeatPose } from '@/sim/types'
import { smoothstep } from './math'

export const MODES = [
  'relaxed', // idle, walk, run, carry: the arm swing follows the real speed
  'talk', // gestures
  'wave',
  'tablet', // looking at a tablet held in front
  'give', // handing something forward
  'push', // both hands on a handle, leaning in
  'clean', // a mopping sweep
  'sit',
  'typing', // seated, hands at a keyboard
  'sitTalk',
  'sitTablet', // seated, a tablet in the lap
  'sitListen',
  'lie',
  // W4 health kiosk and robot draw chair (appended: nothing indexes the modes by position)
  'grip', // standing, both hands on the body-fat handles
  'finger', // standing, the right hand out to a reader, clip or printer
  'sitArmIn', // seated, the left arm forward in a cuff or robot tunnel (armIn.ts)
  // R2 robotic surgery (level 2)
  'sitConsole', // seated at a surgeon console: head in the viewer, both forearms forward and level on the hand controllers (armIn.ts CONSOLE_HANDS)
  // R5 step-by-step procedures (surgicalPoses.ts ACTION_DEFS): the sterile rest of a gloved person, then one pose per kind of action (ACTION_MODE below)
  'sterile', // gloved, no action: both hands clasped in front of the chest, above the waist, also while walking (no arm swing)
  'aWatchField',
  'aWatchMonitor',
  'aTalk',
  'aChart',
  'aCount',
  'aTransfer',
  'aPosition',
  'aAttach',
  'aPreox',
  'aInject',
  'aBagMask',
  'aIntubate',
  'aSecure',
  'aExtubate',
  'aTilt',
  'aScrub',
  'aGown',
  'aPrep',
  'aDrape',
  'aUndrape',
  'aDrapeRobot',
  'aMark',
  'aLocal',
  'aNick',
  'aTrocar',
  'aScope',
  'aInsufflate',
  'aCart',
  'aDock',
  'aFit',
  'aExchange',
  'aPass',
  'aReceive',
  'aSuction',
  'aRetract',
  'aClip',
  'aBag',
  'aRemove',
  'aSuture',
  'aDress',
  'aNeedle',
  'aUnneedle',
  'aScan',
  'aKeyboard',
  'aWipe',
] as const
export type Mode = (typeof MODES)[number]
export const MODE_COUNT = MODES.length
export const MODE_INDEX: Readonly<Record<Mode, number>> = Object.fromEntries(MODES.map((m, i) => [m, i])) as Record<Mode, number>

/** Seconds a change of pose takes. */
export const BLEND_SECONDS = 0.25

export interface Blender {
  /** Current weight per mode. Always sums to 1. */
  weights: Float32Array
  from: Float32Array
  to: Float32Array
  /** Progress of the running blend, 0 to 1. */
  t: number
  /** Index of the mode being blended towards. */
  target: number
  duration: number
}

export function createBlender(mode: Mode, duration = BLEND_SECONDS): Blender {
  const weights = new Float32Array(MODE_COUNT)
  const from = new Float32Array(MODE_COUNT)
  const to = new Float32Array(MODE_COUNT)
  const target = MODE_INDEX[mode]
  weights[target] = 1
  from[target] = 1
  to[target] = 1
  return { weights, from, to, t: 1, target, duration }
}

/** Ask for a mode. Blending starts from the weights as they are now. A repeated request changes nothing. */
export function blendTo(b: Blender, mode: Mode): void {
  const idx = MODE_INDEX[mode]
  if (idx === b.target) return
  b.from.set(b.weights)
  b.to.fill(0)
  b.to[idx] = 1
  b.target = idx
  b.t = 0
}

/** Advance the running blend by `dt` seconds and recompute the weights. */
export function advanceBlend(b: Blender, dt: number): void {
  if (b.t < 1) b.t = Math.min(1, b.t + (b.duration > 0 ? dt / b.duration : 1))
  const e = smoothstep(0, 1, b.t)
  let sum = 0
  for (let i = 0; i < MODE_COUNT; i++) {
    const w = b.from[i] + (b.to[i] - b.from[i]) * e
    b.weights[i] = w > 0 ? w : 0
    sum += b.weights[i]
  }
  // from and to both sum to 1, so this is a no-op up to rounding; it keeps the invariant exact for tests and for hours of play
  if (sum > 0 && Math.abs(sum - 1) > 1e-7) for (let i = 0; i < MODE_COUNT; i++) b.weights[i] /= sum
  else if (sum <= 0) {
    b.weights.fill(0)
    b.weights[b.target] = 1
  }
}

export function weightSum(b: Blender): number {
  let s = 0
  for (let i = 0; i < MODE_COUNT; i++) s += b.weights[i]
  return s
}

// ---------------------------------------------------------------------------------------------
// What the simulation says -> which mode
// ---------------------------------------------------------------------------------------------

/** How the body is held: on its feet, on a seat, or flat on a bed or stretcher. */
export type Posture = 'stand' | 'sit' | 'lie'

/**
 * The posture of an entity. `anim` 'sit' / 'lie' decide first; otherwise a seat the sim put the person on
 * (`seated.pose`) does; otherwise a rider is seated in a wheelchair or lying on a stretcher.
 */
export function postureOf(anim: AnimState, seatedPose: SeatPose | undefined, riding: boolean, vehicle: string | undefined): Posture {
  // a patient in a bed with the head raised (L1 meals and visits) is a lying body with a raised torso, not a seated one
  if (seatedPose === 'recline') return 'lie'
  if (anim === 'lie') return 'lie'
  if (anim === 'sit') return 'sit'
  if (seatedPose) return seatedPose === 'lie' ? 'lie' : 'sit'
  if (riding) return vehicle === 'stretcher' ? 'lie' : vehicle === 'wheelchair' ? 'sit' : 'stand'
  return 'stand'
}

/**
 * R5: the pose of each procedure action (the sim's `Entity.act.action`) for a person on their feet. Several actions share a pose (the three drapes, the two
 * closures, the cryo and ultrasound steps that look alike). 'idle' is the sterile rest for a gloved person and the plain stand for anybody else (modeFor).
 */
export const ACTION_MODE: Readonly<Record<ProcAction, Mode>> = Object.freeze({
  idle: 'sterile',
  watchField: 'aWatchField',
  watchMonitor: 'aWatchMonitor',
  talkPatient: 'aTalk',
  checklist: 'aChart',
  chart: 'aChart',
  transferPatient: 'aTransfer',
  attachMonitors: 'aAttach',
  preoxygenate: 'aPreox',
  injectIv: 'aInject',
  bagMask: 'aBagMask',
  intubate: 'aIntubate',
  secureTube: 'aSecure',
  extubate: 'aExtubate',
  holdBreath: 'aWatchField',
  tuckArms: 'aPosition',
  positionPatient: 'aPosition',
  legsInStirrups: 'aPosition',
  tiltTable: 'aTilt',
  scrubHands: 'aScrub',
  gownGlove: 'aGown',
  skinPrep: 'aPrep',
  drapePatient: 'aDrape',
  removeDrapes: 'aUndrape',
  drapeRobot: 'aDrapeRobot',
  markSkin: 'aMark',
  injectLocal: 'aLocal',
  skinNick: 'aNick',
  insertTrocar: 'aTrocar',
  holdScope: 'aScope',
  insufflate: 'aInsufflate',
  fitCatheter: 'aAttach',
  fitManipulator: 'aAttach',
  deployCart: 'aCart',
  driveCart: 'aCart',
  dockArm: 'aDock',
  fitInstrument: 'aFit',
  operateConsole: 'aKeyboard',
  exchangeInstrument: 'aExchange',
  passInstrument: 'aPass',
  receiveInstrument: 'aReceive',
  suction: 'aSuction',
  retractLap: 'aRetract',
  clipLap: 'aClip',
  bagSpecimen: 'aBag',
  removeSpecimen: 'aRemove',
  closeFascia: 'aSuture',
  closeSkin: 'aSuture',
  applyDressing: 'aDress',
  countItems: 'aCount',
  operateCt: 'aKeyboard',
  planPaths: 'aKeyboard',
  insertNeedle: 'aNeedle',
  removeNeedle: 'aUnneedle',
  injectSaline: 'aInject',
  warmSkin: 'aDress',
  runCryoConsole: 'aKeyboard',
  scanProbe: 'aScan',
  insertProbe: 'aNeedle',
  pressSite: 'aDress',
  cleanRoom: 'aWipe',
  // R5 wave 3 (contract placeholders until the cryo poses land): confirming the robot's aim, rolling the patient with the team
  aimRobot: 'aWatchField',
  turnPatient: 'aTransfer',
})

/** R5: the seated actions that have a seated pose of their own (the console surgeon, a radiographer at a desk, a checklist read in a chair). */
const SEATED_ACTION: Partial<Record<ProcAction, Mode>> = {
  operateConsole: 'sitConsole',
  operateCt: 'typing',
  planPaths: 'typing',
  runCryoConsole: 'typing',
  chart: 'sitTablet',
  checklist: 'sitTablet',
  countItems: 'sitTablet',
  watchMonitor: 'sitListen',
  watchField: 'sitListen',
}

/** R5: the modes of the procedure actions (and the sterile rest): a person in one of them is at their step spot, working. */
export const isActionMode = (m: Mode): boolean => MODE_INDEX[m] >= MODE_INDEX.sterile

/**
 * The mode of a person from the posture and the animation state. Walking itself is not a mode: it comes from real motion.
 * R5: a procedure action (`act`) wins over the anim on the feet, and a few actions have a seated pose; `sterile` (gloved) holds the hands clasped above the
 * waist whenever the person stands with nothing to do, walking included.
 */
export function modeFor(anim: AnimState, posture: Posture, prop: PropKind, act: ProcAction | null = null, sterile = false): Mode {
  if (posture === 'lie') return 'lie'
  if (act !== null) {
    if (posture === 'sit') {
      const m = SEATED_ACTION[act]
      if (m) return m
    } else if (act !== 'idle') return ACTION_MODE[act]
  }
  if (sterile && posture === 'stand') return 'sterile'
  if (posture === 'sit') {
    switch (anim) {
      case 'talk':
      case 'wave':
        return 'sitTalk'
      case 'tablet':
        return prop === 'tablet' ? 'sitTablet' : 'typing'
      // W4: the arm is in the cuff or tunnel; the finger clip at the BP wing is the rest before the cuff (the station says 'finger' while the person is seated)
      case 'armIn':
      case 'finger':
        return 'sitArmIn'
      // R2: the operating surgeon (and the teaching console's visitor): head in the viewer, hands on the controllers
      case 'console':
        return 'sitConsole'
      default:
        return prop === 'tablet' ? 'sitTablet' : 'sit'
    }
  }
  switch (anim) {
    case 'talk':
      return 'talk'
    case 'wave':
      return 'wave'
    case 'tablet':
      return 'tablet'
    case 'give':
      return 'give'
    case 'push':
      return 'push'
    case 'clean':
      return 'clean'
    case 'grip':
      return 'grip'
    case 'finger':
      return 'finger'
    default:
      // (a standing person whose station has not put the anim back yet, 'armIn' and 'console' included, simply stands and walks)
      return 'relaxed'
  }
}

export const isSeatedMode = (m: Mode): boolean => m === 'sit' || m === 'typing' || m === 'sitTalk' || m === 'sitTablet' || m === 'sitListen' || m === 'sitArmIn' || m === 'sitConsole'
