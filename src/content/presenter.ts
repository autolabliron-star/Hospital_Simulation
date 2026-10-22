/**
 * The words of the presenter's overlay (the sound pill, the toast and the paused or fast-forward pill that stay on screen when the HUD is
 * hidden) and the prescribing tablet's display text. presenter.json is parsed with PresenterSchema at module load, so bad content throws
 * here with the field named. Templates use {placeholders}; `fillPresenter` fills them.
 */
import { z } from 'zod'
import presenterJson from './presenter.json'

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')

export const PresenterSchema = z
  .object({
    sound: z.object({ on: line, off: line, pillOn: line, pillOff: line, titleOn: line, titleOff: line }).strict(),
    present: z.object({ enter: line, exit: line }).strict(),
    time: z.object({ pausedShort: line, speedShort: line, pausedTitle: line, speedTitle: line }).strict(),
    pointer: z.object({ locked: line }).strict(),
    rx: z.object({ panelLabel: line, sent: line }).strict(),
  })
  .strict()

export type PresenterCopy = z.output<typeof PresenterSchema>

export const PRESENTER: PresenterCopy = PresenterSchema.parse(presenterJson)

/** Fill the {placeholders} of a template. */
export function fillPresenter(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole))
}
