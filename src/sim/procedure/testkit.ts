/** Test helpers for the procedure engine (not imported by the sim): a seeded set of unit windows and a small synthetic cryo script with a repeat run. */
import type { ProcedureScript } from '@/content/procedures'
import { CONFIG } from '../config'
import { Rng } from '../rng'
import { ROOM_PHASES } from '../surgery/plan'
import type { PatientPoseView } from '../types'

export interface Window {
  unit: string
  since: number
  until: number
}

/** Consecutive da Vinci unit windows from `t0`, durations drawn inside CONFIG.surgery.phaseMinutes (the console 15-30 minutes). */
export function davinciWindows(seed: number, t0 = 1000): Window[] {
  const rng = new Rng(seed)
  const out: Window[] = []
  let t = t0
  for (const unit of ROOM_PHASES) {
    const band = unit === 'console' ? CONFIG.surgery.consoleMinutes.cholecystectomy : CONFIG.surgery.phaseMinutes[unit]
    const d = rng.between(band) * 60
    out.push({ unit, since: t, until: t + d })
    t += d
  }
  return out
}

export const START: PatientPoseView = {
  position: 'prone',
  headTiltDeg: 0,
  rollDeg: 0,
  arms: 'aboveHead',
  airway: 'none',
  awareness: 'sedated',
  prep: 0,
  drape: 0,
  marks: 'none',
  catheter: false,
  manipulator: false,
}

const role = (at: 'tableSurgeon' | 'scrub') => ({ do: 'idle' as const, at })

/**
 * A minimal cryo script (not parsed: the engine does not validate): the units arrive, sedation, planning, aim (a run of two repeat steps and
 * one step after it), freeze1 and out. The `sedation` role has no line in `freeze1` and `out`; the `ir` role has lines everywhere but `arrive`.
 */
export function synthCryo(): ProcedureScript {
  const step = (id: string, unit: string, seconds: number, extra: object = {}) => ({
    id,
    unit,
    caption: `${id} {k} of {n}`,
    why: 'why',
    realMinutes: [seconds / 60, seconds / 60],
    watchSeconds: seconds,
    focus: 'room',
    roles: {},
    ...extra,
  })
  return {
    id: 'cryo-kidney',
    machine: 'cryoCt',
    key: 'kidney',
    name: 'Test',
    short: 'Test',
    refs: ['test'],
    anaesthesia: 'sedation',
    start: START,
    steps: [
      step('arrive', 'arrive', 30, { roles: { sedation: role('scrub'), ctRadiographer: role('scrub') } }),
      step('sedate', 'sedation', 20, { roles: { sedation: role('scrub'), ir: role('tableSurgeon') }, patient: { awareness: 'asleep', prep: 1 } }),
      step('plan', 'planning', 25, { roles: { ir: role('tableSurgeon') }, scope: 'plan', patient: { headTiltDeg: 10 } }),
      step('aimGuide', 'aim', 10, { repeat: true, roles: { ir: role('tableSurgeon') } }),
      step('needleIn', 'aim', 14, { repeat: true, roles: { ir: role('tableSurgeon'), sedation: role('scrub') } }),
      step('aimDone', 'aim', 12, { roles: { ir: role('tableSurgeon') } }),
      step('freeze', 'freeze1', 40, { roles: { ir: role('tableSurgeon') } }),
      step('out', 'out', 30, { roles: { ir: role('tableSurgeon') }, patient: { marks: 'dressed' } }),
    ],
  } as unknown as ProcedureScript
}
