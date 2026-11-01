/**
 * R5 "Watch step by step": the words of the watch button and picker in the room panels, the watch overlay (caption bar, step list, controls) and the
 * picture-in-picture labels (src/ui/watch, src/scene/watch). watch.json is parsed with this zod schema at module load, so bad content throws here with
 * the field named. Templates use {placeholders}, filled by `fillWatch`. The step captions and their "why" lines are the scripts' own
 * (src/content/procedures); this file only names each procedure for the picker.
 */
import { z } from 'zod'
import type { ProcedureId } from '@/sim/types'
import json from './watch.json'
import { parseOrThrow } from './parse'

const line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), 'one line only')

const short = line(60)
const long = line(160)

/** Every procedure id (a type-level list: a new id must be named here and in watch.json). */
const PROCEDURES: Record<ProcedureId, true> = {
  'or-cholecystectomy': true,
  'or-hysterectomy': true,
  'or-prostatectomy': true,
  'cryo-kidney': true,
  'cryo-lung': true,
  'cryo-liver': true,
  'us-breastCancer': true,
  'us-fibroadenoma': true,
}
export const WATCH_PROCEDURE_IDS = Object.keys(PROCEDURES) as ProcedureId[]

const procedure = z.strictObject({ title: line(40), detail: short })

export const WatchCopySchema = z.strictObject({
  panel: z.strictObject({
    button: short,
    buttonTitle: long,
    pick: short,
    minutes: short,
    itemLine: short,
    following: short,
    watchCurrent: short,
    watchCurrentNote: short,
    fromStart: short,
    fromStartNote: long,
    busy: short,
    noTeam: long,
    noScript: short,
    cancel: short,
  }),
  overlay: z.strictObject({
    region: short,
    simulated: short,
    step: short,
    stepRepeat: short,
    stepRow: short,
    waiting: short,
    startsIn: short,
    startingNow: short,
    ended: short,
    endedWhy: long,
    live: short,
    watchCase: short,
    skip: short,
    skipBusy: short,
    skipLabel: short,
    skipCaption: short,
    steps: short,
    stepsShow: short,
    stepsHide: short,
    pause: short,
    play: short,
    pauseTitle: short,
    speed: short,
    speedTitle: short,
    speedLabel: short,
    freeLook: short,
    freeLookTitle: long,
    dragHint: long,
    exit: short,
    exitTitle: short,
    exitKey: short,
  }),
  insets: z.strictObject({ endo: short, us: short, ctPlan: short, ctLive: short }),
  rooms: z.strictObject({ or: short, cryo: short, us: short }),
  procedures: z.strictObject(Object.fromEntries(WATCH_PROCEDURE_IDS.map((id) => [id, procedure])) as Record<ProcedureId, typeof procedure>),
})

export type WatchCopy = z.output<typeof WatchCopySchema>

export const WATCH: WatchCopy = parseOrThrow(WatchCopySchema, json, 'src/content/watch.json')

/** Fill `{name}` placeholders; an unknown one stays visible. */
export function fillWatch(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`))
}
