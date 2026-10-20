/**
 * S1 Skip (docs/S1-SHOWCASE.md): the contract between the skip targets (skipModel.ts, the HUD row and chip) and the flow
 * (jumpFlow.ts `skip`). Pure types, no sim import.
 */

/** What a skip button offers: a plain step or the next milestone of what you are looking at. */
export type SkipKind = 'step' | 'surgery' | 'scan'

export interface SkipTarget {
  kind: SkipKind
  /** Sim time to land at (seconds since 07:30), already clamped to the end of the day and set the milestone lead before it. */
  toT: number
  /** Button text, from src/content/skip.json: "+15 min", "Skip to undocking · 10:12". */
  label: string
  /** Short text for the time-lapse cover ("Undocking"); empty for a plain step. */
  caption: string
}

export interface SkipRequest {
  /** Where the clock is now and where it lands (sim seconds since 07:30). */
  fromT: number
  toT: number
  /** The clock hours of both (for the time-lapse clock and the sky). */
  fromHour: number
  toHour: number
  caption: string
  /** `live` runs the same hospital forward (≤ CONFIG.skip.liveMaxSeconds); `rebuild` is a forward Jump that lands at toT. */
  mode: 'live' | 'rebuild'
}
