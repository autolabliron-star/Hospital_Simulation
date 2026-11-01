/**
 * R5 wave 3: is the anaesthesia machine in the CT suite working a patient now? Plain and allocation-free: the machine's monitor (anaesMonitor.ts, a tile of
 * the cryo screens) and the ventilator's sound (src/audio/devices/cryoSuitePatterns.ts) both ask.
 *
 * It is in use for a lung or a liver case (the anaesthetist's cases: general anaesthetic and deep sedation) from the step the monitors go on until the
 * patient leaves the table: `procedure.patient.airway` is 'none' before that, and the room steps 'out' and 'turnover' come after it. The kidney is
 * sedated by the nurse with no machine in use: its monitor shows the standby screen, like the machine between cases.
 */
import { CRYO_STEPS, type CryoSuiteState } from '@/sim/types'

const FIRST = CRYO_STEPS.indexOf('sedation')
const LAST = CRYO_STEPS.indexOf('dressing')

export function anaesInUse(s: CryoSuiteState): boolean {
  if (s.target === 'kidney') return false
  if (s.procedure.procedureId === null || s.procedure.patient.airway === 'none') return false
  const i = CRYO_STEPS.indexOf(s.step)
  return i >= FIRST && i <= LAST
}

/** How the patient breathes: the machine ventilates (a tube, or a mask while asleep) or the patient breathes unaided (the cannula). */
export function ventilated(s: CryoSuiteState): boolean {
  const p = s.procedure.patient
  return p.airway === 'tube' || (p.airway === 'oxygenMask' && p.awareness === 'asleep')
}
