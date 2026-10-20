/**
 * R3 (endoscope): the words drawn INSIDE the da Vinci endoscope picture (src/scene/surgery/endo/hud.ts) and the map from an instrument's display name
 * (surgery.json `instruments` and `exchanges`) to how it is drawn (`look`, src/scene/surgery/endo/looks.ts) and the short label of its arm chip.
 * endoscopeUi.json is parsed with the zod schema below at module load, so bad content throws here with the field named. Everything is synthetic and
 * display-only, and the words stay non-graphic like the picture.
 */
import { z } from 'zod'
import endoscopeUiJson from './endoscopeUi.json'

const GRAPHIC_WORDS = /\b(blood|bleed\w*|gore|gory|wounds?|incisions?|guts|cut|cuts|cutting)\b/i

const line = z
  .string()
  .min(1)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')
  .refine((s) => !GRAPHIC_WORDS.test(s), 'copy must be non-graphic')

/** How an instrument is drawn. `endoscope` is the camera itself (arm 2): never drawn in its own picture. */
export const LOOK_IDS = [
  'endoscope',
  'fenestratedBipolar',
  'curvedScissors',
  'prograsp',
  'cadiere',
  'needleDriver',
  'clipApplier',
  'hook',
  'suction',
  'vesselSealer',
] as const
export type LookId = (typeof LOOK_IDS)[number]

/** An arm chip is narrow: its short label fits in this many characters. */
export const SHORT_MAX = 10

export const EndoscopeUiSchema = z.strictObject({
  hud: z.strictObject({ camera: line, cameraArm: line, exchanging: line, simulated: line }),
  instruments: z.record(line, z.strictObject({ look: z.enum(LOOK_IDS), short: line.refine((s) => s.length <= SHORT_MAX, `at most ${SHORT_MAX} characters`) })),
})

export type EndoscopeUiCopy = z.output<typeof EndoscopeUiSchema>
export const ENDOSCOPE_UI: EndoscopeUiCopy = EndoscopeUiSchema.parse(endoscopeUiJson)
