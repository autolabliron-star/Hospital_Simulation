/**
 * The Beds panel of the command wall as data: 16 tiles (ward A on the top row, ward B below), one per room, coloured by bed
 * state, with the ER boarding timer on a reserved bed, and four figures: today's discharges (and how many before noon),
 * admissions, ER boarding, and the "predicted discharges today" line from the day plan. Pure (no canvas): commandWall.ts
 * paints it, and `bedsSignature` tells the driver when something a viewer can see has changed (so the canvas redraws only then).
 *
 * The figures come from `dayStats` (the event log and `sim.life`), the colours from `bedStyle`, the words from `l1Copy`.
 */
import { ROOMS } from '@/sim/places'
import { BED_STATES, type BedState, type LivingDayView, type RoomStatus } from '@/sim/types'
import { BED_COLOR, BED_INK, isInProgress } from '@/ui/bedStyle'
import { hourText, type DayStats } from '@/ui/dayStats'
import { fillCopy, L1_COPY } from '@/ui/l1Copy'

const COPY = L1_COPY.beds

export const TILE_COLUMNS = 8

export interface BedTile {
  roomId: string
  ward: 'A' | 'B'
  col: number
  row: number
  state: BedState
  fill: string
  ink: string
  /** The short state word ("Ready"). */
  word: string
  /** A second line: the ER boarding timer on a reserved bed, or "On the way". */
  note: string | null
  /** In progress (leaving, cleaning): drawn with stripes, because the wall redraws only on change and cannot pulse. */
  stripes: boolean
}

export interface BedsStat {
  label: string
  value: string
  detail: string | null
  /** A small outlined tag after the label ("simulated"). */
  tag: string | null
}

export interface BedsLegendItem {
  color: string
  label: string
}

export interface BedsPanelModel {
  tiles: BedTile[]
  stats: BedsStat[]
  legend: BedsLegendItem[]
}

function tileOf(room: RoomStatus | undefined, roomId: string, ward: 'A' | 'B', index: number, t: number): BedTile {
  const state: BedState = room?.bed ?? 'occupied'
  let note: string | null = null
  if (state === 'reserved') {
    note = room?.boarding ? fillCopy(COPY.boardingTile, { n: Math.max(0, Math.floor((t - room.boarding.since) / 60)) }) : COPY.onTheWay
  }
  return {
    roomId,
    ward,
    col: index % TILE_COLUMNS,
    row: ward === 'A' ? 0 : 1,
    state,
    fill: BED_COLOR[state],
    ink: BED_INK[state],
    word: L1_COPY.bedStates[state].short,
    note,
    stripes: isInProgress(state),
  }
}

export function bedsPanelModel(life: LivingDayView, t: number, stats: DayStats): BedsPanelModel {
  const tiles = ROOMS.map((r, i) => tileOf(life.rooms.get(r.id), r.id, r.ward, i, t))
  const boarding: BedsStat = {
    label: COPY.boarding,
    value: stats.boardingCount === 0 ? COPY.boardingNone : String(stats.boardingCount),
    detail: stats.boardingCount === 0 ? null : fillCopy(COPY.boardingLongest, { n: stats.boardingLongestMin }),
    tag: null,
  }
  const predictedDetail =
    fillCopy(COPY.predictedValue, { planned: stats.plannedDischarges, left: stats.plannedToCome }) +
    (stats.nextPlannedHour === null ? '' : `, ${fillCopy(COPY.predictedNext, { time: hourText(stats.nextPlannedHour) })}`)
  return {
    tiles,
    stats: [
      { label: COPY.dischargesToday, value: String(stats.dischargesToday), detail: fillCopy(COPY.beforeNoon, { n: stats.dischargesBeforeNoon }), tag: null },
      { label: COPY.admissionsToday, value: String(stats.admissionsToday), detail: null, tag: null },
      boarding,
      { label: COPY.predicted, value: '', detail: predictedDetail, tag: L1_COPY.simulated },
    ],
    legend: [
      { color: BED_COLOR.occupied, label: COPY.legend.occupied },
      { color: BED_COLOR.dischargeSigned, label: COPY.legend.going },
      { color: BED_COLOR.needsCleaning, label: COPY.legend.clean },
      { color: BED_COLOR.ready, label: COPY.legend.ready },
      { color: BED_COLOR.reserved, label: COPY.legend.reserved },
    ],
  }
}

const mix = (h: number, v: number): number => Math.imul(h ^ (v | 0), 16777619) | 0

/**
 * A number that changes whenever something the panel shows changes: any room's `version` or state, a boarding timer's minute,
 * and the figures. No allocation (called from the redraw check). The caller also compares the Simulation object itself, because
 * a new hospital restarts every room's version at 0.
 */
export function bedsSignature(life: LivingDayView, t: number, stats: DayStats): number {
  let h = 2166136261 | 0
  life.rooms.forEach((r) => {
    h = mix(h, r.version)
    h = mix(h, BED_STATES.indexOf(r.bed))
    h = mix(h, r.boarding ? Math.floor((t - r.boarding.since) / 60) + 1 : 0)
  })
  h = mix(h, stats.dischargesToday)
  h = mix(h, stats.dischargesBeforeNoon)
  h = mix(h, stats.admissionsToday)
  h = mix(h, stats.boardingCount)
  h = mix(h, stats.boardingLongestMin)
  h = mix(h, stats.plannedToCome)
  h = mix(h, stats.nextPlannedHour === null ? -1 : Math.round(stats.nextPlannedHour * 100))
  return h
}
