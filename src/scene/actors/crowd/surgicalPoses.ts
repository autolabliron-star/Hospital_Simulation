/**
 * R5: the poses of the procedure actions (Design §2 of the R5 plan): one evaluator, `evalAction`, over a table of data (`ACTION_DEFS`), so a surgeon closing
 * the skin, an anaesthetist intubating and a scrub nurse passing a needle holder are numbers, not code. Every def is one pose mode (blend.ts MODES, mapped
 * from the sim's `ProcAction` by ACTION_MODE), so the 0.25 s crossfade of the blender also blends one action into the next (pass -> receive, drape -> prep).
 *
 * HANDS. Each hand is a `HandDef`:
 *   at      what the hand works from: 'target' the act's world point (`Entity.act.work`, smoothed per hand by the rig: PoseCtx tL / tR), 'other' the other
 *           hand's tip (a hand that stretches the skin 4 cm from the scalpel), 'body' a fixed point of the body frame (a tablet held in front of the
 *           chest), 'sterile' the clasp in front of the chest (STERILE_CLASP, the gloved rest).
 *   off     the TIP (the contact point, where the instrument's tip goes) from that anchor, metres of the world in the body frame (x left, y up, z ahead)
 *   back    the middle of the hand from the tip (the instrument's length back along the approach); zero: the hand itself is at the point
 *   stroke  the motion over the step: 'none', 'line' (back and forth along `dir`), 'circle' and 'spiral' (round `dir`, the spiral's radius growing from
 *           amp0 to amp over the step), 'arc' (a suture throw: across, under and out, the hand pronating), 'pump' (a press and release along `dir`),
 *           'twist' (pronation +-amp while the tip goes `push` metres along `dir` over the step), 'pull' (from amp0 to amp along `dir` over the step)
 *   lag     the stroke's phase lag in cycles (the scrub's two hands alternate: 0.5)
 *   arm     the angles the arm has without the solve (a blend from another mode starts near them); wing: how wide the elbow is held (0 down and out ..
 *           1 winged, pose.ts U.lWing); pron: the hand's pronation from .. to over the stroke (positive turns the palm towards the forearm's +Z, the
 *           inside of the elbow: palm up on a forearm held forward; negative palm down, see avatars: the palm is the hand frame's -side X)
 *   tool    the instrument's moving part: 'progress' (a syringe's plunger follows the step), 'stroke' (jaws, the bag of a bag-valve mask), or none
 *
 * STROKES FOLLOW THE SIM'S STEP PROGRESS, NOT REAL TIME: the phase is frac(progress x reps - lag) (`hz` > 0: frac(sim seconds x hz - lag), the bag-mask's
 * 12 breaths a minute), so a paused, a compressed or a sped-up watch stays in step, and the same progress always gives the same hands. Real time only
 * breathes. When a stroke would run faster than 2 a second the rig fades its amplitude (PoseCtx.strokeGain), so a high sim speed does not flicker.
 *
 * BODY. The chest leans in for a far or a low point (lean x the hands' reach past 0.42 m and their drop under 1.08 m, at most 0.45 rad) and turns a third
 * of the way to it; the head pitches down to the work point beyond what the look-at gives (the neck turns 25 degrees down at most, look.ts), less the half
 * of the chest's lean the head already gets. Sterile defs keep the hands between the pelvis + 0.12 m and 8 cm under the shoulders.
 *
 * Everything is in the body frame of the standing person at nominal size (pose.ts HAND REACH), so the rig turns a target into a world point; the world
 * metres here (offsets, strokes) are divided by the person's size, so a tall and a short surgeon hold the same scalpel to the same skin.
 */
import { clamp, smoothstep, TAU } from './math'
import { AIM_L, AIM_R, ARM_L, ARM_R, REACH_L, REACH_R, U, type PoseCtx } from './pose'
import { MODE_INDEX, type Mode } from './blend'

type V3 = readonly [number, number, number]
type A6 = readonly [number, number, number, number, number, number]

export type HandAt = 'target' | 'other' | 'body' | 'sterile'
export type Stroke = 'none' | 'line' | 'circle' | 'spiral' | 'arc' | 'pump' | 'twist' | 'pull'
export type ToolMotion = 'none' | 'progress' | 'stroke'

export interface HandDef {
  at: HandAt
  off: V3
  back: V3
  stroke: Stroke
  amp: number
  amp0: number
  dir: V3
  /** Two unit axes across `dir` (the plane of a circle, a spiral or an arc), made once when the def is built. */
  e1: V3
  e2: V3
  lag: number
  arm: A6
  wing: number
  pron: readonly [number, number]
  push: number
  tool: ToolMotion
}

