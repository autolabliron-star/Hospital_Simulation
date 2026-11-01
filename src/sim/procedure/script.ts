/**
 * R5: the step-by-step engine, part 1: compile a procedure script once (at module load), then lay a case's steps out (`caseSteps`).
 *
 *   compileScript   everything a frame needs, precomputed from the script's JSON: the steps of each unit, the patient pose after every
 *                   step (the deltas folded), the endoscope stage in force, what each role does at each step, the arm instrument changes
 *   caseSteps       one case's step weights: in the living day the middle of each step's real-minute band, nudged by a seeded jitter drawn
 *                   from a NEW fork the caller passes (`caseRng.fork('script')`: never an existing stream, so the day plans stay byte-identical);
 *                   in a watch case the script's watch seconds. Repeated steps (cryo: one run per needle) are expanded here.
 *
 * Nothing here is random except that jitter, and nothing here touches the world: `stepAt` (./timing.ts) turns a case's steps plus a unit's
 * time window into the step under the clock, `patientAt` (./patient.ts) into the table pose, `fillView` (./view.ts) into the published view.
 */
import {
  PROCEDURE_SCRIPTS,
  ROLES_BY_MACHINE,
  UNITS,
  type ProcedureScript,
  type ProcedureStep,
} from '@/content/procedures'
import { CONFIG } from '../config'
import type { Rng } from '../rng'
import type { PatientPoseView, ProcAction, ProcAnchor, ProcMachine, ProcRole, ProcTarget, ProcedureId, ToolKind } from '../types'

/** One role's line at a step, normalised (no undefined). */
export interface CompiledRole {
  action: ProcAction
  anchor: ProcAnchor
  look: ProcTarget | null
  work: ProcTarget | null
  left: ToolKind
  right: ToolKind
  /** No line of its own at this step: the role stays where it was (the nearest line of the unit), idle, hands free. */
  held: boolean
}

/** An instrument change on a robot arm, at the start of a console step. */
export interface ArmChange {
  /** The script step it belongs to. */
  step: number
  arm: 0 | 2 | 3
  instrument: string
}

export interface CompiledScript {
  readonly script: ProcedureScript
  readonly id: ProcedureId
  readonly machine: ProcMachine
  /** The roles of the machine, in the order of `ProcedureView.roles`. */
  readonly roles: readonly ProcRole[]
  /** Script steps. */
  readonly n: number
  /** The units that have at least one step, in order, and each one's ordinal. */
  readonly units: readonly string[]
  readonly unitIndex: ReadonlyMap<string, number>
  /** Per unit ordinal: the first script step and how many script steps (the steps of a unit are consecutive). */
  readonly unitFirst: Int16Array
  readonly unitLen: Int16Array
  /** Per script step: its unit ordinal, and its slot name (null: none). */
  readonly unitOf: Int16Array
  readonly slotOf: readonly (string | null)[]
  /** The repeat run (script steps, from `repeatFrom`, `repeatLen` long; -1 and 0: none). */
  readonly repeatFrom: number
  readonly repeatLen: number
  /** The patient pose when each step has finished (the deltas folded in script order). The first step starts from `script.start`. */
  readonly poseAfter: readonly PatientPoseView[]
  /** The endoscope stage key in force at each step (carried forward), or null. */
  readonly scopeAt: readonly (string | null)[]
  /** Per script step, per role (index in `roles`): the role's line, or null when the role has no line anywhere in that unit. */
  readonly roleAt: readonly (readonly (CompiledRole | null)[])[]
  /** The arms' instruments when the arms have docked (empty for a script without a robot). */
  readonly baseArms: readonly string[]
  readonly armChanges: readonly ArmChange[]
}

const lineOf = (s: ProcedureStep['roles'][ProcRole]): CompiledRole | null =>
  s === undefined
    ? null
    : { action: s.do, anchor: s.at, look: s.look ?? null, work: s.work ?? null, left: s.left ?? 'none', right: s.right ?? 'none', held: false }

function foldPoses(script: ProcedureScript): PatientPoseView[] {
  const out: PatientPoseView[] = []
  let cur: PatientPoseView = { ...script.start }
  for (const step of script.steps) {
    cur = { ...cur, ...(step.patient ?? {}) }
    out.push(cur)
  }
  return out
}

