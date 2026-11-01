/**
 * R5 wave 3: the cryo suite's adapter to the step-by-step engine (src/sim/procedure). A case's target has a script (`cryo-<target>`,
 * src/content/procedures): kidney, lung, liver. A case gets a `CryoCaseScript` once, when it is made: its steps laid out (the real minutes of each
 * step jittered on a NEW fork `caseRng.fork('script')`, so no day plan moves; or, for a watch case, the script's watch seconds, the repeat run played
 * once per needle) and who wears what at each step. The suite fills `CryoSuiteState.procedure` from it every tick (index.ts), and the team stands and
 * works where its role lines say (team.ts).
 *
 * The unit windows come from the case: in the living day the plan's step lengths (plan.ts), in a watch case the script's own seconds
 * (`watchTimesFor`), so the steps of a watch case last exactly their watch seconds. Everything here is pure: the same plan gives the same script.
 */
import { CONFIG } from '../config'
import { ATTIRE, type CryoTarget, type ProcAction, type ProcAnchor, type ProcRole } from '../types'
import { caseSteps, compiledFor, watchSecondsOf, watchUnitSeconds, type CaseSteps, type CompiledScript } from '../procedure'
import type { Rng } from '../rng'
import type { Title } from '../surgery/actors'
import { targetOf, type PlannedCryoCase, type RoomStep, type WatchTimes } from './plan'
import { targetSettings } from './targets'

/** The cryo team's titles as the scripts' roles, in the order of `ROLES_BY_MACHINE.cryoCt` (and so of `ProcedureView.roles`). */
export const CRYO_ROLES: readonly ProcRole[] = ['ir', 'ctRadiographer', 'sedation', 'cryoAnaes']

/** The staff member who fills each role (CRYO_STAFF). */
export const ROLE_STAFF: Readonly<Record<'ir' | 'ctRadiographer' | 'sedation' | 'cryoAnaes', string>> = {
  ir: 'cryo-ir',
  ctRadiographer: 'cryo-rad',
  sedation: 'cryo-nurse',
  cryoAnaes: 'cryo-anaes',
}

/** A staff title's index in `CRYO_ROLES` (-1: not a scripted role: the ward porter). */
export function roleIndexOf(title: Title): number {
  switch (title) {
    case 'ir':
      return 0
    case 'ctRadiographer':
      return 1
    case 'sedation':
      return 2
    case 'cryoAnaes':
      return 3
    default:
      return -1
  }
}

/** The script of a cryo target, compiled, or undefined when it is not written. */
export function compiledForTarget(target: CryoTarget): CompiledScript | undefined {
  return compiledFor(`cryo-${target}`)
}

/**
 * What a watch case of `target` takes from its script: the seconds of every unit it has (the repeat run counted once per needle, `CONFIG.cryoSuite
 * .watchNeedles`), and one needle's run. Null when the target has no script.
 */
export function watchTimesFor(target: CryoTarget, needles: number = CONFIG.cryoSuite.watchNeedles[target]): WatchTimes | null {
  const cs = compiledForTarget(target)
  if (cs === undefined) return null
  const units: Partial<Record<RoomStep, number>> = {}
  for (const unit of cs.units) units[unit as RoomStep] = watchUnitSeconds(cs, unit, needles)
  let run = 0
  let again = 0
  for (const s of cs.script.steps) {
    if (s.repeat !== true) continue
    run += watchSecondsOf(s, 1)
    again += watchSecondsOf(s, 2)
  }
  return { needles, units, needleSeconds: run, repeatNeedleSeconds: again }
}

/** One scripted case's runtime data (made once per case). */
export interface CryoCaseScript {
  readonly steps: CaseSteps
  readonly target: CryoTarget
  /** `ATTIRE` bits per script step and role: `attire[step * CRYO_ROLES.length + r]`. */
  readonly attire: Uint8Array
  /** The last flat step whose event and checklist line have been said (-1: none yet). */
  saidFlat: number
}

