/**
 * The tube-prep machine (Techno Medica BC-ROBO-like): one job per ticket, made when the patient checks in (an ER patient: when the doctor
 * orders). It picks the right tube for each test of the order from its cap-colour bins, prints and wraps the barcode labels, and puts the
 * labelled tray in the output rack: 10-12 s per patient (config.blood.prepSeconds). The nurse takes the tray from the rack to the robot.
 *
 * The scene reads `state` (phase, progress, the bin the gripper is at, the tube it holds, the rack) in place every frame.
 */
import { CONFIG } from '../config'
import { DRAW_CENTRE } from '../places'
import type { TubeKind, TubePrepState } from '../types'
import { callOrder, type DrawEntry } from './tickets'

/**
 * The machine's 8 cap-colour bins hold a tube kind each (DRAW_CENTRE.prep.bins; some kinds have two or three bins). `TubePrepState.bin` is an
 * index into that list, so the scene's gripper goes to a bin of the right colour. Which of a kind's bins is used rotates per patient and
 * per tube (deterministic: the ticket's issue order), so the gripper does not always go to the same one.
 */
export function binFor(kind: TubeKind, turn: number): number {
  const bins = DRAW_CENTRE.prep.bins
  let count = 0
  for (let i = 0; i < bins.length; i++) if (bins[i] === kind) count++
  if (count === 0) return -1
  let pick = ((turn % count) + count) % count
  for (let i = 0; i < bins.length; i++) {
    if (bins[i] !== kind) continue
    if (pick === 0) return i
    pick--
  }
  return -1
}

export function newPrepState(): TubePrepState {
  return { phase: 'idle', progress: 0, ticket: null, queue: 0, bin: -1, held: null, rack: [], traysToday: 0, version: 0 }
}

/** The shares of one job spent picking, labelling and handing out the tray. */
const PICK_END = 0.55
const LABEL_END = 0.9

export interface PrepHost {
  /** The labelled tray is in the rack (the samples are 'labelled'). */
  trayReady(entry: DrawEntry): void
}

export class PrepMachine {
  readonly state: TubePrepState = newPrepState()
  private readonly jobs: DrawEntry[] = []
  private current: DrawEntry | null = null
  private len = 1
  private t = 0

  constructor(
    private readonly rng: { between(span: readonly [number, number]): number },
    private readonly host: PrepHost,
  ) {}

  /** A job for this ticket (V jobs go ahead of P jobs, then first come); `front` puts it at the head (the presenter's demo patient). */
  add(entry: DrawEntry, front = false): void {
    let i = front ? 0 : this.jobs.length
    while (!front && i > 0 && callOrder(this.jobs[i - 1], entry) > 0) i--
    this.jobs.splice(i, 0, entry)
    this.state.queue = this.jobs.length + (this.current ? 1 : 0)
    this.state.version++
  }

  /** The nurse takes the tray out of the rack. False if it is not there. */
  takeTray(ticket: string): boolean {
    const i = this.state.rack.indexOf(ticket)
    if (i < 0) return false
    this.state.rack.splice(i, 1)
    this.state.version++
    return true
  }

  /** The ticket went away (a safety net): drop its job and its tray. */
  cancel(entry: DrawEntry): void {
    const j = this.jobs.indexOf(entry)
    if (j >= 0) this.jobs.splice(j, 1)
    if (this.current === entry) this.finishJob(false)
    this.takeTray(entry.ticket.id)
    this.state.queue = this.jobs.length + (this.current ? 1 : 0)
    this.state.version++
  }

  get busy(): boolean {
    return this.current !== null || this.jobs.length > 0
  }

  step(dt: number): void {
    const s = this.state
    if (this.current === null) {
      const next = this.jobs.shift()
      if (!next) return
      this.current = next
      this.len = this.rng.between(CONFIG.blood.prepSeconds)
      this.t = 0
      s.ticket = next.ticket.id
      s.phase = 'picking'
      s.progress = 0
      s.version++
    }
    const e = this.current
    this.t += dt
    const p = Math.min(1, this.t / this.len)
    s.progress = p
    if (p < PICK_END) {
      // one slice per tube: the gripper travels to the bin, then holds the tube
      const kinds = e.tubes as TubeKind[]
      const n = Math.max(1, kinds.length)
      const x = (p / PICK_END) * n
      const idx = Math.min(n - 1, Math.floor(x))
      const sub = x - idx
      const kind = kinds[idx]
      const bin = kind === undefined ? -1 : binFor(kind, e.seq + idx)
      const held = sub >= 0.5 ? (kind ?? null) : null
      if (s.bin !== bin || s.held !== held) {
        s.bin = bin
        s.held = held
        s.version++
      }
    } else if (p < LABEL_END) {
      if (s.phase !== 'labelling') {
        s.phase = 'labelling'
        s.bin = -1
        s.held = null
        s.version++
      }
    } else if (s.phase !== 'output') {
      s.phase = 'output'
      s.bin = -1
      s.held = null
      s.version++
    }
    if (p >= 1) this.finishJob(true)
  }

  private finishJob(ok: boolean): void {
    const e = this.current
    const s = this.state
    this.current = null
    s.phase = 'idle'
    s.progress = 0
    s.ticket = null
    s.bin = -1
    s.held = null
    s.queue = this.jobs.length
    if (e && ok) {
      s.rack.push(e.ticket.id)
      s.traysToday++
      this.host.trayReady(e)
    }
    s.version++
  }
}
