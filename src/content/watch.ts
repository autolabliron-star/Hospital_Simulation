/**
 * R5 "Watch step by step": the words of the watch button and picker in the room panels, the watch overlay (caption bar, step list, controls) and the
 * picture-in-picture labels (src/ui/watch, src/scene/watch). The theatre's words are `panel` and `overlay`; the CT suite's and the ultrasound room's differ in the few lines that name the room
 * (`panelRooms`, `overlayRooms`). watch.json is parsed with this zod schema at module load, so bad content throws here with
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

/** The room panel's lines that change with the room (the theatre's are `panel`'s own): the CT suite's and the ultrasound room's. `{from}` and `{to}` are the team's hours. */
const roomPanel = z.strictObject({ buttonTitle: long, pick: short, following: short, fromStartNote: long, busy: short, noTeam: long })

/** The overlay's lines that change with the room (the theatre's are `overlay`'s own). */
const roomOverlay = z.strictObject({ waiting: short, startsIn: short, startingNow: short, ended: short, endedWhy: long, skipCaption: short })

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
  panelRooms: z.strictObject({ cryo: roomPanel, us: roomPanel }),
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
  overlayRooms: z.strictObject({ cryo: roomOverlay, us: roomOverlay }),
  insets: z.strictObject({ endo: short, us: short, ctPlan: short, ctLive: short }),
  rooms: z.strictObject({ or: short, cryo: short, us: short }),
  procedures: z.strictObject(Object.fromEntries(WATCH_PROCEDURE_IDS.map((id) => [id, procedure])) as Record<ProcedureId, typeof procedure>),
})

export type WatchCopy = z.output<typeof WatchCopySchema>

export const WATCH: WatchCopy = parseOrThrow(WatchCopySchema, json, 'src/content/watch.json')

/** The rooms of the watch: the theatre has its own words (`panel`, `overlay`); the CT suite and the ultrasound room override the lines that name the room. */
export type WatchRoomKey = 'or' | 'cryo' | 'us'

/** The room panel's words for a room: the theatre's, or the shared ones with the room's own lines over them. */
export function panelWords(room: WatchRoomKey): WatchCopy['panel'] {
  return room === 'or' ? WATCH.panel : { ...WATCH.panel, ...WATCH.panelRooms[room] }
}

/** The overlay's words for a room: the theatre's, or the shared ones with the room's own lines over them. */
export function overlayWords(room: WatchRoomKey): WatchCopy['overlay'] {
  return room === 'or' ? WATCH.overlay : { ...WATCH.overlay, ...WATCH.overlayRooms[room] }
}

/** Fill `{name}` placeholders; an unknown one stays visible. */
export function fillWatch(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in values ? String(values[k]) : `{${k}}`))
}