/** Compile a parsed script. Pure: the same script always gives the same result. */
export function compileScript(script: ProcedureScript): CompiledScript {
  const steps = script.steps
  const n = steps.length
  const machine = script.machine
  const roles = ROLES_BY_MACHINE[machine]

  // units that have steps, in the machine's order
  const units: string[] = []
  const unitOf = new Int16Array(n)
  const first: number[] = []
  const len: number[] = []
  for (const unit of UNITS[machine]) {
    const idx = steps.map((s, i) => (s.unit === unit ? i : -1)).filter((i) => i >= 0)
    if (idx.length === 0) continue
    const u = units.length
    units.push(unit)
    first.push(idx[0])
    len.push(idx.length)
    for (const i of idx) unitOf[i] = u
  }
  const unitIndex = new Map<string, number>(units.map((u, i) => [u, i]))

  const rep = steps.map((s, i) => (s.repeat === true ? i : -1)).filter((i) => i >= 0)

  // what each role does: its own line, or (a role with lines elsewhere in the unit) a held line, or null
  const roleAt: (CompiledRole | null)[][] = steps.map(() => roles.map(() => null))
  units.forEach((_, u) => {
    for (let r = 0; r < roles.length; r++) {
      const lines: (CompiledRole | null)[] = []
      for (let i = first[u]; i < first[u] + len[u]; i++) lines.push(lineOf(steps[i].roles[roles[r]]))
      if (lines.every((l) => l === null)) continue
      for (let j = 0; j < lines.length; j++) {
        let line = lines[j]
        if (line === null) {
          // hold the nearest earlier line's place, else the nearest later one's
          let src: CompiledRole | null = null
          for (let k = j - 1; k >= 0 && src === null; k--) src = lines[k]
          for (let k = j + 1; k < lines.length && src === null; k++) src = lines[k]
          line = { action: 'idle', anchor: src!.anchor, look: src!.look, work: null, left: 'none', right: 'none', held: true }
        }
        roleAt[first[u] + j][r] = line
      }
    }
  })

  const scopeAt: (string | null)[] = []
  let scope: string | null = null
  for (const s of steps) {
    if (s.scope !== undefined) scope = s.scope
    scopeAt.push(scope)
  }

  const armChanges: ArmChange[] = []
  steps.forEach((s, i) => {
    if (s.arms === undefined) return
    for (const key of ['0', '2', '3'] as const) {
      const instrument = s.arms[key]
      if (instrument !== undefined) armChanges.push({ step: i, arm: Number(key) as 0 | 2 | 3, instrument })
    }
  })

  return {
    script,
    id: script.id,
    machine,
    roles,
    n,
    units,
    unitIndex,
    unitFirst: Int16Array.from(first),
    unitLen: Int16Array.from(len),
    unitOf,
    slotOf: steps.map((s) => s.slot ?? null),
    repeatFrom: rep.length > 0 ? rep[0] : -1,
    repeatLen: rep.length,
    poseAfter: foldPoses(script),
    scopeAt,
    roleAt,
    baseArms: script.robotArms ?? [],
    armChanges,
  }
}

/** Every script written so far, compiled once at module load. */
export const COMPILED_SCRIPTS: Partial<Record<ProcedureId, CompiledScript>> = Object.fromEntries(
  Object.entries(PROCEDURE_SCRIPTS).map(([id, script]) => [id, compileScript(script)]),
)

export function compiledFor(id: ProcedureId): CompiledScript | undefined {
  return COMPILED_SCRIPTS[id]
}

// ---------------------------------------------------------------------------------------------
// A case's steps
// ---------------------------------------------------------------------------------------------

export type StepMode = 'live' | 'watch'

/**
 * One case's steps laid out: the script's steps in order with the repeat run played `repeatN` times (the "flat" steps), each with its weight,
 * and the running weights `stepAt` tiles a window with: within the unit (`cumU*`, `totalU`) and within the step's slot (`cumG*`, `totalG`;
 * a step without a slot is its own group, the whole unit). Built once per case; the arrays are never touched afterwards.
 */
export interface CaseSteps {
  readonly cs: CompiledScript
  readonly mode: StepMode
  readonly repeatN: number
  readonly flatCount: number
  /** Per flat step: the script step it plays and its repeat number (1-based; 1 when it does not repeat). */
  readonly stepOf: Int16Array
  readonly kOf: Int16Array
  readonly weight: Float64Array
  readonly cumU0: Float64Array
  readonly cumU1: Float64Array
  readonly cumG0: Float64Array
  readonly cumG1: Float64Array
  readonly totalG: Float64Array
  /** Per unit ordinal: the first flat step, the number of flat steps and the total weight. */
  readonly uFirst: Int16Array
  readonly uLen: Int16Array
  readonly totalU: Float64Array
  /** Per script step: the first flat step that plays it. */
  readonly flatOfStep: Int16Array
}

