/**
 * R2 (agent O): the surgeryKit atlas, as a registry of tiles on the W4 status-screen machinery (src/scene/w4kit): a 4 x 4 atlas of 320 x 200 tiles on the shared
 * bedside material (the same shader program as the W4 atlas), repainted only when a tile's `version` moves, uploaded at most 2 Hz (statusRig.ts). Five tiles are
 * in use (dims.ts KIT_TILE): the surgeon console's and the teaching console's status panels, the circulator's desk, and the PACU's and pre-op's boards. The
 * painters are pure canvas-2D calls on a view of `SurgeryState`, so the node tests run them on a recording context.
 *
 * R3: the anaesthesia monitor is a live patient monitor now (src/scene/monitors: sweeping traces at `KIT_SCREENS.anaesthesia`); its tile index
 * (`KIT_TILE.anaesthesia`) stays reserved and is never registered, so the atlas rig keeps that quad hidden.
 *
 * Words come from src/content/surgeryUi.ts and surgery.ts.
 */
import { SURGERY_COPY } from '@/content/surgery'
import { fillSurgery, SURGERY_UI } from '@/content/surgeryUi'
import { paintBackground, paintBar, paintChip, paintText, paintTitle, SCREEN_FONT, SCREEN_INK, type ScreenTone } from '@/scene/w4kit/tilePaint'
import type { W4Tile } from '@/scene/w4kit/tiles'
import { CONFIG } from '@/sim/config'
import { hourAt } from '@/sim/population/schedule'
import type { SurgeryBayState, SurgeryCaseView, SurgeryState } from '@/sim/types'
import { KIT_SCREENS, KIT_TILE } from './dims'

/** What the tiles read: the live state (`sim.surgery.state`: a Jump swaps it) and the sim clock in seconds. */
export interface KitSource {
  state(): SurgeryState
  now(): number
}

// ---------------------------------------------------------------------------------------------
// The registry (the atlas rig reads it)
// ---------------------------------------------------------------------------------------------

const tiles = new Map<number, W4Tile>()

