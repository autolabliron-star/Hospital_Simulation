/**
 * R3 "Real screens": the words on the scan screens themselves (the scanner's own text round the picture: the preset, the parameters, the
 * view's annotation, LIVE and FREEZE). imagingUi.json is parsed with this zod schema at module load, so bad content throws here with the
 * field named. Templates use {placeholders}, filled by `fillImaging`. Synthetic, plausible values only, and the disclaimer is on every
 * picture.
 */
import { z } from 'zod'
import json from './imagingUi.json'

const line = z
  .string()
  .min(1)
  .max(48)
  .refine((s) => !/[\r\n]/.test(s), 'one line only')

export const ImagingUiSchema = z.strictObject({
  institution: line,
  disclaimer: line,
  us: z.strictObject({
    preset: line,
    live: line,
    freeze: line,
    stored: line,
    freq: line,
    gain: line,
    dr: line,
    depth: line,
    fr: line,
    mi: line,
    tis: line,
    noContact: line,
    views: z.strictObject({ liver: line, gallbladder: line, kidneyR: line, kidneyL: line, spleen: line, bladder: line }),
  }),
  /** The image counter of a series. */
  image: line,
  /** Orientation letters at the picture's edges: right, left, anterior, posterior, head, feet. */
  orient: z.strictObject({ R: line, L: line, A: line, P: line, H: line, F: line }),
  ct: z.strictObject({
    scanner: line,
    exposure: line,
    thick: line,
    pos: line,
    wl: line,
    kernel: z.strictObject({ soft: line, sharp: line }),
    topogram: line,
  }),
  mri: z.strictObject({
    field: line,
    trte: line,
    ti: line,
    thick: line,
    pos: line,
    fov: line,
    localiser: line,
    coils: z.strictObject({ head: line, spine: line, knee: line, body: line }),
  }),
  xray: z.strictObject({
    detector: line,
    exposure: line,
    sid: line,
    ei: line,
    di: line,
    grid: line,
    noGrid: line,
  }),
})

export type ImagingUi = z.infer<typeof ImagingUiSchema>

export const IMAGING_UI: ImagingUi = ImagingUiSchema.parse(json)

/** Fill `{name}` placeholders. */
export function fillImaging(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`))
}
