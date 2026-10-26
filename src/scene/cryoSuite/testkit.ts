/**
 * R4: hand-made cryo suite states for the scene's node tests (the rig, the painters, the screens, the panel's view), built on the sim's
 * `emptyCryoState()`. The needle paths are plausible plans of the brief's kind: a posterolateral fan from the left flank into a left-kidney tumour,
 * their ice covering the tumour with a margin. Not the sim's plan (src/sim/cryoSuite/plan.ts): the scene must draw whatever the plan says.
 */
import { emptyCryoState } from '@/sim/cryoSuite'
import { timeAtHour } from '@/sim/population/schedule'
import type { CryoCaseView, CryoNeedleState, CryoRobotPhase, CryoStep, CryoSuiteState } from '@/sim/types'

/** `n` needle paths (2..6) for a tumour of `tumourMm`, fanned in the slice and a little along the body. */
export function fixtureNeedles(n: number, tumourMm = 26): CryoNeedleState[] {
  const r = tumourMm / 2
  const out: CryoNeedleState[] = []
  for (let k = 0; k < n; k++) {
    const f = n === 1 ? 0 : k / (n - 1) - 0.5 // -0.5 .. 0.5
    out.push({
      index: k,
      entry: { x: 82 + 10 * Math.abs(f), y: -12 + 56 * f },
      tip: { x: r * 0.15 * f - 2, y: r * 0.9 * f },
      dz: 7 * f * (k % 2 === 0 ? 1 : -1),
      inserted: 0,
      errorMm: 0,
      active: false,
      tempC: 37,
    })
  }
  return out
}

/** A case row for the list. */
export function fixtureCase(over: Partial<CryoCaseView> = {}): CryoCaseView {
  return { id: 'cryo-1', patientId: 'p-cryo-1', name: 'Mara Lindqvist', demo: false, plannedIn: timeAtHour(10.1), step: 'scheduled', wheelsIn: null, wheelsOut: null, needles: 3, tumourMm: 26, ...over }
}

export interface CryoFixture {
  step?: CryoStep
  needles?: number
  tumourMm?: number
  robot?: CryoRobotPhase
  robotNeedle?: number
  robotSince?: number
  tablePos?: number
  scan?: number
  ice?: number
  inserted?: number[]
  timer?: number
  argon?: boolean
  heater?: boolean
  version?: number
  imageSeed?: number
}

/** A suite state in the middle of a case (defaults: three needles, the first freeze running). */
export function cryoState(o: CryoFixture = {}): CryoSuiteState {
  const s = emptyCryoState()
  const n = o.needles ?? 3
  s.caseId = 'cryo-1'
  s.patientId = 'p-cryo-1'
  s.imageSeed = o.imageSeed ?? 4242
  s.step = o.step ?? 'freeze1'
  s.stepSince = 0
  s.stepEnds = 600
  s.tumourMm = o.tumourMm ?? 26
  s.needles = fixtureNeedles(n, s.tumourMm)
  const freezing = s.step === 'freeze1' || s.step === 'freeze2'
  for (const nd of s.needles) {
    nd.inserted = o.inserted ? (o.inserted[nd.index] ?? 0) : freezing || s.step === 'thaw' || s.step === 'checkCt' || s.step === 'activeThaw' ? 1 : 0
    nd.errorMm = 0.8 + 0.3 * nd.index
    nd.active = freezing
    nd.tempC = freezing ? -138 + nd.index * 4 : 37
  }
  s.needle = s.step === 'aim' || s.step === 'needlesOut' ? (o.robotNeedle ?? 0) : -1
  s.tablePos = o.tablePos ?? 0
  s.rotor = s.tablePos > 0 ? 1 : 0
  s.lasers = s.tablePos > 0
  s.scan = o.scan ?? 0
  s.robot = { phase: o.robot ?? 'stowed', needle: o.robotNeedle ?? -1, since: o.robotSince ?? 0, motionSeed: 7 }
  s.ice = o.ice ?? (freezing ? 0.5 : 0)
  s.iceMm = { short: Math.round(40 * s.ice), long: Math.round(52 * s.ice) }
  s.marginC = freezing ? 37 - 60 * s.ice : 37
  s.argon = o.argon ?? freezing
  s.heater = o.heater ?? false
  s.timer = o.timer ?? 125
  s.cases = [fixtureCase({ step: s.step }), fixtureCase({ id: 'cryo-2', patientId: null, name: 'Tomas Ekwueme', plannedIn: timeAtHour(14.3) })]
  s.version = o.version ?? 1
  return s
}