/** The middle of a step's real-minute band, in seconds. */
export const midSeconds = (s: ProcedureStep): number => ((s.realMinutes[0] + s.realMinutes[1]) / 2) * 60

/** A step's watch seconds at play `k` (1-based): a repeat step's later plays take its `repeatSeconds` when it has them (the first needle in full). */
export const watchSecondsOf = (s: ProcedureStep, k: number): number => (k > 1 && s.repeatSeconds !== undefined ? s.repeatSeconds : s.watchSeconds)

/**
 * Lay a case's steps out. `rng` (live mode) is a NEW fork the caller makes for this (`caseRng.fork('script')`): it is drawn once per flat
 * step, in order, for the jitter `1 + CONFIG.procedure.liveJitter * rng.range(-1, 1)`; null gives the plain middles. A watch case ignores
 * it. `repeatN` is how many times the run of repeat steps plays (the needles); it is 1 for a script without one.
 */
export function caseSteps(cs: CompiledScript, mode: StepMode, rng: Rng | null, repeatN = 1): CaseSteps {
  const steps = cs.script.steps
  const reps = cs.repeatLen > 0 ? Math.max(1, Math.floor(repeatN)) : 1
  const stepOf: number[] = []
  const kOf: number[] = []
  const flatOfStep = new Int16Array(cs.n)
  const push = (i: number, k: number) => {
    stepOf.push(i)
    kOf.push(k)
  }
  for (let i = 0; i < cs.n; i++) {
    if (cs.repeatLen > 0 && i === cs.repeatFrom) {
      for (let k = 1; k <= reps; k++) {
        for (let j = 0; j < cs.repeatLen; j++) {
          if (k === 1) flatOfStep[cs.repeatFrom + j] = stepOf.length
          push(cs.repeatFrom + j, k)
        }
      }
      i += cs.repeatLen - 1
    } else {
      flatOfStep[i] = stepOf.length
      push(i, 1)
    }
  }
  const m = stepOf.length
  const weight = new Float64Array(m)
  for (let f = 0; f < m; f++) {
    const s = steps[stepOf[f]]
    weight[f] = mode === 'watch' ? watchSecondsOf(s, kOf[f]) : midSeconds(s) * (rng === null ? 1 : 1 + CONFIG.procedure.liveJitter * rng.range(-1, 1))
  }

  const nu = cs.units.length
  const uFirst = new Int16Array(nu)
  const uLen = new Int16Array(nu)
  const totalU = new Float64Array(nu)
  const cumU0 = new Float64Array(m)
  const cumU1 = new Float64Array(m)
  const cumG0 = new Float64Array(m)
  const cumG1 = new Float64Array(m)
  const totalG = new Float64Array(m)
  for (let u = 0; u < nu; u++) uFirst[u] = -1
  let f = 0
  while (f < m) {
    const u = cs.unitOf[stepOf[f]]
    let end = f
    while (end < m && cs.unitOf[stepOf[end]] === u) end++
    uFirst[u] = f
    uLen[u] = end - f
    // the unit's running weights
    let cum = 0
    for (let g = f; g < end; g++) {
      cumU0[g] = cum
      cum += weight[g]
      cumU1[g] = cum
    }
    totalU[u] = cum
    // the running weights inside each slot group (consecutive steps with the same slot), or the whole unit for an unslotted step
    let g = f
    while (g < end) {
      const slot = cs.slotOf[stepOf[g]]
      let h = g
      let acc = 0
      while (h < end && cs.slotOf[stepOf[h]] === slot) {
        cumG0[h] = acc
        acc += weight[h]
        cumG1[h] = acc
        h++
      }
      for (let k = g; k < h; k++) totalG[k] = acc
      g = h
    }
    f = end
  }
  return { cs, mode, repeatN: reps, flatCount: m, stepOf: Int16Array.from(stepOf), kOf: Int16Array.from(kOf), weight, cumU0, cumU1, cumG0, cumG1, totalG, uFirst, uLen, totalU, flatOfStep }
}
