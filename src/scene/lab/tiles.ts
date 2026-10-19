/**
 * W4 lab: the four status screens of the lab as tiles of the shared status atlas (src/scene/w4kit): the totem (`labStatus`, readable from the
 * corridor through the glass front), the wall display over the centrifuges (`centrifuge`), the receive station's screen (`labReceive`) and the
 * cold archive's screen (`archive`). Each tile has a `version` (a number that changes whenever what the screen shows changes, computed here from the
 * displayed values) and a `paint`; the atlas rig repaints a tile only when its version moved, at most 2 Hz. The painters are pure canvas-2D calls
 * on a view of the lab state, so the node tests run them against a recording context. All words come from src/content/labUi.json.
 */
import { LAB_UI, fillLab } from '@/content/labUi'
import type { LabState } from '@/sim/types'
import { paintBackground, paintBar, paintChip, paintStat, paintText, paintTitle, SCREEN_INK, type ScreenTone } from '@/scene/w4kit/tilePaint'
import { registerTile, W4_TILE, type W4Tile } from '@/scene/w4kit/tiles'
import { SCREENS } from './labDims'

/** What the archive's screen calls its capacity (display only: the racks of the fridge). */
export const ARCHIVE_PLACES = 960

const mix = (h: number, v: number): number => Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619) >>> 0

/** A number that changes whenever any of `values` changes (a small FNV-style hash: a screen's version). */
export function versionOf(...values: number[]): number {
  let h = 2166136261
  for (const v of values) h = mix(h, v)
  return h
}

const PHASE_INDEX = { idle: 0, loading: 1, spinning: 2, unloading: 3 } as const

export function labStatusVersion(s: LabState): number {
  const k = s.kpis
  return versionOf(k.samplesToday, k.onTrack, k.medianTatMin ?? -1, s.reviewQueue, s.archived, s.pneumatic.inFlight ? 1 : 0, s.pneumatic.queued)
}
export function centrifugeVersion(s: LabState): number {
  const v: number[] = []
  for (const c of s.centrifuges) v.push(PHASE_INDEX[c.phase], c.load, Math.round(c.rpm01 * 10), Math.ceil(c.timeLeft), c.lid > 0.5 ? 1 : 0)
  return versionOf(...v)
}
export function receiveVersion(s: LabState): number {
  return versionOf(s.pneumatic.queued, s.pneumatic.inFlight ? 1 : 0, s.pneumatic.sentToday)
}
export function archiveVersion(s: LabState): number {
  return versionOf(s.archived)
}

const tatText = (m: number | null): string => (m === null ? '–' : fillLab(LAB_UI.units.minutes, { n: Math.round(m) }))

export function paintLabStatus(c: CanvasRenderingContext2D, w: number, h: number, s: LabState): void {
  const T = LAB_UI.tiles.labStatus
  paintBackground(c, w, h)
  paintTitle(c, w, T.title)
  if (s.pneumatic.inFlight) paintChip(c, w - 168, 8, T.flight, 'amber', 14)
  paintStat(c, 20, 80, String(s.kpis.samplesToday), T.samples)
  paintStat(c, 170, 80, String(s.kpis.onTrack), T.onTrack)
  paintStat(c, 20, 142, tatText(s.kpis.medianTatMin), T.tat)
  paintStat(c, 170, 142, String(s.reviewQueue), T.review)
  paintText(c, LAB_UI.simulated, 20, h - 12, 11, SCREEN_INK.dim, 500)
}

const PHASE_TONE: Record<LabState['centrifuges'][number]['phase'], ScreenTone> = { idle: 'teal', loading: 'amber', spinning: 'green', unloading: 'amber' }

