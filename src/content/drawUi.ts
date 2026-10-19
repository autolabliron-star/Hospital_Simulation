/**
 * W4: the words of the robot blood-draw centre: its room panel, the walk-in prompts and toast, the queue and kiosk screens, the robots' live strip
 * and the spoken call. drawUi.json is parsed with the zod schema below at module load, so bad content throws here with the field named.
 * Templates use {placeholders}; `fillDraw` fills them, `DRAW_FIELDS` says which placeholders each line may use (the tests check every template
 * against it). Every name and number on these screens is synthetic; the disclaimer is on the panel.
 */
import { z } from 'zod'
import type { DrawPhase } from '@/sim/types'
import drawJson from './drawUi.json'

const text = z.string().min(1)
const line = text.refine((s) => !/[\r\n]/.test(s), 'one line only')

/** Every draw phase has a line (a Record keyed by the type, so the compiler rejects a missing or extra phase). */
const PHASES: Record<DrawPhase, true> = {
  idle: true,
  calling: true,
  cardScan: true,
  armIn: true,
  cuff: true,
  sanitise: true,
  veinScan: true,
  needleIn: true,
  filling: true,
  needleOut: true,
  bandage: true,
  release: true,
  awaitPorter: true,
  armMoved: true,
  fallbackToNurse: true,
  reset: true,
}
const phaseLines = Object.fromEntries(Object.keys(PHASES).map((p) => [p, line])) as Record<DrawPhase, typeof line>

export const DrawUiSchema = z
  .object({
    disclaimer: line,
    panel: z
      .object({
        nowCalling: line,
        noCall: line,
        callLine: line,
        waiting: line,
        noWaiting: line,
        moreWaiting: line,
        robots: line,
        robot: line,
        free: line,
        noPatient: line,
        staff: line,
        staffNone: line,
        stats: line,
        draws: line,
        firstAttempt: line,
        manual: line,
        wait: line,
        waitUnit: line,
        noData: line,
        prep: line,
        labels: line,
        tray: line,
        callNext: line,
        callNextWaiting: line,
        noneFree: line,
        firstTick: line,
        secondTry: line,
        doneLabel: line,
      })
      .strict(),
    phase: z.object(phaseLines).strict(),
    prepPhase: z.object({ idle: line, picking: line, labelling: line, output: line }).strict(),
    toast: z.object({ ticket: line }).strict(),
    prompt: z.object({ robot: line, checkIn: line, send: line }).strict(),
    tiles: z
      .object({
        welcome: line,
        takeNumber: line,
        waitingNow: line,
        nowCalling: line,
        callLine: line,
        waiting: line,
        nobody: line,
        prepTitle: line,
        labelsToday: line,
        traysWaiting: line,
        manualTitle: line,
        manualLine: line,
        manualCount: line,
      })
      .strict(),
    strip: z.object({ ready: line, robot: line, nir: line, us: line, needle: line, tube: line, vein: line, scanning: line, simulated: line }).strict(),
    speech: z.object({ call: line }).strict(),
  })
  .strict()

export type DrawUi = z.output<typeof DrawUiSchema>

/** The placeholders each template may use, by section and key. Lines not listed hold plain words. */
export const DRAW_FIELDS = {
  panel: { callLine: ['ticket', 'robot'], moreWaiting: ['count'], robot: ['n'], staff: ['nurses', 'robots'], staffNone: ['robots'], tray: ['count'] },
  phase: { filling: ['tube', 'tubes'] },
  toast: { ticket: ['ticket'] },
  prompt: { robot: ['n'] },
  tiles: { waitingNow: ['count'], callLine: ['ticket', 'robot'], labelsToday: ['count'], traysWaiting: ['count'], manualCount: ['count'] },
  strip: { robot: ['n'], tube: ['n', 'total'] },
  speech: { call: ['ticket', 'robot'] },
} as const satisfies Record<string, Record<string, readonly string[]>>

const parsed = DrawUiSchema.safeParse(drawJson)
if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
  throw new Error(`src/content/drawUi.json is invalid: ${details}`)
}

export const DRAW_UI: DrawUi = parsed.data

export const DRAW_PLACEHOLDER = /\{([A-Za-z]+)\}/g

/** Fill the {placeholders} of a template. A placeholder with no value is left as it is (the tests catch those). */
export function fillDraw(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(DRAW_PLACEHOLDER, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole))
}

/** The words for a robot's phase ("Filling tube 2 of 4"). */
export function phaseText(phase: DrawPhase, tube = 0, tubes = 0): string {
  return fillDraw(DRAW_UI.phase[phase], { tube: tube + 1, tubes })
}