export interface ActionDef {
  L: HandDef
  R: HandDef
  /** The chest's lean: a constant part and the gain on the hands' reach and drop. */
  leanBase: number
  lean: number
  /** 0..1: how far the head pitches down to the work point; headBase: a fixed extra pitch (reading a tablet). */
  head: number
  headBase: number
  /** Strokes per step (the phase is frac(progress x reps)), or per sim second when `hz` > 0. */
  reps: number
  hz: number
  /** The instruments point their tips at the hands' tips (the rig aims the hand and the instrument frame). */
  aim: boolean
  /** The hands stay in the sterile zone (above the waist, under the shoulders). */
  sterile: boolean
}

/** The gloved rest: the hands' middles, clasped in front of the chest (nominal metres, body frame; the left hand at +x). */
export const STERILE_CLASP = { x: 0.04, y: 1.12, z: 0.24 } as const
/** Where the hands work when the act names no point: in front of the waist. */
export const DEFAULT_WORK: V3 = [0, 1.05, 0.42]
/** The chest's lean starts beyond this reach (metres ahead) and under this height. */
export const LEAN_FROM = { z: 0.42, y: 1.08, max: 0.45 } as const
/** Sterile hands: at least this far above the pelvis, at least this far under the shoulders (metres). */
export const STERILE_BAND = { abovePelvis: 0.12, underShoulder: 0.08 } as const

const norm = (v: V3): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const cross = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const FWD_ARM: A6 = [0.9, 0.12, 0, 1.2, 0, 0]

/** A hand with defaults: at the target, no offset, no stroke, a forward arm. */
function H(p: Partial<Omit<HandDef, 'e1' | 'e2'>>): HandDef {
  const dir = norm(p.dir ?? [0, 1, 0])
  let e1 = cross(dir, [0, 0, 1])
  if (Math.hypot(e1[0], e1[1], e1[2]) < 0.3) e1 = cross(dir, [1, 0, 0])
  e1 = norm(e1)
  const e2 = norm(cross(dir, e1))
  return {
    at: p.at ?? 'target',
    off: p.off ?? [0, 0, 0],
    back: p.back ?? [0, 0, 0],
    stroke: p.stroke ?? 'none',
    amp: p.amp ?? 0,
    amp0: p.amp0 ?? 0,
    dir,
    e1,
    e2,
    lag: p.lag ?? 0,
    arm: p.arm ?? FWD_ARM,
    wing: p.wing ?? 0.2,
    pron: p.pron ?? [0, 0],
    push: p.push ?? 0,
    tool: p.tool ?? 'none',
  }
}

function A(p: Partial<ActionDef> & { L: HandDef; R: HandDef }): ActionDef {
  return { leanBase: 0, lean: 1, head: 0.8, headBase: 0, reps: 1, hz: 0, aim: true, sterile: false, ...p }
}

const CLASP_ARM: A6 = [0.55, 0.1, 0, 1.75, 0.05, 0]
const CLASP_L = H({ at: 'sterile', arm: CLASP_ARM, wing: 0.15 })
const CLASP_R = H({ at: 'sterile', arm: CLASP_ARM, wing: 0.15 })
const HANG_L = H({ at: 'body', off: [0.2, 0.84, 0.07], arm: [0.08, 0.1, 0, 0.3, 0, 0.2], wing: 0 })
/** A pencil-held tool (scalpel, marker, needle, syringe): the hand 11 cm above and behind its tip. */
const PENCIL_BACK: V3 = [-0.03, 0.095, -0.06]
/** A laparoscopic instrument through a port: the hand 22 cm back up its shaft, towards the person. */
const LAP_BACK: V3 = [-0.03, 0.17, -0.14]
/** A mask held on the face (C-grip): the hand on top of it, the cup's height and the palm above the face. */
const MASK_BACK: V3 = [0, 0.095, -0.01]

