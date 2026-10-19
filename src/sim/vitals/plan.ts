/**
 * W4 health kiosks: the timed script of one session, drawn once when it starts from the session's own seeded stream (so the same seed gives the same
 * session, whatever else the hospital does in between).
 *
 *   full    calling, login, height, weight, bodyFat, sit, spo2, bp, bpRest, bp, [bpRest (3 min), bp], temp, report
 *   vitals  the short ER session: login, sit, spo2, bp (one reading), temp, report          (no height, weight or body fat)
 *   player  your demo session: the 'full' script with one cuff reading, squeezed into CONFIG.vitals.playerSessionSeconds
 *
 * The third cuff reading is not in `steps`: it waits in `extra` and is spliced in only when the first two differ by more than the repeat delta.
 */
import { CONFIG } from '../config'
import type { Rng } from '../rng'
import type { HealthKioskPhase, HealthSessionKind } from '../types'
import { TUNING } from './tuning'

export type TimedPhase = Exclude<HealthKioskPhase, 'idle' | 'calling'>

export interface Step {
  phase: TimedPhase
  /** Seconds. */
  dur: number
}

export interface Plan {
  steps: Step[]
  /** The rest and the third cuff reading, spliced in after the second reading when the two disagree. */
  extra: [Step, Step]
}

const sum = (steps: readonly Step[]): number => steps.reduce((a, s) => a + s.dur, 0)

export function buildPlan(kind: HealthSessionKind, rng: Rng, assisted: boolean): Plan {
  const c = CONFIG.vitals
  const f = assisted ? c.assistFactor : 1
  const d = (span: readonly [number, number]): number => rng.between(span) * f
  // every session draws the same numbers in the same order, whatever its kind, so the stream stays aligned
  const login = d(c.loginSeconds)
  const height = d(c.heightSeconds)
  const weight = d(c.weightSeconds)
  const bodyFat = d(c.bodyFatSeconds)
  const sit = d(c.sitSeconds)
  const spo2 = d(c.spo2Seconds)
  const bp1 = d(c.bpSeconds)
  const bp2 = d(c.bpSeconds)
  const bp3 = d(c.bpSeconds)
  const temp = d(c.tempSeconds) + TUNING.standUpSeconds
  const report = Math.max(c.screenHoldSeconds, d(c.reportSeconds))
  let gap = c.bpGapSeconds * f

  if (kind === 'player') {
    // the same script, one cuff reading, squeezed to the demo length (no random draws needed for the proportions)
    const w = { login: 4, height: 3, weight: 2.5, bodyFat: 4, sit: 2.2, spo2: 5, bp: 13.5, temp: 1.8, report: 4 }
    const k = c.playerSessionSeconds / (w.login + w.height + w.weight + w.bodyFat + w.sit + w.spo2 + w.bp + w.temp + w.report)
    return {
      steps: [
        { phase: 'login', dur: w.login * k },
        { phase: 'height', dur: w.height * k },
        { phase: 'weight', dur: w.weight * k },
        { phase: 'bodyFat', dur: w.bodyFat * k },
        { phase: 'sit', dur: w.sit * k },
        { phase: 'spo2', dur: w.spo2 * k },
        { phase: 'bp', dur: w.bp * k },
        { phase: 'temp', dur: w.temp * k },
        { phase: 'report', dur: w.report * k },
      ],
      extra: [
        { phase: 'bpRest', dur: 0 },
        { phase: 'bp', dur: 0 },
      ],
    }
  }

  const extra: [Step, Step] = [
    { phase: 'bpRest', dur: c.bpRepeatRestSeconds },
    { phase: 'bp', dur: bp3 },
  ]

  if (kind === 'vitals') {
    const steps: Step[] = [
      { phase: 'login', dur: login },
      { phase: 'sit', dur: sit },
      { phase: 'spo2', dur: spo2 },
      { phase: 'bp', dur: bp1 },
      { phase: 'temp', dur: temp },
      { phase: 'report', dur: report },
    ]
    const total = sum(steps)
    if (total > TUNING.vitalsSessionCapSeconds) {
      const k = TUNING.vitalsSessionCapSeconds / total
      for (const s of steps) s.dur *= k
    }
    return { steps, extra }
  }

  const head: Step[] = [
    { phase: 'login', dur: login },
    { phase: 'height', dur: height },
    { phase: 'weight', dur: weight },
    { phase: 'bodyFat', dur: bodyFat },
    { phase: 'sit', dur: sit },
    { phase: 'spo2', dur: spo2 },
  ]
  const tail: Step[] = [
    { phase: 'temp', dur: temp },
    { phase: 'report', dur: report },
  ]
  const bps = bp1 + bp2
  if (!assisted) {
    // an unassisted two-reading session fits the research's "3 to 5 minutes": the rest between the cuff readings gives way
    const total = sum(head) + bps + gap + sum(tail)
    if (total > TUNING.fullSessionCapSeconds) gap = Math.max(TUNING.minBpGapSeconds, gap - (total - TUNING.fullSessionCapSeconds))
  }
  return {
    steps: [...head, { phase: 'bp', dur: bp1 }, { phase: 'bpRest', dur: gap }, { phase: 'bp', dur: bp2 }, ...tail],
    extra,
  }
}
