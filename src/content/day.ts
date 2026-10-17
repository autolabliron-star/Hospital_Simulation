/**
 * The day (L1): one label and caption per Jump moment (CONFIG.day.moments, in the same order), and one sentence
 * template per L1 event type. day.json is parsed with DaySchema at module load, and the moments are checked against
 * CONFIG.day.moments there. Templates use {placeholders}; fillDayTemplate fills them and throws on a missing value,
 * so a sim bug shows up in tests rather than as a stray "{room}" in the event line.
 */
import dayJson from './day.json'
import { type DayEventType, DaySchema, type DayMoment, DAY_EVENT_FIELDS, DAY_EVENT_TYPES, PLACEHOLDER, parseOrThrow } from './schema'

export { DAY_EVENT_FIELDS, DAY_EVENT_TYPES, type DayEventType, type DayMoment } from './schema'

const DAY = parseOrThrow(DaySchema, dayJson, 'src/content/day.json')

/** The Jump menu moments, in CONFIG.day.moments order. */
export const DAY_MOMENTS: readonly DayMoment[] = DAY.moments

/** The HUD words (the `ui` section of day.json), validated by UiSchema; src/ui/l1Copy.ts re-exports them. */
export const DAY_UI = DAY.ui

/** The sentence template for each L1 event type, with its {placeholders} still in. */
export const DAY_EVENT_TEMPLATES: Readonly<Record<DayEventType, string>> = Object.fromEntries(
  DAY_EVENT_TYPES.map((type) => [type, DAY.events[type]]),
) as Record<DayEventType, string>

/** Fill every {placeholder} of an event's template. Throws if a value for one of its fields is missing. */
export function fillDayTemplate(type: DayEventType, fields: Readonly<Record<string, string | number>>): string {
  return DAY_EVENT_TEMPLATES[type].replace(PLACEHOLDER, (_match, name: string) => {
    const allowed = DAY_EVENT_FIELDS[type] as readonly string[]
    if (!allowed.includes(name) || !Object.hasOwn(fields, name)) {
      throw new Error(`fillDayTemplate: the "${type}" event needs a value for {${name}}`)
    }
    return String(fields[name])
  })
}
