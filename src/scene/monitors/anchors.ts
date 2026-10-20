/**
 * R3 live patient monitors: the 19 monitors, where they are and whose patients they show.
 *
 *   or            the anaesthesia monitor on the machine's tower (surgery/dims.ts KIT_SCREENS.anaesthesia), the patient on the OR table
 *   pacu:0..2     a bedside monitor per recovery bay (seats surgeryBed:pacu:<i>), and pacu:station, the nurse island's central station (all three)
 *   preop:0..3    a bedside monitor per pre-op bay (surgeryBed:preop:<i>)
 *   er:0..5       a bedside monitor per ER bay (erBay:bay:<i>)
 *   triage:0..3   a spot-check monitor per triage bay (triageBay:bay:<i>)
 *
 * The bedside faces come from the building layout (`Frame.bedMonitor`: the bezel is drawn there, `getLayout().bedMonitors` says where the picture
 * goes); the OR's from the surgery screens' anchor. All anchors are in SIM coordinates; level 2's monitors are drawn in the level-2 group.
 */
import { fillMonitor, MONITORS } from '@/content/monitors'
import type { BedMonitorAnchor } from '@/scene/building/layout/types'
import type { ScreenAnchor } from '@/scene/surgery/dims'
import { levelOf, type LevelId } from '@/sim/levels'
import type { AreaId } from '@/sim/places'
import { LAYOUTS, STATION_ROWS, type FaceLayout } from './layouts'
import type { MonitorContext } from './vitals'

/** Where a face is: its centre (sim x, y above the level's floor, sim z), which way it faces, how far it leans back, its size. */
export interface FaceAnchor {
  x: number
  y: number
  z: number
  heading: number
  tilt: number
  w: number
  h: number
}

export interface MonitorDef {
  id: string
  /** Position in `monitorDefs()` (the hub's and the mesh's index). */
  index: number
  level: LevelId
  area: AreaId
  context: MonitorContext
  layout: FaceLayout
  /** The bed name in the header. */
  bed: string
  /** One seat per row of the layout: whose patient each row shows. */
  seats: readonly string[]
  anchor: FaceAnchor
}

/** The bedside anchors the layout must provide, by group, in order. */
export const BEDSIDE_GROUPS = [
  { prefix: 'triage', count: 4 },
  { prefix: 'er', count: 6 },
  { prefix: 'preop', count: 4 },
  { prefix: 'pacu', count: 3 },
] as const

export const MONITOR_COUNT = 1 + BEDSIDE_GROUPS.reduce((n, g) => n + g.count, 0) + 1

const OR_TABLE_SEAT = 'orTable:0'

function fromBedside(a: BedMonitorAnchor): FaceAnchor {
  return { x: a.x, y: a.y, z: a.z, heading: a.heading, tilt: a.tilt, w: a.w, h: a.h }
}

/**
 * The monitors, in a fixed order: the OR, PACU 1-3, the PACU station, pre-op 1-4, ER 1-6, triage 1-4. Throws when the layout lacks an anchor (the
 * layout and this list must agree).
 */
export function monitorDefs(bedMonitors: readonly BedMonitorAnchor[], or: ScreenAnchor): MonitorDef[] {
  const byId = new Map(bedMonitors.map((a) => [a.id, a]))
  const need = (id: string): BedMonitorAnchor => {
    const a = byId.get(id)
    if (!a) throw new Error(`monitors: the layout has no bed monitor "${id}"`)
    return a
  }
  const defs: Omit<MonitorDef, 'index'>[] = []
  defs.push({
    id: 'or',
    level: levelOf(or.at.x),
    area: 'l2Or',
    context: 'or',
    layout: LAYOUTS.or,
    bed: MONITORS.beds.or,
    seats: [OR_TABLE_SEAT],
    anchor: { x: or.at.x, y: or.at.y, z: or.at.z, heading: or.heading, tilt: or.tilt ?? 0, w: or.w, h: or.h },
  })
  const bedside = (prefix: 'pacu' | 'preop' | 'er' | 'triage', i: number): Omit<MonitorDef, 'index'> => {
    const a = need(`${prefix}:${i}`)
    const seat = prefix === 'pacu' ? `surgeryBed:pacu:${i}` : prefix === 'preop' ? `surgeryBed:preop:${i}` : prefix === 'er' ? `erBay:bay:${i}` : `triageBay:bay:${i}`
    return {
      id: a.id,
      level: levelOf(a.x),
      area: a.area,
      context: prefix,
      layout: prefix === 'triage' ? LAYOUTS.triage : prefix === 'preop' ? LAYOUTS.bedside2 : LAYOUTS.bedside3,
      bed: fillMonitor(MONITORS.beds[prefix], { n: i + 1 }),
      seats: [seat],
      anchor: fromBedside(a),
    }
  }
  for (let i = 0; i < 3; i++) defs.push(bedside('pacu', i))
  const st = need('pacu:station')
  defs.push({
    id: st.id,
    level: levelOf(st.x),
    area: st.area,
    context: 'pacu',
    layout: LAYOUTS.station,
    bed: MONITORS.beds.station,
    seats: Array.from({ length: STATION_ROWS }, (_, i) => `surgeryBed:pacu:${i}`),
    anchor: fromBedside(st),
  })
  for (let i = 0; i < 4; i++) defs.push(bedside('preop', i))
  for (let i = 0; i < 6; i++) defs.push(bedside('er', i))
  for (let i = 0; i < 4; i++) defs.push(bedside('triage', i))
  return defs.map((d, index) => ({ ...d, index }))
}

/** The face's frame: the top-left corner and the steps along one face pixel right and one face pixel down (world metres). */
export interface FaceFrame {
  ox: number
  oy: number
  oz: number
  rx: number
  ry: number
  rz: number
  dx: number
  dy: number
  dz: number
}

/**
 * The frame of a face of `pxW` x `pxH` pixels at `a`: the picture faces `heading` and leans back `tilt` (the layout's prims turn the same way: a lean
 * about the face's own horizontal axis, then the heading). Pixel (fx, fy) is at o + r fx + d fy.
 */
export function faceFrame(a: FaceAnchor, pxW: number, pxH: number): FaceFrame {
  const ch = Math.cos(a.heading)
  const sh = Math.sin(a.heading)
  const cl = Math.cos(a.tilt)
  const sl = Math.sin(a.tilt)
  // right: the face's +x; up: its +y leaned back about the right axis
  const rX = ch
  const rZ = -sh
  const uX = -sl * sh
  const uY = cl
  const uZ = -sl * ch
  const sx = a.w / pxW
  const sy = a.h / pxH
  return {
    ox: a.x - rX * (a.w / 2) + uX * (a.h / 2),
    oy: a.y + uY * (a.h / 2),
    oz: a.z - rZ * (a.w / 2) + uZ * (a.h / 2),
    rx: rX * sx,
    ry: 0,
    rz: rZ * sx,
    dx: -uX * sy,
    dy: -uY * sy,
    dz: -uZ * sy,
  }
}

/** The face's normal (the way it faces), for the tests. */
export function faceNormal(a: FaceAnchor): { x: number; y: number; z: number } {
  return { x: Math.sin(a.heading) * Math.cos(a.tilt), y: Math.sin(a.tilt), z: Math.cos(a.heading) * Math.cos(a.tilt) }
}