/** The surgeryKit's tiles, for `createStatusRig({ tiles: surgeryTiles })`. */
export function surgeryTiles(): ReadonlyMap<number, W4Tile> {
  return tiles
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** The case in the theatre now, if any. */
export function currentCase(s: SurgeryState): SurgeryCaseView | null {
  const id = s.theatre.caseId
  return id === null ? null : (s.theatre.cases.find((c) => c.id === id) ?? null)
}

/** `HH:MM` of a sim time. */
export function clockText(t: number): string {
  const h = hourAt(t)
  const hh = Math.floor(h) % 24
  const mm = Math.floor((h - Math.floor(h)) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** `M:SS` of a duration in seconds (never negative). */
export function stopwatch(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Minutes since `t0` as the panel's "{n} min". */
export function minutesText(now: number, t0: number): string {
  return fillSurgery(SURGERY_UI.panel.kpiValue.minutes, { n: Math.max(0, Math.round((now - t0) / 60)) })
}

/** The patient's name on a bay, or ''. */
export function bayPatient(s: SurgeryState, bay: SurgeryBayState): string {
  if (bay.patientId === null) return ''
  return s.theatre.cases.find((c) => c.patientId === bay.patientId)?.name ?? ''
}

/** `text` cut with an ellipsis so it fits `maxW` pixels at `px` (the canvas draws one line and never wraps). */
export function fitText(c: CanvasRenderingContext2D, text: string, px: number, maxW: number, weight = 500): string {
  c.font = `${weight} ${px}px ${SCREEN_FONT}`
  if (c.measureText(text).width <= maxW) return text
  let n = text.length
  while (n > 1 && c.measureText(`${text.slice(0, n)}…`).width > maxW) n--
  return `${text.slice(0, n).trimEnd()}…`
}

/** A line of copy as its sentences (the canvas draws one line and never wraps): "The robot is not docked yet. Next: Prostate at 09:30." -> two lines. */
export function sentences(text: string): string[] {
  return text.split(/(?<=\.)\s+/).filter((p) => p !== '')
}

const mix = (h: number, v: number): number => Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619) >>> 0

/** A number that changes whenever any of `values` changes (a small FNV-style hash: a tile's version). */
export function versionOf(...values: number[]): number {
  let h = 2166136261
  for (const v of values) h = mix(h, v)
  return h
}

const ROBOT_PHASE_INDEX: Record<SurgeryState['robot']['phase'], number> = {
  stowed: 0, draping: 1, draped: 2, deploying: 3, driving: 4, docking: 5, targeting: 6, docked: 7, undocking: 8, returning: 9, cleaning: 10,
}

/** The console's own clock: seconds since the console phase began, or null outside it. */
export function consoleSeconds(s: SurgeryState, now: number): number | null {
  const c = currentCase(s)
  if (!c || s.theatre.phase !== 'console' || c.consoleStart === null) return null
  return now - c.consoleStart
}

// ---------------------------------------------------------------------------------------------
// Console status panels
// ---------------------------------------------------------------------------------------------

export function consoleVersion(s: SurgeryState, now: number): number {
  const sec = consoleSeconds(s, now)
  return versionOf(s.theatre.version, s.robot.version, ROBOT_PHASE_INDEX[s.robot.phase], sec === null ? -1 : Math.floor(sec), s.theatre.teachingInUse ? 1 : 0)
}

/** A console's status panel: the procedure, the theatre phase, the robot's phase, the console clock and, once docked, the insufflation. `teach` shows the teaching console's title. */
export function paintConsole(c: CanvasRenderingContext2D, w: number, h: number, s: SurgeryState, now: number, teach: boolean): void {
  const k = currentCase(s)
  const live = s.robot.phase === 'docked'
  paintBackground(c, w, h, live ? 'green' : 'teal')
  paintTitle(c, w, teach ? SURGERY_UI.console.title : k ? SURGERY_COPY.procedures[k.procedure].short : SURGERY_UI.panel.room, live ? 'green' : 'teal')
  if (teach) paintText(c, fitText(c, SURGERY_UI.console.subtitle, 12, 150), w - 20, 76, 12, SCREEN_INK.soft, 500, 'right')
  const phase = s.theatre.phase
  paintChip(c, 20, 62, SURGERY_COPY.phases[phase], phase === 'console' ? 'green' : 'teal', 16)
  paintText(c, fitText(c, SURGERY_COPY.robotPhases[s.robot.phase], 18, w - 40, 600), 20, 114, 18, SCREEN_INK.main, 600)
  const sec = consoleSeconds(s, now)
  paintText(c, SURGERY_UI.console.clock, 20, 148, 13, SCREEN_INK.soft, 500)
  paintText(c, sec === null ? '–' : stopwatch(sec), 20, 176, 30, SCREEN_INK.main, 650)
  if (live) paintText(c, `${CONFIG.surgery.insufflationMmHg} ${SURGERY_UI.console.mmHg}`, w - 20, 176, 22, SCREEN_INK.title, 600, 'right')
  if (live) paintText(c, SURGERY_UI.console.insufflation, w - 20, 148, 13, SCREEN_INK.soft, 500, 'right')
}

// ---------------------------------------------------------------------------------------------
// The circulator's desk
// ---------------------------------------------------------------------------------------------

export function circulatorVersion(s: SurgeryState, now: number): number {
  return versionOf(s.theatre.version, s.robot.version, Math.floor(now / 60), s.theatre.cases.length)
}

/** The next case that has not begun, by planned wheels-in. */
export function nextCase(s: SurgeryState): SurgeryCaseView | null {
  let best: SurgeryCaseView | null = null
  for (const c of s.theatre.cases) {
    if (c.wheelsIn !== null || c.id === s.theatre.caseId) continue
    if (best === null || c.plannedIn < best.plannedIn) best = c
  }
  return best
}

export function paintCirculator(c: CanvasRenderingContext2D, w: number, h: number, s: SurgeryState, now: number): void {
  paintBackground(c, w, h, 'teal')
  paintTitle(c, w, SURGERY_UI.panel.room)
  const k = currentCase(s)
  if (k) {
    paintText(c, k.name, 20, 72, 22, SCREEN_INK.main, 650)
    paintText(c, fitText(c, SURGERY_COPY.procedures[k.procedure].name, 14, w - 40), 20, 98, 14, SCREEN_INK.title, 500)
    paintChip(c, 20, 114, SURGERY_COPY.phases[s.theatre.phase], 'teal', 15)
    paintText(c, fitText(c, SURGERY_COPY.robotPhases[s.robot.phase], 15, w - 40), 20, 168, 15, SCREEN_INK.soft, 500)
  } else {
    paintText(c, SURGERY_UI.panel.empty.room, 20, 80, 16, SCREEN_INK.soft, 500)
    const n = nextCase(s)
    const line = n ? fillSurgery(SURGERY_UI.console.standby, { procedure: SURGERY_COPY.procedures[n.procedure].short, time: clockText(n.plannedIn) }) : SURGERY_UI.console.standbyNone
    sentences(line).forEach((part, i) => paintText(c, fitText(c, part, 13, w - 40), 20, 120 + i * 20, 13, SCREEN_INK.title, 500))
  }
  paintText(c, `${SURGERY_UI.panel.list}  ${s.theatre.kpis.casesToday}`, w - 20, h - 12, 12, SCREEN_INK.dim, 600, 'right')
  void now
}

// ---------------------------------------------------------------------------------------------
// The PACU and pre-op boards
// ---------------------------------------------------------------------------------------------

export function boardVersion(s: SurgeryState, now: number): number {
  const v: number[] = [s.version, Math.floor(now / 60)]
  for (const b of s.bays) v.push(b.patientId === null ? 0 : 1, b.curtain ? 1 : 0)
  return versionOf(...v)
}

/** One board: its title, then a row per bay (bay number, the patient's name, minutes since they came in), or the empty line. */
function paintBoard(c: CanvasRenderingContext2D, w: number, h: number, s: SurgeryState, now: number, kind: SurgeryBayState['kind'], title: string, bayWord: string, emptyWord: string, tone: ScreenTone): void {
  paintBackground(c, w, h, tone)
  paintTitle(c, w, title, tone)
  const bays = s.bays.filter((b) => b.kind === kind)
  let any = false
  bays.forEach((b, i) => {
    const y = 74 + i * 34
    const who = bayPatient(s, b)
    if (who !== '') any = true
    paintText(c, fillSurgery(bayWord, { n: i + 1 }), 20, y, 16, SCREEN_INK.title, 650)
    paintText(c, fitText(c, who, 17, w - 190, 600), 110, y, 17, SCREEN_INK.main, 600)
    if (who !== '') paintText(c, minutesText(now, b.since), w - 20, y, 15, SCREEN_INK.soft, 500, 'right')
    paintBar(c, 20, y + 14, w - 40, 3, who !== '' ? 1 : 0, tone)
  })
  if (!any) paintText(c, emptyWord, 20, h - 14, 13, SCREEN_INK.dim, 500)
}

export function paintPacuBoard(c: CanvasRenderingContext2D, w: number, h: number, s: SurgeryState, now: number): void {
  paintBoard(c, w, h, s, now, 'pacu', SURGERY_UI.panel.pacu.title, SURGERY_UI.panel.pacu.bay, SURGERY_UI.panel.pacu.empty, 'green')
}

export function paintPreOpBoard(c: CanvasRenderingContext2D, w: number, h: number, s: SurgeryState, now: number): void {
  paintBoard(c, w, h, s, now, 'preOp', SURGERY_UI.panel.preOp.title, SURGERY_UI.panel.preOp.bay, SURGERY_UI.panel.preOp.empty, 'teal')
}

// ---------------------------------------------------------------------------------------------
// Registering
// ---------------------------------------------------------------------------------------------

/** Register the five tiles in the surgeryKit registry (not the anaesthesia monitor's: see the header); returns the function that removes them. */
export function registerSurgeryTiles(src: KitSource): () => void {
  const defs: [number, W4Tile][] = [
    [KIT_TILE.consoleSurgeon, { anchor: KIT_SCREENS.consoleSurgeon, version: () => consoleVersion(src.state(), src.now()), paint: (c, w, h) => paintConsole(c, w, h, src.state(), src.now(), false) }],
    [KIT_TILE.consoleTeach, { anchor: KIT_SCREENS.consoleTeach, version: () => consoleVersion(src.state(), src.now()), paint: (c, w, h) => paintConsole(c, w, h, src.state(), src.now(), true) }],
    [KIT_TILE.circulator, { anchor: KIT_SCREENS.circulator, version: () => circulatorVersion(src.state(), src.now()), paint: (c, w, h) => paintCirculator(c, w, h, src.state(), src.now()) }],
    [KIT_TILE.pacuBoard, { anchor: KIT_SCREENS.pacuBoard, version: () => boardVersion(src.state(), src.now()), paint: (c, w, h) => paintPacuBoard(c, w, h, src.state(), src.now()) }],
    [KIT_TILE.preOpBoard, { anchor: KIT_SCREENS.preOpBoard, version: () => boardVersion(src.state(), src.now()), paint: (c, w, h) => paintPreOpBoard(c, w, h, src.state(), src.now()) }],
  ]
  const offs = defs.map(([i, t]) => {
    tiles.set(i, t)
    return () => {
      if (tiles.get(i) === t) tiles.delete(i)
    }
  })
  return () => {
    for (const off of offs) off()
  }
}
