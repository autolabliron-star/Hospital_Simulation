/**
 * The pre-op bays panel's view model (R2): pure functions from the surgery state and the sim time to plain strings and booleans. The panel
 * (PreOpBody.tsx) polls it at 4 Hz; the node tests run it on hand-made state. All the words are from src/content/surgeryUi.json and surgery.json.
 * Whether the curtain is drawn has no word in the copy, so it is a flag the panel shows as a mark, not a sentence.
 */
import { SURGERY_COPY } from '@/content/surgery'
import { fillSurgery, SURGERY_UI } from '@/content/surgeryUi'
import { clockText } from '@/sim/events'
import type { SurgeryState } from '@/sim/types'
import { baysOf, caseOfBay, minutesSince, minutesText, NO_VALUE } from './orView'

export interface PreOpBayRow {
  /** 1-based bay number, and its label ("Bay 1"). */
  n: number
  label: string
  occupied: boolean
  /** The patient's name ("–" when the patient is not on the list), or null for a free bay. */
  patient: string | null
  /** The procedure's short name ("Gallbladder"), or null. */
  procedure: string | null
  /** Planned wheels-in as a 24-hour clock, or null. */
  time: string | null
  /** "12 min" since they came into the bay, or null for a free bay. */
  since: string | null
  /** The bay's curtain is drawn. */
  curtain: boolean
}

export interface PreOpView {
  tag: string
  title: string
  /** Set (the "nobody in the pre-op bays" line) when every bay is free. */
  empty: string | null
  bays: PreOpBayRow[]
}

/** The whole view. `t` is sim seconds (the panel passes `sim.t`). */
export function preOpView(state: SurgeryState, t: number): PreOpView {
  const bays = baysOf(state, 'preOp').map((bay, i): PreOpBayRow => {
    const n = i + 1
    const label = fillSurgery(SURGERY_UI.panel.preOp.bay, { n })
    if (bay.patientId === null) return { n, label, occupied: false, patient: null, procedure: null, time: null, since: null, curtain: bay.curtain }
    const c = caseOfBay(state.theatre.cases, bay)
    return {
      n,
      label,
      occupied: true,
      patient: c ? c.name : (bay.guestName ?? NO_VALUE),
      procedure: c ? SURGERY_COPY.procedures[c.procedure].short : null,
      time: c ? clockText(c.plannedIn) : null,
      since: minutesText(minutesSince(bay.since, t)),
      curtain: bay.curtain,
    }
  })
  return { tag: SURGERY_UI.panel.tag, title: SURGERY_UI.panel.preOp.title, empty: bays.some((b) => b.occupied) ? null : SURGERY_UI.panel.preOp.empty, bays }
}