/** The pose of every action mode, by mode name. */
export const ACTION_DEFS: Readonly<Record<string, ActionDef>> = {
  sterile: A({ L: CLASP_L, R: CLASP_R, lean: 0, head: 0, aim: false, sterile: true }),
  aWatchField: A({ L: CLASP_L, R: CLASP_R, leanBase: 0.07, lean: 0, head: 1, aim: false }),
  aWatchMonitor: A({ L: CLASP_L, R: CLASP_R, lean: 0, head: 0, aim: false }),
  aTalk: A({
    L: H({ off: [0.07, 0.03, -0.03], pron: [-1.1, -1.1], wing: 0.3 }),
    R: H({ at: 'body', off: [-0.17, 0.97, 0.16], stroke: 'line', amp: 0.02, dir: [0, 1, 0.3], arm: [0.45, 0.12, 0, 1.0, 0, 0.3] }),
    leanBase: 0.05,
    lean: 0.6,
    head: 0,
    reps: 3,
    aim: false,
  }),
  aChart: A({
    L: H({ at: 'body', off: [0.1, 1.12, 0.31], stroke: 'pump', amp: 0.015, dir: [0, -1, 0], arm: [0.95, 0.12, 0, 1.7, -0.3, 0.9], pron: [0.9, 0.9] }),
    R: H({ at: 'body', off: [-0.11, 1.07, 0.27], arm: [0.95, 0.1, 0, 1.75, -0.35, 0.8], pron: [0.8, 0.8] }),
    lean: 0,
    head: 0,
    headBase: 0.4,
    reps: 6,
    aim: false,
  }),
  aCount: A({
    L: H({ off: [0, 0.08, -0.04], stroke: 'line', amp: 0.05, dir: [1, 0, 0], pron: [-0.8, -0.8] }),
    R: H({ at: 'body', off: [-0.11, 1.07, 0.27], arm: [0.95, 0.1, 0, 1.75, -0.35, 0.8], pron: [0.8, 0.8] }),
    lean: 0.8,
    head: 1,
    reps: 8,
    aim: false,
  }),
  aTransfer: A({
    L: H({ off: [0.22, 0, -0.05], stroke: 'pull', amp: 0.15, dir: [0, 0.1, -1], pron: [-1.2, -1.2], wing: 0.4 }),
    R: H({ off: [-0.22, 0, -0.05], stroke: 'pull', amp: 0.15, dir: [0, 0.1, -1], pron: [-1.2, -1.2], wing: 0.4 }),
    leanBase: 0.1,
    lean: 1.2,
    head: 0.6,
    aim: false,
  }),
  aPosition: A({
    L: H({ off: [0.15, 0.02, 0], stroke: 'line', amp: 0.03, dir: [0, 1, 0], pron: [-1, -1], wing: 0.35 }),
    R: H({ off: [-0.15, 0.02, 0], stroke: 'line', amp: 0.03, dir: [0, 1, 0], pron: [-1, -1], wing: 0.35 }),
    lean: 1,
    head: 0.7,
    reps: 2,
    aim: false,
  }),
  aAttach: A({
    L: H({ off: [0.12, 0.03, 0.02], pron: [-1.2, -1.2] }),
    R: H({ off: [-0.03, 0.03, 0], stroke: 'pump', amp: 0.015, dir: [0, -1, 0], pron: [-1.2, -1.2] }),
    lean: 1,
    head: 0.8,
    reps: 4,
    aim: false,
  }),
  aPreox: A({
    // the mask in the LEFT hand over the face (a C-grip: the hand on top of the mask), the right hand on the far side of the head
    L: H({ back: MASK_BACK, pron: [-1.2, -1.2], wing: 0.45 }),
    R: H({ off: [-0.09, 0.03, -0.05], pron: [-1.0, -1.0], wing: 0.35 }),
    leanBase: 0.12,
    lean: 1.2,
    head: 0.9,
  }),
  aInject: A({
    R: H({ back: [-0.02, 0.06, -0.1], pron: [0, 0], tool: 'progress' }),
    L: H({ off: [0.05, 0, 0.04], pron: [-1, -1] }),
    lean: 0.8,
    head: 0.8,
  }),
  aBagMask: A({
    // the mask over the face in the left hand, the bag squeezed by the right, 12 breaths a minute of sim time
    L: H({ back: MASK_BACK, pron: [-1.2, -1.2], wing: 0.45 }),
    R: H({ off: [-0.05, 0.1, -0.22], stroke: 'pump', amp: 0.03, dir: [1, 0, 0.2], pron: [0.3, 0.3], tool: 'stroke' }),
    leanBase: 0.08,
    lean: 1,
    head: 0.7,
    hz: 0.2,
  }),
  aIntubate: A({
    // the laryngoscope in the LEFT hand, lifted up and away (45 degrees) as the step goes on; the tube in the right goes into the mouth
    L: H({ off: [0, -0.02, 0.06], back: [0.02, 0.11, -0.06], stroke: 'pull', amp: 0.03, dir: [0, 0.707, 0.707], pron: [-0.4, -0.4], wing: 0.55 }),
    R: H({ off: [-0.02, 0, 0], back: [-0.05, 0.1, -0.07], stroke: 'pull', amp0: 0.07, amp: 0, dir: [-0.3, 0.5, -0.8], pron: [0.2, 0.2] }),
    leanBase: 0.35,
    lean: 0.6,
    head: 1,
  }),
  aSecure: A({
    L: H({ off: [0.03, 0.03, 0], pron: [-0.8, -0.8] }),
    R: H({ off: [-0.04, 0.02, 0.02], stroke: 'line', amp: 0.02, dir: [1, 0, 0], pron: [-1, -1] }),
    leanBase: 0.15,
    lean: 1,
    head: 0.9,
    reps: 4,
    aim: false,
  }),
  aExtubate: A({
    R: H({ back: [-0.02, 0.1, -0.04], stroke: 'pull', amp: 0.18, dir: [0, 1, -0.3], pron: [0, 0] }),
    L: H({ off: [0.05, 0.03, -0.02], pron: [-1, -1] }),
    leanBase: 0.12,
    lean: 1,
    head: 0.8,
  }),
  aTilt: A({
    L: HANG_L,
    R: H({ at: 'body', off: [-0.13, 1.08, 0.3], stroke: 'pump', amp: 0.004, dir: [0, -1, 0], arm: [0.9, 0.1, 0, 1.6, -0.2, 0.4], pron: [0.4, 0.4] }),
    lean: 0,
    head: 0.6,
    reps: 3,
    aim: false,
  }),
  aScrub: A({
    // hands above the elbows over the sink, each scrubbing along the other forearm, the two alternating
    L: H({ off: [0.07, 0.2, -0.14], stroke: 'line', amp: 0.06, dir: [0, -0.6, -0.8], pron: [0, 0], wing: 0.1, arm: [0.7, 0.1, 0, 2.0, 0.2, 0] }),
    R: H({ off: [-0.07, 0.2, -0.14], stroke: 'line', amp: 0.06, dir: [0, -0.6, -0.8], lag: 0.5, pron: [0, 0], wing: 0.1, arm: [0.7, 0.1, 0, 2.0, 0.2, 0] }),
    lean: 0.6,
    head: 0.8,
    reps: 10,
    aim: false,
  }),
  aGown: A({
    L: H({ at: 'body', off: [0.16, 1.22, 0.42], stroke: 'pull', amp: 0.08, dir: [0, 0.2, 1], pron: [0, 0] }),
    R: H({ at: 'body', off: [-0.16, 1.22, 0.42], stroke: 'pull', amp: 0.08, dir: [0, 0.2, 1], pron: [0, 0] }),
    lean: 0,
    head: 0,
    headBase: 0.15,
    aim: false,
    sterile: true,
  }),
  aPrep: A({
    // the sponge stick paints a spiral out from the incision site (3 cm to 15 cm over the step); the other hand stays clasped in the sterile zone
    L: CLASP_L,
    R: H({ back: [-0.05, 0.16, -0.14], stroke: 'spiral', amp0: 0.03, amp: 0.15, dir: [0, 1, 0], pron: [0.3, 0.3], wing: 0.35 }),
    lean: 1.3,
    head: 0.9,
    reps: 6,
    sterile: true,
  }),
  aDrape: A({
    L: H({ off: [0.3, 0.06, -0.1], stroke: 'pull', amp: 0.25, dir: [0, 0.15, 1], pron: [-1, -1], wing: 0.3 }),
    R: H({ off: [-0.3, 0.06, -0.1], stroke: 'pull', amp: 0.25, dir: [0, 0.15, 1], pron: [-1, -1], wing: 0.3 }),
    lean: 1.2,
    head: 0.7,
    aim: false,
    sterile: true,
  }),
  aUndrape: A({
    L: H({ off: [0.3, 0.06, 0.1], stroke: 'pull', amp: 0.25, dir: [0, 0.3, -1], pron: [-1, -1], wing: 0.3 }),
    R: H({ off: [-0.3, 0.06, 0.1], stroke: 'pull', amp: 0.25, dir: [0, 0.3, -1], pron: [-1, -1], wing: 0.3 }),
    lean: 1.2,
    head: 0.7,
    aim: false,
  }),
  aDrapeRobot: A({
    L: H({ off: [0.12, 0, -0.05], stroke: 'pull', amp: 0.3, dir: [0, 0.4, 1], pron: [-0.8, -0.8], wing: 0.4 }),
    R: H({ off: [-0.12, 0, -0.05], stroke: 'pull', amp: 0.3, dir: [0, 0.4, 1], pron: [-0.8, -0.8], wing: 0.4 }),
    lean: 0.5,
    head: 0.5,
    aim: false,
    sterile: true,
  }),
  aMark: A({
    R: H({ back: PENCIL_BACK, stroke: 'circle', amp: 0.012, dir: [0, 1, 0], pron: [0.2, 0.2], wing: 0.3 }),
    L: H({ off: [0.07, 0.01, 0], pron: [-1.3, -1.3] }),
    lean: 1.2,
    head: 1,
    reps: 4,
    sterile: true,
  }),
  aLocal: A({
    // three short passes of the needle under the skin while the plunger goes down over the step; the other hand stretches the skin
    R: H({ back: PENCIL_BACK, stroke: 'pump', amp: 0.012, dir: [0, -1, 0], pron: [0.2, 0.2], tool: 'progress', wing: 0.3 }),
    L: H({ off: [0.05, 0.01, 0.02], pron: [-1.3, -1.3] }),
    lean: 1.2,
    head: 1,
    reps: 3,
    sterile: true,
  }),
  aNick: A({
    // a 1 cm cut across the site with the scalpel; the other hand stretches the skin 4 cm away
    R: H({ back: PENCIL_BACK, stroke: 'pull', amp0: -0.005, amp: 0.005, dir: [1, 0, 0], pron: [0.2, 0.2], wing: 0.3 }),
    L: H({ off: [0.04, 0.005, 0], pron: [-1.3, -1.3] }),
    lean: 1.2,
    head: 1,
    sterile: true,
  }),
  aTrocar: A({
    // the palm on top of the trocar, twisting +-0.4 rad while it goes 6 cm in; the other hand steadies the abdominal wall
    R: H({ back: [0, 0.15, -0.03], stroke: 'twist', amp: 0.4, push: 0.06, dir: [0, -1, 0], pron: [-1.4, -1.4], wing: 0.45 }),
    L: H({ off: [0.05, 0.01, 0.03], pron: [-1.3, -1.3] }),
    lean: 1.4,
    head: 0.9,
    reps: 6,
    sterile: true,
  }),
  aScope: A({
    R: H({ back: [-0.02, 0.2, -0.17], pron: [0, 0], wing: 0.3 }),
    L: H({ off: [0.04, 0.07, -0.05], pron: [0.4, 0.4] }),
    lean: 0.8,
    head: 0,
    sterile: true,
  }),
  aInsufflate: A({
    R: H({ back: [0, 0.06, -0.04], pron: [0, 0] }),
    L: H({ off: [0.07, 0.05, -0.04], pron: [0, 0] }),
    lean: 1,
    head: 0.8,
    sterile: true,
  }),
  aCart: A({
    L: H({ off: [0.18, 0, 0], pron: [-1.4, -1.4], arm: [1.0, 0.1, 0, 0.35, 0, -1.4] }),
    R: H({ off: [-0.18, 0, 0], pron: [-1.4, -1.4], arm: [1.0, 0.1, 0, 0.35, 0, -1.4] }),
    leanBase: 0.14,
    lean: 0,
    head: 0,
    headBase: -0.1,
    aim: false,
  }),
  aDock: A({
    L: H({ off: [0.1, 0.02, -0.02], pron: [-1, -1], wing: 0.35 }),
    R: H({ off: [-0.08, 0, 0], stroke: 'line', amp: 0.02, dir: [0, 1, 0], pron: [-1, -1], wing: 0.35 }),
    lean: 0.6,
    head: 0.5,
    reps: 2,
    aim: false,
    sterile: true,
  }),
  aFit: A({
    R: H({ stroke: 'pull', amp0: 0.08, amp: 0, dir: [0, 0.6, -0.8], pron: [0, 0], wing: 0.3 }),
    L: H({ off: [0.06, 0.05, -0.03], pron: [-0.6, -0.6] }),
    lean: 0.8,
    head: 0.6,
    aim: false,
    sterile: true,
  }),
  aExchange: A({
    R: H({ stroke: 'line', amp: 0.06, dir: [0, 0.6, -0.8], pron: [0, 0], wing: 0.3 }),
    L: H({ off: [0.06, 0.05, -0.02], pron: [-0.6, -0.6] }),
    lean: 0.8,
    head: 0.6,
    aim: false,
    sterile: true,
  }),
  aPass: A({
    // the handle offered forward, palm down; the other hand waits clasped
    R: H({ pron: [-1.2, -1.2], arm: [1.1, 0.12, 0, 0.8, 0.1, -1.2], wing: 0.15 }),
    L: CLASP_L,
    lean: 0.4,
    head: 0.5,
    aim: false,
    sterile: true,
  }),
  aReceive: A({
    // palm up to take it
    R: H({ pron: [1.2, 1.2], arm: [1.1, 0.12, 0, 0.8, 0.1, 1.2], wing: 0.15 }),
    L: CLASP_L,
    lean: 0.4,
    head: 0.5,
    aim: false,
    sterile: true,
  }),
  aSuction: A({
    R: H({ back: LAP_BACK, stroke: 'line', amp: 0.03, dir: [0, 0.77, -0.64], pron: [0, 0], wing: 0.3 }),
    L: H({ off: [0.04, 0.05, -0.04], pron: [0.3, 0.3] }),
    lean: 0.9,
    head: 0,
    reps: 4,
    sterile: true,
  }),
  aRetract: A({
    R: H({ back: LAP_BACK, stroke: 'pull', amp: 0.02, dir: [0, 0.77, -0.64], pron: [0, 0], wing: 0.3 }),
    L: H({ off: [0.04, 0.05, -0.04], pron: [0.3, 0.3] }),
    lean: 0.9,
    head: 0,
    sterile: true,
  }),
  aClip: A({
    R: H({ back: LAP_BACK, stroke: 'pump', amp: 0, dir: [0, 1, 0], pron: [0, 0], tool: 'stroke', wing: 0.3 }),
    L: H({ off: [0.04, 0.05, -0.04], pron: [0.3, 0.3] }),
    lean: 0.9,
    head: 0,
    reps: 3,
    sterile: true,
  }),
  aBag: A({
    L: H({ off: [0.04, 0.05, -0.03], stroke: 'line', amp: 0.03, dir: [0, 1, 0], pron: [-0.6, -0.6] }),
    R: H({ off: [-0.04, 0.05, -0.03], stroke: 'line', amp: 0.03, dir: [0, 1, 0], lag: 0.5, pron: [-0.6, -0.6] }),
    lean: 1,
    head: 0.8,
    reps: 3,
    sterile: true,
  }),
  aRemove: A({
    L: H({ off: [0.05, 0.03, -0.02], stroke: 'pull', amp: 0.15, dir: [0, 1, -0.2], pron: [-1, -1] }),
    R: H({ off: [-0.03, 0.04, -0.02], stroke: 'pull', amp: 0.15, dir: [0, 1, -0.2], pron: [-1, -1] }),
    lean: 1,
    head: 0.9,
    aim: false,
    sterile: true,
  }),
  aSuture: A({
    // the needle holder in the right hand: a throw is an arc across the incision and under it, the hand pronating 0 -> 1.8; forceps in the left
    R: H({ back: [-0.04, 0.085, -0.06], stroke: 'arc', amp: 0.015, dir: [0, 1, 0], pron: [0, 1.8], wing: 0.35 }),
    L: H({ off: [0.025, 0, 0.01], back: [0.04, 0.085, -0.06], stroke: 'pump', amp: 0.01, dir: [0, 1, 0], lag: 0.3, pron: [0.2, 0.2], wing: 0.35 }),
    lean: 1.2,
    head: 1,
    reps: 6,
    sterile: true,
  }),
  aDress: A({
    R: H({ off: [-0.03, 0.01, 0], stroke: 'pump', amp: 0.008, dir: [0, -1, 0], pron: [-1.3, -1.3] }),
    L: H({ off: [0.04, 0.01, 0.01], stroke: 'pump', amp: 0.008, dir: [0, -1, 0], lag: 0.5, pron: [-1.3, -1.3] }),
    lean: 1.1,
    head: 0.9,
    reps: 2,
    aim: false,
    sterile: true,
  }),
  aNeedle: A({
    R: H({ back: [-0.01, 0.12, -0.04], stroke: 'pull', amp: 0.06, dir: [0, -1, 0], pron: [0, 0], wing: 0.3 }),
    L: H({ off: [0.05, 0.005, 0.02], pron: [-1.3, -1.3] }),
    lean: 1.2,
    head: 0.9,
    sterile: true,
  }),
  aUnneedle: A({
    R: H({ back: [-0.01, 0.12, -0.04], stroke: 'pull', amp: 0.1, dir: [0, 1, 0], pron: [0, 0], wing: 0.3 }),
    L: H({ off: [0.05, 0.005, 0.02], pron: [-1.3, -1.3] }),
    lean: 1.2,
    head: 0.9,
    sterile: true,
  }),
  aScan: A({
    R: H({ off: [0, 0.02, 0], stroke: 'circle', amp: 0.02, dir: [0, 1, 0], pron: [-0.6, -0.6] }),
    L: H({ at: 'body', off: [0.18, 0.95, 0.15], arm: [0.5, 0.12, 0, 1.2, 0, 0.3] }),
    lean: 0.8,
    head: 0.5,
    reps: 3,
    aim: false,
  }),
  aKeyboard: A({
    L: H({ off: [0.1, 0.02, -0.03], stroke: 'line', amp: 0.006, dir: [0, 1, 0], pron: [-1.3, -1.3] }),
    R: H({ off: [-0.1, 0.02, -0.03], stroke: 'line', amp: 0.006, dir: [0, 1, 0], lag: 0.37, pron: [-1.3, -1.3] }),
    lean: 0.5,
    head: 0.5,
    reps: 30,
    aim: false,
  }),
  aWipe: A({
    R: H({ stroke: 'circle', amp: 0.12, dir: [0, 1, 0], pron: [-1.3, -1.3] }),
    L: H({ off: [0.25, 0, 0], pron: [-1.3, -1.3] }),
    lean: 1,
    head: 0.7,
    reps: 6,
    aim: false,
  }),
}

