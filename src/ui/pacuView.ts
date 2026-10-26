/**
 * The recovery (PACU) panel's view model (R2): pure functions from the surgery state and the sim time to plain strings. The panel (PacuBody.tsx)
 * polls it at 4 Hz; the node tests run it on hand-made state. All the words are from src/content/surgeryUi.json and surgery.json.
 */
import { SURGERY_COPY } from '@/content/surgery'
import { fillSurgery, SURGERY_UI } from '@/content/surgeryUi'
import type { SurgeryState } from '@/sim/types'
import { baysOf, caseOfBay, minutesSince, minutesText, NO_VALUE } from './orView'

export interface PacuBayRow {
  /** 1-based bay number, and its label ("Bay 1"). */
  n: number
  label: string
  occupied: boolean
  /** The patient's name ("–" when the patient is not on the list), or null for a free bay. */
  patient: string | null
  /** "12 min" since they came into the bay, or null for a free bay. */
  since: string | null
  /** "Day case: home today" or "To the surgical ward upstairs", or null for a free bay. */
  outcome: string | null
}

export interface PacuView {
  tag: string
  title: string
  /** Set (the "nobody in recovery" line) when every bay is free. */
  empty: string | null
  bays: PacuBayRow[]
}

/** The whole view. `t` is sim seconds (the panel passes `sim.t`). */
export function pacuView(state: SurgeryState, t: number): PacuView {
  const bays = baysOf(state, 'pacu').map((bay, i): PacuBayRow => {
    const n = i + 1
    const label = fillSurgery(SURGERY_UI.panel.pacu.bay, { n })
    if (bay.patientId === null) return { n, label, occupied: false, patient: null, since: null, outcome: null }
    const c = caseOfBay(state.theatre.cases, bay)
    return {
      n,
      label,
      occupied: true,
      patient: c ? c.name : (bay.guestName ?? NO_VALUE),
      since: minutesText(minutesSince(bay.since, t)),
      outcome: c ? SURGERY_COPY.outcomes[c.outcome] : null,
    }
  })
  return { tag: SURGERY_UI.panel.tag, title: SURGERY_UI.panel.pacu.title, empty: bays.some((b) => b.occupied) ? null : SURGERY_UI.panel.pacu.empty, bays }
}
