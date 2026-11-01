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

/** A sentence on a card (still one line of text, but longer than a screen label). */
const sentence = z
  .string()
  .min(1)
  .max(160)
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
    views: z.strictObject({ liver: line, gallbladder: line, kidneyR: line, kidneyL: line, spleen: line, bladder: line, pancreas: line, breast: line }),
    /** The scan parameters of the linear (breast) probe, in place of the curved array's. */
    linearParams: line,
    /** The cryoablation readout on the live picture: the step, the probe temperature, the step timer, the ice ball and the probe label. */
    cryo: z.strictObject({
      place: line,
      freeze: line,
      thaw: line,
      temp: line,
      timer: line,
      ice: line,
      probe: line,
      /** R5 wave 3: the stages of the scripted ProSense case (the script's `scope` keys): survey, local, nick, saline, programme, measure, lump check, thaw to free, probe out, dressing, probe moved. The lump check says what the picture shows (R5 fix K4): the lump covered, or part of it outside the ice ball. */
      survey: line,
      /** The survey's stored picture while the skin is prepared, the field draped and the Time Out said (the script's `hold` scope: one still frame, not a live picture of a probe that is not on the skin). */
      held: line,
      lump: line,
      local: line,
      nick: line,
      saline: line,
      programme: line,
      programmeLine: line,
      measure: line,
      measureLine: line,
      lumpCovered: line,
      lumpOutside: line,
      thawFree: line,
      probeOut: line,
      treated: line,
      relocate: line,
      needle: line,
    }),
  }),
  /**
   * The device card the Scan viewer shows for a cryoablation (docs/research/cryoablation.md): the real product named on the card only. What the machine does and
   * what it is authorised for depend on the case (R5 fix K6): the breast cancer's card says the FDA authorisation of October 2025 and "tumour", the benign
   * fibroadenoma's says the company's statement of clearance for fibroadenomas and "lump" (docs/research/procedures.md section 10).
   */
  cryoCard: z.strictObject({
    label: line,
    title: line,
    synthetic: line,
    start: line,
    startNext: line,
    queued: line,
    breastCancer: z.strictObject({ what: sentence, status: sentence }),
    fibroadenoma: z.strictObject({ what: sentence, status: sentence }),
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

/** Which ProSense case a device card is for. */
export type CryoKind = 'breastCancer' | 'fibroadenoma'

/** Made once: a regex literal inside a function is a new RegExp every call. */
const FIBROADENOMA = /fibroadenoma/i

/** The card of a cryoablation exam, from its protocol name (the fibroadenoma's says "fibroadenoma"; everything else is the breast cancer's). */
export function cryoKindOf(protocol: string | null | undefined): CryoKind {
  return protocol !== null && protocol !== undefined && FIBROADENOMA.test(protocol) ? 'fibroadenoma' : 'breastCancer'
}

export const IMAGING_UI: ImagingUi = ImagingUiSchema.parse(json)

/** Fill `{name}` placeholders. */
export function fillImaging(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`))
}
