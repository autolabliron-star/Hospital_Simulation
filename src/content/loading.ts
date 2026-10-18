/**
 * The words of the loading screen (M5): the hospital's name, the calm progress line and the Enter button. loading.json is parsed with
 * LoadingSchema at module load, so bad content throws here with the field named. One line each, no placeholders, no countdowns.
 */
import { z } from 'zod'
import loadingJson from './loading.json'
import { parseOrThrow } from './schema'

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')

export const LoadingSchema = z
  .object({
    /** The hospital's name, the heading of the card. */
    title: line,
    /** One quiet line under the name. */
    tagline: line,
    /** Screen-reader name of the progress bar. */
    progressLabel: line,
    status: z
      .object({
        /** While the shaders and textures are being made ready. */
        preparing: line,
        /** The last stretch. */
        finishing: line,
        /** Everything is warm: the Enter button is there. */
        ready: line,
        /** Ready, but the warm-up failed or ran out of time: say so, kindly. */
        readyDegraded: line,
      })
      .strict(),
    enter: z
      .object({
        /** The button. */
        label: line,
        /** Under the button: the day does not start before it is pressed. */
        hint: line,
      })
      .strict(),
  })
  .strict()

export type LoadingCopy = z.output<typeof LoadingSchema>

export const LOADING: LoadingCopy = parseOrThrow(LoadingSchema, loadingJson, 'src/content/loading.json')