export function paintCentrifuges(c: CanvasRenderingContext2D, w: number, h: number, s: LabState): void {
  const T = LAB_UI.tiles.centrifuge
  paintBackground(c, w, h)
  paintTitle(c, w, T.title)
  s.centrifuges.forEach((cf, i) => {
    const y = 62 + i * 66
    paintText(c, `C${i + 1}`, 20, y + 12, 24, SCREEN_INK.main, 700)
    paintChip(c, 62, y, T[cf.phase], PHASE_TONE[cf.phase], 15)
    const frac = cf.phase === 'spinning' ? cf.rpm01 : cf.capacity > 0 ? cf.load / cf.capacity : 0
    paintBar(c, 20, y + 36, w - 40, 10, frac, PHASE_TONE[cf.phase])
    const load = fillLab(T.load, { n: cf.load, max: cf.capacity })
    paintText(c, load, 20, y + 58, 14, SCREEN_INK.soft, 500)
    if (cf.phase === 'spinning' && cf.timeLeft > 0) {
      const t = Math.ceil(cf.timeLeft)
      paintText(c, fillLab(T.left, { mm: Math.floor(t / 60), ss: String(t % 60).padStart(2, '0') }), w - 20, y + 58, 14, SCREEN_INK.title, 600, 'right')
    } else if (cf.program) paintText(c, T.program[cf.program], w - 20, y + 58, 14, SCREEN_INK.title, 600, 'right')
  })
  paintText(c, LAB_UI.simulated, 20, h - 10, 11, SCREEN_INK.dim, 500)
}

export function paintReceive(c: CanvasRenderingContext2D, w: number, h: number, s: LabState): void {
  const T = LAB_UI.tiles.labReceive
  paintBackground(c, w, h, s.pneumatic.inFlight ? 'amber' : 'teal')
  paintTitle(c, w, T.title)
  paintText(c, String(s.pneumatic.queued), 20, 92, 56, SCREEN_INK.main, 650)
  paintText(c, s.pneumatic.queued > 0 ? fillLab(T.waiting, { n: s.pneumatic.queued }) : T.none, 20, 134, 18, SCREEN_INK.soft, 500)
  if (s.pneumatic.inFlight) paintChip(c, 20, 148, T.incoming, 'amber', 16)
  paintText(c, fillLab(T.sent, { n: s.pneumatic.sentToday }), w - 20, 160, 15, SCREEN_INK.title, 600, 'right')
  paintText(c, LAB_UI.simulated, 20, h - 10, 11, SCREEN_INK.dim, 500)
}

export function paintArchive(c: CanvasRenderingContext2D, w: number, h: number, s: LabState): void {
  const T = LAB_UI.tiles.archive
  paintBackground(c, w, h, 'blue')
  paintTitle(c, w, T.title, 'blue')
  paintChip(c, 20, 60, T.temp, 'blue', 16)
  paintText(c, fillLab(T.count, { n: s.archived }), 20, 118, 38, SCREEN_INK.main, 650)
  paintBar(c, 20, 146, w - 40, 10, s.archived / ARCHIVE_PLACES, 'blue')
  paintText(c, fillLab(T.racks, { n: s.archived, max: ARCHIVE_PLACES }), 20, 172, 14, SCREEN_INK.soft, 500)
  paintText(c, LAB_UI.simulated, 20, h - 8, 11, SCREEN_INK.dim, 500)
}

/** Register the lab's four tiles in the W4 atlas; returns the function that removes them. `lab` reads the live lab state (`sim.lab.state`: a Jump swaps it). */
export function registerLabTiles(lab: () => LabState): () => void {
  const defs: [number, W4Tile][] = [
    [W4_TILE.labStatus, { anchor: SCREENS.labStatus, version: () => labStatusVersion(lab()), paint: (c, w, h) => paintLabStatus(c, w, h, lab()) }],
    [W4_TILE.centrifuge, { anchor: SCREENS.centrifuge, version: () => centrifugeVersion(lab()), paint: (c, w, h) => paintCentrifuges(c, w, h, lab()) }],
    [W4_TILE.labReceive, { anchor: SCREENS.labReceive, version: () => receiveVersion(lab()), paint: (c, w, h) => paintReceive(c, w, h, lab()) }],
    [W4_TILE.archive, { anchor: SCREENS.archive, version: () => archiveVersion(lab()), paint: (c, w, h) => paintArchive(c, w, h, lab()) }],
  ]
  const offs = defs.map(([i, t]) => registerTile(i, t))
  return () => {
    for (const off of offs) off()
  }
}