const R = CRYO_ROLES.length
/** Anchors inside the control room (the CT console, the planning station, the glass). */
export const CONTROL_ANCHORS: ReadonlySet<ProcAnchor> = new Set<ProcAnchor>(['ctControlScan', 'ctControlPlan', 'ctControlStand'])
/** Actions done with sterile gloves (the needle work, the prep and the drapes, the dressings). */
const GLOVED: ReadonlySet<ProcAction> = new Set<ProcAction>(['skinPrep', 'drapePatient', 'removeDrapes', 'injectLocal', 'skinNick', 'insertNeedle', 'removeNeedle', 'injectSaline', 'applyDressing', 'pressSite'])
const SCAN_UNITS: ReadonlySet<string> = new Set(['planningCt', 'checkCt', 'finalCt'])
/** The three who wear a lead apron while the CT runs (the radiographer sits behind the glass). */
const LEAD: ReadonlySet<ProcRole> = new Set<ProcRole>(['ir', 'sedation', 'cryoAnaes'])

/**
 * The script step that is the transfer onto the CT table (the last step of the 'arrive' unit), or -1 when the script has no such unit. The case unloads
 * the patient from the porter's stretcher onto the table when this step is under the clock (case.ts), so its caption shows as it happens.
 */
export function transferStepOf(cs: CompiledScript): number {
  const u = cs.unitIndex.get('arrive')
  return u === undefined ? -1 : cs.unitFirst[u] + cs.unitLen[u] - 1
}

/** Is `role` one of the people on a case of `target`? The anaesthetist only for the cases that have one (lung and liver); the kidney's is on call. */
function onCase(role: ProcRole, target: CryoTarget): boolean {
  return role !== 'cryoAnaes' || targetSettings(target).anaesthetist
}

/**
 * Who wears what at each step (docs/research/procedures.md section 6; the sources do not list the cryo room's dress, so this is common practice): from
 * the skin prep on, the people on the case are masked. The radiologist is gloved for the sterile work: the prep and drapes, every needle step, the needles
 * out, the drapes off and the dressings; the nurse and the radiographer while their own line is such an action. The radiologist, the nurse and the
 * anaesthetist wear a lead apron from the planning scan to the final scan (the CT runs during the freezes too), except while seated at a console.
 * Dress goes with the work: a role with no line at a step wears nothing then unless it is on the case for the target (`onCase`: the three always, the
 * anaesthetist for the lung and the liver only), so the kidney's on-call anaesthetist is bare except in the scans he stands in the control room for.
 */
export function attireTable(steps: CaseSteps): Uint8Array {
  const cs = steps.cs
  const n = cs.n
  const target = cs.script.key as CryoTarget
  const out = new Uint8Array(n * R)
  let prep = n
  for (let i = 0; i < n && prep === n; i++) for (let r = 0; r < cs.roles.length; r++) if (cs.roleAt[i][r]?.action === 'skinPrep') prep = i
  let firstScan = n
  let lastScan = -1
  for (let i = 0; i < n; i++) {
    if (SCAN_UNITS.has(cs.script.steps[i].unit)) {
      if (firstScan === n) firstScan = i
      lastScan = i
    }
  }
  for (let r = 0; r < R; r++) {
    const rr = cs.roles.indexOf(CRYO_ROLES[r])
    for (let i = 0; i < n; i++) {
      const line = rr >= 0 ? cs.roleAt[i][rr] : null
      const working = line !== null || onCase(CRYO_ROLES[r], target)
      let bits = 0
      if (i >= prep && working) bits |= ATTIRE.mask
      const action = line !== null && !line.held ? line.action : null
      if (action !== null && GLOVED.has(action)) bits |= ATTIRE.gloves
      else if (CRYO_ROLES[r] === 'ir' && cs.script.steps[i].unit === 'aim') bits |= ATTIRE.gloves
      const seated = line !== null && (line.anchor === 'ctControlScan' || line.anchor === 'ctControlPlan')
      if (working && LEAD.has(CRYO_ROLES[r]) && i >= firstScan && i <= lastScan && !seated) bits |= ATTIRE.lead
      out[i * R + r] = bits
    }
  }
  return out
}

/**
 * The runtime script of a case, or null when its target has none (R4's behaviour). `caseRng` is the case's own stream: only its NEW fork `script`
 * is drawn from, and only in the living day (a watch case takes the watch seconds).
 */
export function caseScriptFor(plan: PlannedCryoCase, caseRng: Rng): CryoCaseScript | null {
  const target = targetOf(plan)
  const cs = compiledForTarget(target)
  if (cs === undefined) return null
  const steps = caseSteps(cs, plan.demo ? 'watch' : 'live', plan.demo ? null : caseRng.fork('script'), plan.needles.length)
  return { steps, target, attire: attireTable(steps), saidFlat: -1 }
}
