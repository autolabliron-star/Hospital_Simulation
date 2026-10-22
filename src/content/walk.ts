/**
 * The words of the walk-in HUD (W1): the "press E" prompts, the toasts, the lines of the "your order" objective, the drawer
 * card and the key hint. walk.json is parsed with WalkSchema at module load, so bad content throws here with the field named.
 * Templates use {placeholders}; `fillWalk` fills them. Which placeholders each line may use is `WALK_FIELDS`, and the tests
 * check every template against it (a stray "{room}" in the HUD would be a bug the player sees).
 */
import { z } from 'zod'
import walkJson from './walk.json'

const text = z.string().min(1)
const line = text.refine((s) => !/[\r\n]/.test(s), 'one line only')

export const WalkSchema = z
  .object({
    prompt: z
      .object({
        prescribe: line,
        bedEmpty: line,
        talk: line,
        console: line,
        drawer: line,
        sit: line,
        standUp: line,
        commandWall: line,
        kiosk: line,
        lift: line,
      })
      .strict(),
    toast: z.object({ kiosk: line, lift: line, busy: line, seatTaken: line }).strict(),
    device: z.object({ mri: line, ct: line, xray: line, us: line }).strict(),
    objective: z
      .object({
        prescribed: line,
        verifiedWaiting: line,
        verifiedPod: line,
        picking: line,
        enRoute: line,
        inDrawer: line,
        inDrawerNurse: line,
        given: line,
        cancelled: line,
      })
      .strict(),
    eta: z.object({ underMinute: line, minutes: line }).strict(),
    drawerCard: z.object({ title: line, loaded: line, empty: line, dueNow: line, locked: line, nothing: line, yours: line, close: line }).strict(),
    hud: z.object({ minimap: line, minimapAlt: line, clockLabel: line, paused: line, drawerCloseTitle: line }).strict(),
    hint: z
      .array(z.object({ action: z.enum(['walk', 'firstPerson', 'interact', 'shoulderSwap', 'present', 'presentNext']), label: line }).strict())
      .min(1)
      .max(6),
  })
  .strict()

export type WalkCopy = z.output<typeof WalkSchema>

/** The placeholders each template may use, by section and key. Sections not listed hold plain words. */
export const WALK_FIELDS = {
  prompt: {
    prescribe: ['patient'],
    bedEmpty: ['room'],
    talk: ['name'],
    console: ['device'],
    drawer: ['room'],
  },
  toast: { busy: ['name'] },
  objective: {
    prescribed: ['pharmacist', 'room'],
    verifiedWaiting: ['room'],
    verifiedPod: ['pod', 'room'],
    picking: ['pod'],
    enRoute: ['pod', 'room', 'eta'],
    inDrawer: ['room'],
    inDrawerNurse: ['room'],
    given: ['patient', 'room'],
    cancelled: ['room'],
  },
  eta: { minutes: ['n'] },
  drawerCard: { title: ['room'], locked: ['patient'] },
  hud: { clockLabel: ['time'] },
} as const satisfies Record<string, Record<string, readonly string[]>>

const parsed = WalkSchema.safeParse(walkJson)
if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
  throw new Error(`src/content/walk.json is invalid: ${details}`)
}

export const WALK: WalkCopy = parsed.data

export const WALK_PLACEHOLDER = /\{([A-Za-z]+)\}/g

/** Fill the {placeholders} of a template. A placeholder with no value is left as it is (the tests catch those). */
export function fillWalk(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(WALK_PLACEHOLDER, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole))
}

/** "E", "Tab", "Esc": what a key cap says for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]
  switch (code) {
    case 'Escape':
      return 'Esc'
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'Shift'
    case 'ArrowUp':
      return '↑'
    case 'ArrowDown':
      return '↓'
    case 'ArrowLeft':
      return '←'
    case 'ArrowRight':
      return '→'
    default:
      return code
  }
}
