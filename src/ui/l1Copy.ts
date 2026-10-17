/**
 * The words of the L1 HUD (Jump menu, Beds panel, ward room panel, KPI additions), in one place.
 *
 * The strings live in the `ui` section of `src/content/day.json`, validated by UiSchema in `src/content/schema.ts`. This file
 * re-exports them under the same names, so the HUD importers are unchanged. The moment labels, the captions and the event
 * sentences come from `src/content/day.ts`.
 */
import { DAY_UI } from '@/content/day'

export interface BedStateCopy {
  /** Full name, for the room panel and the legend. */
  label: string
  /** One short word for a tile on the command wall. */
  short: string
  /** One sentence for the room panel. */
  detail: string
}

export const L1_COPY = DAY_UI

/** Fill {placeholders}; an unknown placeholder is left as it is (and caught by the tests). */
export function fillCopy(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole))
}