/** The action modes (every mode from 'sterile' on). */
export const ACTION_MODES: readonly string[] = Object.keys(ACTION_DEFS)

// ---------------------------------------------------------------------------------------------
// The evaluator (allocation-free: everything lives in module scratch)
// ---------------------------------------------------------------------------------------------

/** Per hand: tip x, y, z, hand x, y, z, stroke param, pronation (left at 0, right at 8). */
const HS = new Float64Array(16)

const frac = (x: number): number => x - Math.floor(x)

/**
 * One hand of `def`: its tip and its middle (written into HS at `at8`), the reach target, the aim point, the arm's fallback angles, its pronation, its
 * elbow and its tool's moving part (into `o`). `other` is the offset in HS of the other hand's (already computed) tip.
 */
function evalHand(h: HandDef, def: ActionDef, side: 1 | -1, c: PoseCtx, o: Float32Array, at8: number, other: number, prog: number): void {
  const k = 1 / c.size
  const gain = c.strokeGain
  // the anchor
  let ax = 0
  let ay = 0
  let az = 0
  switch (h.at) {
    case 'target': {
      const t = side === 1 ? c.tL : c.tR
      ax = t[0]
      ay = t[1]
      az = t[2]
      break
    }
    case 'other':
      ax = HS[other]
      ay = HS[other + 1]
      az = HS[other + 2]
      break
    case 'sterile':
      ax = side * STERILE_CLASP.x
      ay = STERILE_CLASP.y
      az = STERILE_CLASP.z
      break
    default:
      break
  }
  // world metres are scaled to this person's nominal frame; a body point is the body's own (it scales with the person)
  const ok = h.at === 'body' ? 1 : k
  let tx = ax + h.off[0] * ok
  let ty = ay + h.off[1] * ok
  let tz = az + h.off[2] * ok
  // the stroke
  const phase = def.hz > 0 ? frac(c.simT * def.hz - h.lag) : frac(prog * def.reps - h.lag)
  const w = TAU * phase
  let dx = 0
  let dy = 0
  let dz = 0
  let u = 0
  let pronOsc = 0
  const d = h.dir
  switch (h.stroke) {
    case 'line': {
      const s = Math.sin(w)
      const a = h.amp * s * gain
      dx = a * d[0]
      dy = a * d[1]
      dz = a * d[2]
      u = 0.5 + 0.5 * s
      break
    }
    case 'circle':
    case 'spiral': {
      // a spiral keeps its radius when the stroke fades (it settles on one side of the site), a circle shrinks to its centre
      const spiral = h.stroke === 'spiral'
      const r = spiral ? h.amp0 + (h.amp - h.amp0) * prog : h.amp * gain
      const cw = spiral ? gain * Math.cos(w) + (1 - gain) : Math.cos(w)
      const sw = spiral ? gain * Math.sin(w) : Math.sin(w)
      dx = r * (cw * h.e1[0] + sw * h.e2[0])
      dy = r * (cw * h.e1[1] + sw * h.e2[1])
      dz = r * (cw * h.e1[2] + sw * h.e2[2])
      u = spiral ? prog : 0.5 + 0.5 * sw
      break
    }
    case 'arc': {
      // a throw: 70 % of the cycle across and under the incision, the rest back over it
      const throwing = phase < 0.7
      u = throwing ? smoothstep(0, 1, phase / 0.7) : 1 - smoothstep(0, 1, (phase - 0.7) / 0.3)
      const th = Math.PI * u
      const across = -Math.cos(th) * h.amp * gain
      const depth = (throwing ? -0.6 : 0.8) * Math.sin(th) * h.amp * gain
      dx = across * h.e1[0] + depth * d[0]
      dy = across * h.e1[1] + depth * d[1]
      dz = across * h.e1[2] + depth * d[2]
      u *= gain
      break
    }
    case 'pump': {
      const s = Math.sin(Math.PI * phase)
      u = s * s
      const a = h.amp * u * gain
      dx = a * d[0]
      dy = a * d[1]
      dz = a * d[2]
      u *= gain
      break
    }
    case 'twist': {
      const s = Math.sin(w)
      pronOsc = h.amp * s * gain
      const a = h.push * prog
      dx = a * d[0]
      dy = a * d[1]
      dz = a * d[2]
      u = 0.5 + 0.5 * s
      break
    }
    case 'pull': {
      const a = h.amp0 + (h.amp - h.amp0) * smoothstep(0, 1, prog)
      dx = a * d[0]
      dy = a * d[1]
      dz = a * d[2]
      u = prog
      break
    }
    default:
      break
  }
  tx += dx * k
  ty += dy * k
  tz += dz * k
  // the middle of the hand, back from the tip
  let hx = tx + h.back[0] * k
  let hy = ty + h.back[1] * k
  let hz = tz + h.back[2] * k
  if (def.sterile) hy = clamp(hy, c.standPelvis + STERILE_BAND.abovePelvis * k, c.shoulderY - STERILE_BAND.underShoulder * k)
  // a hand that would go through the body is kept in front of it
  if (hz < 0.12) hz = 0.12
  HS[at8] = tx
  HS[at8 + 1] = ty
  HS[at8 + 2] = tz
  HS[at8 + 3] = hx
  HS[at8 + 4] = hy
  HS[at8 + 5] = hz
  HS[at8 + 6] = u
  // the outputs
  const base = side === 1 ? ARM_L : ARM_R
  const a = h.arm
  const pron = h.pron[0] + (h.pron[1] - h.pron[0]) * u + pronOsc
  o[base] = a[0]
  o[base + 1] = a[1]
  o[base + 2] = a[2]
  o[base + 3] = a[3]
  o[base + 4] = a[4]
  o[base + 5] = pron
  const r = side === 1 ? REACH_L : REACH_R
  o[r] = 1
  o[r + 1] = hx
  o[r + 2] = hy
  o[r + 3] = hz
  o[side === 1 ? U.lWing : U.rWing] = h.wing
  if (def.aim) {
    const m = side === 1 ? AIM_L : AIM_R
    o[m] = 1
    o[m + 1] = tx
    o[m + 2] = ty
    o[m + 3] = tz
  }
  o[side === 1 ? U.lTool : U.rTool] = h.tool === 'progress' ? prog : h.tool === 'stroke' ? u : 0
  o[side === 1 ? U.lSpin : U.rSpin] = (h.pron[1] - h.pron[0]) * u + pronOsc
}

