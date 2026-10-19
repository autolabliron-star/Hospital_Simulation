/**
 * The robot's plan for one draw: every duration and every chance outcome, drawn ONCE when the draw begins, from the station's own rng fork.
 * Pure (no world, no clock): the station script (station.ts) just plays the plan back, and the tests read it.
 *
 * Numbers: src/sim/config.ts `blood` (MagicNurse 205 s for 4 tubes, 94.3 % of 6,016 patients; Vitestro Aletta median 2:37, 94.5 % first
 * stick when a vein was found, about 6 % no suitable vein, one supervisor per 3 robots).
 *
 * Every draw consumes the same number of random values whatever the outcome (all branches are rolled up front), so one patient's
 * outcome never shifts the next patient's plan.
 */
import { LAB_CATALOGUE } from '@/content/lab'
import { CONFIG } from '../config'
import type { TubeKind } from '../types'

/** What the plan needs from a random stream (`Rng` satisfies it; the tests stub it to force a branch). */
export interface PlanRng {
  between(span: readonly [number, number]): number
  chance(p: number): boolean
  int(min: number, max: number): number
}

/** One needle attempt: the vein scan before it, the insertion, and whether the stick misses. */
export interface DrawAttempt {
  veinScan: number
  needleIn: number
  missed: boolean
}

export interface TubePlan {
  kind: TubeKind
  /** Seconds the tube takes to fill. */
  fill: number
  /** How many times it is tipped (content: lab.json), at `inversionSeconds` each. */
  inversions: number
  inversionSeconds: number
}

/** An arm move: during which tube (index in order of draw) and how far into its fill (0..1). */
export interface ArmMove {
  tube: number
  at: number
}

/** The second try after the arm moved: robot steps from the cuff on again, then maybe a second move. */
export interface RetryPlan {
  cuff: number
  sanitise: number
  veinScan: number
  needleIn: number
  /** Seconds the nurse spends calming the patient before the retry. */
  reassure: number
  secondMove: ArmMove | null
}

export interface DrawPlan {
  cardScan: number
  armIn: number
  cuff: number
  sanitise: number
  /** Where along the forearm (0..1) the scan head settles on the vein. */
  veinPos: number
  /** The first scan finds no suitable vein (about 6 %): to the nurse. */
  noVein: boolean
  /** The needle attempts in order (config.blood.maxRobotAttempts of them are rolled; the robot stops at the first that does not miss). */
  attempts: DrawAttempt[]
  tubes: TubePlan[]
  needleOut: number
  bandage: number
  release: number
  reset: number
  /** The arm moves during the draw (about 1.5 %), or null. */
  armMove: ArmMove | null
  retry: RetryPlan
  /** The nurse's hand draw (for all remaining tubes; scaled in `manualSecondsFor`). */
  manualSeconds: number
}

/** Why the nurse takes over (the draw copy uses it). */
export type NurseReason = 'noVein' | 'missed' | 'moved'

/** The result a plan leads to when nothing else interferes: the robot, or the nurse and why. */
export type PlannedOutcome = { by: 'robot'; attempt: number } | { by: 'nurse'; reason: NurseReason }

export function tubeTimings(kind: TubeKind, fill: number): TubePlan {
  return { kind, fill, inversions: LAB_CATALOGUE.tubes[kind].inversions, inversionSeconds: CONFIG.blood.inversionSeconds }
}

export function planDraw(rng: PlanRng, kinds: readonly TubeKind[]): DrawPlan {
  const b = CONFIG.blood
  const cardScan = rng.between(b.cardScanSeconds)
  const armIn = rng.between(b.armInSeconds)
  const cuff = rng.between(b.cuffSeconds)
  const sanitise = rng.between(b.sanitiseSeconds)
  const noVein = rng.chance(b.noVeinChance)
  const veinPos = rng.between([0.45, 0.8])
  const attempts: DrawAttempt[] = []
  for (let k = 0; k < b.maxRobotAttempts; k++) {
    attempts.push({ veinScan: rng.between(b.veinScanSeconds), needleIn: rng.between(b.needleInSeconds), missed: rng.chance(b.firstStickMissChance) })
  }
  const tubes = kinds.map((kind) => tubeTimings(kind, rng.between(b.fillSeconds[kind])))
  const needleOut = rng.between(b.needleOutSeconds)
  const bandage = rng.between(b.bandageSeconds)
  const release = rng.between(b.releaseSeconds)
  const reset = rng.between(b.resetSeconds)
  const n = Math.max(1, kinds.length)
  const moves = rng.chance(b.armMoveChance)
  const moveTube = rng.int(0, n - 1)
  const moveAt = rng.between([0.15, 0.9])
  const retry: RetryPlan = {
    cuff: rng.between(b.cuffSeconds),
    sanitise: rng.between(b.sanitiseSeconds),
    veinScan: rng.between(b.veinScanSeconds),
    needleIn: rng.between(b.needleInSeconds),
    reassure: rng.between(b.reassureSeconds),
    secondMove: null,
  }
  const second = rng.chance(b.armMoveChance)
  const secondTube = rng.int(0, n - 1)
  const secondAt = rng.between([0.15, 0.9])
  if (second) retry.secondMove = { tube: secondTube, at: secondAt }
  const manualSeconds = rng.between(b.manualDrawSeconds)
  return {
    cardScan,
    armIn,
    cuff,
    sanitise,
    veinPos,
    noVein,
    attempts,
    tubes,
    needleOut,
    bandage,
    release,
    reset,
    armMove: moves ? { tube: moveTube, at: moveAt } : null,
    retry,
    manualSeconds,
  }
}

/** The hand draw takes the planned time for a full set of tubes and a little less for fewer remaining. */
export function manualSecondsFor(plan: DrawPlan, remainingTubes: number): number {
  const n = Math.max(1, plan.tubes.length)
  return plan.manualSeconds * (0.5 + 0.5 * Math.min(1, remainingTubes / n))
}

/** Seconds a tube takes in the cradle: filling plus the tipping that mixes it. */
export function tubeSeconds(t: TubePlan): number {
  return t.fill + t.inversions * t.inversionSeconds
}

/** How the plan ends when played straight through. */
export function plannedOutcome(plan: DrawPlan): PlannedOutcome {
  if (plan.noVein) return { by: 'nurse', reason: 'noVein' }
  const k = plan.attempts.findIndex((a) => !a.missed)
  if (k < 0) return { by: 'nurse', reason: 'missed' }
  if (plan.armMove !== null && plan.retry.secondMove !== null) return { by: 'nurse', reason: 'moved' }
  return { by: 'robot', attempt: k + 1 }
}

/**
 * Seconds from the card scan to the bandage on the plan's straight path (the first stick holds; no move; no nurse): the figure the research
 * quotes (MagicNurse 205 s for 4 tubes, Aletta median 157 s).
 */
export function straightSeconds(plan: DrawPlan): number {
  const a = plan.attempts[0]
  let s = plan.cardScan + plan.armIn + plan.cuff + plan.sanitise + a.veinScan + a.needleIn + plan.needleOut + plan.bandage
  for (const t of plan.tubes) s += tubeSeconds(t)
  return s
}
