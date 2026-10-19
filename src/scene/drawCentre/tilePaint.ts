/**
 * The painters of the draw centre's screens on the shared status atlas: the check-in kiosk (welcome and "take a number"), the queue screen above
 * the door (now calling P023 to Robot 2, the waiting tickets), the tube-prep machine's display and the manual send station's display. Each is a
 * pure painter of a small view built from the sim's draw state (no sim import here: tiles.ts registers them). The words come from
 * src/content/drawUi.json.
 */
import { DRAW_UI, fillDraw } from '@/content/drawUi'
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import type { DrawTicket, TubePrepState } from '@/sim/types'

const FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif'
const BG = '#0a1a1d'
const TEAL = '#35d4c6'
const INK = '#e6f2f2'
const MUTED = 'rgba(190,215,218,0.8)'

function text(c: Ctx2D, s: string, x: number, y: number, size: number, fill: string, align: CanvasTextAlign = 'left', bold = true): void {
  c.font = `${bold ? '600 ' : ''}${size}px ${FONT}`
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.fillStyle = fill
  c.fillText(s, x, y)
}

function page(c: Ctx2D, w: number, h: number): void {
  c.fillStyle = BG
  c.fillRect(0, 0, w, h)
  c.fillStyle = TEAL
  c.fillRect(0, 0, w, 6)
  text(c, DRAW_UI.strip.simulated, w - 10, h - 8, 10, 'rgba(150,175,178,0.75)', 'right', false)
}

// ---------------------------------------------------------------------------------------------
// Views (plain data the painters read)
// ---------------------------------------------------------------------------------------------

export interface QueueView {
  /** The ticket on the screen: its id and the robot (1-based), or null. */
  calling: { ticket: string; robot: number } | null
  /** The next few waiting tickets in call order, and how many wait in all. */
  next: string[]
  waiting: number
}

export function queueViewOf(calling: DrawTicket | null, queue: readonly DrawTicket[]): QueueView {
  const next: string[] = []
  let waiting = 0
  for (const t of queue) {
    if (t.state !== 'waiting') continue
    waiting++
    if (next.length < 4) next.push(t.id)
  }
  return { calling: calling ? { ticket: calling.id, robot: (calling.station ?? 0) + 1 } : null, next, waiting }
}

export interface PrepView {
  phase: TubePrepState['phase']
  ticket: string | null
  progress: number
  labels: number
  trays: number
}

export function prepViewOf(prep: TubePrepState): PrepView {
  return { phase: prep.phase, ticket: prep.ticket, progress: prep.progress, labels: prep.traysToday, trays: prep.rack.length }
}

// ---------------------------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------------------------

export function paintCheckIn(c: Ctx2D, w: number, h: number, waiting: number): void {
  page(c, w, h)
  text(c, DRAW_UI.tiles.welcome, w / 2, 62, 36, INK, 'center')
  text(c, DRAW_UI.tiles.takeNumber, w / 2, 108, 26, TEAL, 'center')
  // a ticket glyph
  c.fillStyle = INK
  c.fillRect(w / 2 - 34, 124, 68, 34)
  c.fillStyle = BG
  for (let k = 0; k < 4; k++) c.fillRect(w / 2 - 22 + k * 12, 132, 6, 18)
  text(c, fillDraw(DRAW_UI.tiles.waitingNow, { count: waiting }), w / 2, 186, 15, MUTED, 'center', false)
}

export function paintQueue(c: Ctx2D, w: number, h: number, v: QueueView): void {
  page(c, w, h)
  text(c, DRAW_UI.tiles.nowCalling, 16, 38, 18, MUTED, 'left', false)
  if (v.calling) text(c, fillDraw(DRAW_UI.tiles.callLine, { ticket: v.calling.ticket, robot: v.calling.robot }), w / 2, 96, 34, TEAL, 'center')
  else text(c, DRAW_UI.panel.noData, w / 2, 96, 34, MUTED, 'center')
  c.fillStyle = 'rgba(255,255,255,0.12)'
  c.fillRect(16, 118, w - 32, 2)
  text(c, DRAW_UI.tiles.waiting, 16, 148, 16, MUTED, 'left', false)
  if (v.next.length === 0) text(c, DRAW_UI.tiles.nobody, 16, 176, 20, INK, 'left', false)
  else text(c, v.next.join('   '), 16, 176, 24, INK, 'left')
  if (v.waiting > v.next.length) text(c, `+${v.waiting - v.next.length}`, w - 14, 176, 20, MUTED, 'right')
}

export function paintPrep(c: Ctx2D, w: number, h: number, v: PrepView): void {
  page(c, w, h)
  text(c, DRAW_UI.tiles.prepTitle, 16, 40, 24, INK)
  text(c, DRAW_UI.prepPhase[v.phase], 16, 80, 28, v.phase === 'idle' ? MUTED : TEAL)
  if (v.ticket) text(c, v.ticket, w - 16, 80, 28, INK, 'right')
  c.fillStyle = 'rgba(255,255,255,0.12)'
  c.fillRect(16, 100, w - 32, 10)
  c.fillStyle = TEAL
  c.fillRect(16, 100, (w - 32) * Math.max(0, Math.min(1, v.phase === 'idle' ? 0 : v.progress)), 10)
  text(c, fillDraw(DRAW_UI.tiles.labelsToday, { count: v.labels }), 16, 146, 18, INK, 'left', false)
  text(c, fillDraw(DRAW_UI.tiles.traysWaiting, { count: v.trays }), 16, 174, 18, MUTED, 'left', false)
}

export function paintManualSend(c: Ctx2D, w: number, h: number, handDraws: number): void {
  page(c, w, h)
  text(c, DRAW_UI.tiles.manualTitle, w / 2, 72, 34, INK, 'center')
  text(c, DRAW_UI.tiles.manualLine, w / 2, 112, 20, TEAL, 'center', false)
  text(c, fillDraw(DRAW_UI.tiles.manualCount, { count: handDraws }), w / 2, 158, 18, MUTED, 'center', false)
}