/** Fill `o` (UP_COUNT floats, zeroed by the caller) with the pose of an action def at the step progress `prog` (default: the context's). */
export function evalAction(def: ActionDef, c: PoseCtx, o: Float32Array, prog = c.prog): void {
  // a hand that works from the other hand's tip is computed second
  if (def.R.at === 'other') {
    evalHand(def.L, def, 1, c, o, 0, 8, prog)
    evalHand(def.R, def, -1, c, o, 8, 0, prog)
  } else {
    evalHand(def.R, def, -1, c, o, 8, 0, prog)
    evalHand(def.L, def, 1, c, o, 0, 8, prog)
  }
  const breath = Math.sin(TAU * c.breathHz * c.t + c.seed)
  // the chest leans in for a far or a low reach and turns a third of the way to it
  const mx = (HS[3] + HS[11]) * 0.5
  const my = (HS[4] + HS[12]) * 0.5
  const mz = (HS[5] + HS[13]) * 0.5
  const reachOut = Math.max(0, mz - LEAN_FROM.z) + 0.6 * Math.max(0, LEAN_FROM.y - my)
  const chestPitch = clamp(def.leanBase + def.lean * reachOut, 0, LEAN_FROM.max)
  const towards = def.lean > 0 || def.leanBase > 0 ? clamp(0.35 * Math.atan2(mx, Math.max(mz, 0.15)), -0.35, 0.35) : 0
  o[U.chestPitch] = chestPitch + 0.008 * breath
  o[U.chestYaw] = towards
  // the head pitches down to the work point (the look-at turns it up to 25 degrees down; the chest's lean gives it half of its own)
  const wx = (c.tL[0] + c.tR[0]) * 0.5
  const wy = (c.tL[1] + c.tR[1]) * 0.5
  const wz = (c.tL[2] + c.tR[2]) * 0.5
  const eye = c.shoulderY + 0.24
  const down = Math.atan2(eye - wy, Math.max(wz, 0.15))
  o[U.headPitch] = def.head * clamp(down - (c.hasLook ? 0.44 : 0) - 0.5 * chestPitch, 0, 0.75) + def.headBase + 0.01 * breath
  o[U.headYaw] = c.hasLook ? 0 : def.head * clamp(0.7 * Math.atan2(wx, Math.max(wz, 0.15)) - towards, -0.8, 0.8)
}

/** Dispatch of pose.ts evalMode for the action modes: the mode's def, or the sterile rest for a mode this table does not know. */
export function evalActionMode(mode: Mode, c: PoseCtx, o: Float32Array): void {
  const def = ACTION_DEFS[mode] ?? ACTION_DEFS.sterile
  // each mode at the progress of its own step (a mode blending out keeps its last one)
  evalAction(def, c, o, c.modeProg[MODE_INDEX[mode]])
}

/** The tip of each hand from the last `evalAction` (nominal body frame): for tests. */
export function lastTips(out: number[]): number[] {
  out[0] = HS[0]
  out[1] = HS[1]
  out[2] = HS[2]
  out[3] = HS[8]
  out[4] = HS[9]
  out[5] = HS[10]
  return out
}
