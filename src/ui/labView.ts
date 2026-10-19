/**
 * The lab panel's view model: pure functions from the sim's lab (state, samples, orders) to plain strings, numbers and SVG coordinates. The
 * panel (LabBody.tsx) polls it at 4 Hz, never per frame; the node tests run it on hand-made state. All the words are from src/content/labUi.json.
 * Everything shown is synthetic and display-only: the panel never decides anything, it reads.
 *
 * The track is drawn on a 360 x 360 board, 60 px a metre, from the lab's corner (x -31, z 16): the U centre line, a box for every module (its status
 * colour from the live state), and a dot for every tube on the belt or in a module, in its cap colour (a STAT one has a ring).
 */
import { LAB_CATALOGUE } from '@/content/lab'
import { durationText, fillLab, LAB_UI, type LabModuleId } from '@/content/labUi'
import { labTrackPointInto } from '@/sim/labTrack'
import { areaById, LAB } from '@/sim/places'
import type { LabOrder, LabState, Sample, SampleStage } from '@/sim/types'
import { CAMERA_ARCH, centrifuge, HOUSINGS, RECEIVE } from '@/scene/lab/labDims'
import { STOP_OF } from '@/scene/lab/samples'

/** Pixels a metre on the track board, and its size. */
export const BOARD = { scale: 60, w: 360, h: 360 } as const
const ORIGIN = { x: areaById('lab').rect.x0, z: areaById('lab').rect.z0 }
export const toBoardX = (x: number): number => Math.round((x - ORIGIN.x) * BOARD.scale * 10) / 10
export const toBoardY = (z: number): number => Math.round((z - ORIGIN.z) * BOARD.scale * 10) / 10

export type ModuleStatus = 'idle' | 'busy' | 'waiting'

export interface ModuleBox {
  id: LabModuleId
  /** Two or three letters for the board and the full name for the tooltip. */
  short: string
  name: string
  x: number
  y: number
  w: number
  h: number
  status: ModuleStatus
  /** "Spinning 80%", "2 waiting", "Idle". */
  note: string
}

export interface Puck {
  id: string
  x: number
  y: number
  /** Cap colour (hex) of the tube in the puck, and whether it is a STAT one. */
  color: string
  stat: boolean
}

export interface SampleRow {
  id: string
  /** The tube's cap colour. */
  cap: string
  /** The tests on this tube ("Full blood count", "Kidney and electrolytes, C-reactive protein"), and who and what tube. */
  title: string
  detail: string
  stage: string
  stageTone: 'flight' | 'wait' | 'busy' | 'done'
  /** "3 min", "just now", "in the tube". */
  since: string
  stat: boolean
}

export interface ResultRow {
  orderId: string
  name: string
  detail: string
}

export interface LabView {
  simulated: string
  kpis: { id: 'samplesToday' | 'onTrack' | 'turnaround' | 'sends'; label: string; value: string }[]
  track: {
    width: number
    height: number
    /** The U's centre line as an SVG path, and the receive station box. */
    path: string
    modules: ModuleBox[]
    pucks: Puck[]
    /** A tube is flying in the pipe right now (drawn as a marker over the receive station). */
    flying: boolean
    empty: boolean
  }
  samples: SampleRow[]
  /** Samples in the lab beyond the rows shown. */
  moreSamples: number
  results: ResultRow[]
}

/** What the view reads of the lab service (the sim's `Lab` satisfies it). */
export interface LabSource {
  state: LabState
  samples: { samples: ReadonlyMap<string, Sample>; get(id: string): Sample | undefined }
  orderById(id: string): LabOrder | undefined
}

export const MAX_SAMPLE_ROWS = 8
export const MAX_RESULT_ROWS = 3

const CAP_WHITE = '#f2f4f4'

// ---------------------------------------------------------------------------------------------
// The track board
// ---------------------------------------------------------------------------------------------

/** The U's centre line (the contract's polyline) with its two rounded corners, as an SVG path. */
export function trackPath(): string {
  const t = LAB.track
  const r = LAB.turnRadius
  const p = (x: number, z: number): string => `${toBoardX(x)} ${toBoardY(z)}`
  const rad = r * BOARD.scale
  return [
    `M ${p(t[0].x, t[0].z)}`,
    `L ${p(t[1].x, t[1].z)}`,
    `A ${rad} ${rad} 0 0 0 ${p(t[2].x, t[2].z)}`,
    `L ${p(t[3].x, t[3].z)}`,
    `A ${rad} ${rad} 0 0 0 ${p(t[4].x, t[4].z)}`,
    `L ${p(t[5].x, t[5].z)}`,
  ].join(' ')
}

const MODULE_ID: Record<string, LabModuleId> = {
  cfg0: 'cfg0',
  cfg1: 'cfg1',
  decap: 'decap',
  haem: 'haem',
  chem: 'chem',
  immuno: 'immuno',
  coag: 'coag',
  recap: 'recap',
  archive: 'archive',
}
const ANALYSER_OF: Record<string, keyof LabState['analysers']> = { haem: 'haematology', chem: 'chemistry', immuno: 'immunoassay', coag: 'coagulation' }

function box(id: LabModuleId, x0: number, x1: number, z0: number, z1: number, status: ModuleStatus, note: string): ModuleBox {
  return { id, short: LAB_UI.moduleShort[id], name: LAB_UI.module[id], x: toBoardX(x0), y: toBoardY(z0), w: Math.round((x1 - x0) * BOARD.scale * 10) / 10, h: Math.round((z1 - z0) * BOARD.scale * 10) / 10, status, note }
}

/** The boxes of the board with their live status. `busyAt` is the set of module ids a tube is in right now. */
export function moduleBoxes(state: LabState, busyAt: ReadonlySet<string>): ModuleBox[] {
  const out: ModuleBox[] = []
  const cam = CAMERA_ARCH
  out.push(box('receive', RECEIVE.x0, RECEIVE.x1, RECEIVE.z0, RECEIVE.z1, state.pneumatic.inFlight ? 'busy' : state.pneumatic.queued > 0 ? 'waiting' : 'idle', state.pneumatic.queued > 0 ? fillLab(LAB_UI.status.queue, { n: state.pneumatic.queued }) : LAB_UI.status.idle))
  out.push(box('camera', cam.xLeft, cam.xRight, cam.z0, cam.z1, busyAt.has('camera') ? 'busy' : 'idle', busyAt.has('camera') ? LAB_UI.status.busy : LAB_UI.status.idle))
  for (const h of HOUSINGS) {
    const id = MODULE_ID[h.id]
    if (!id) continue
    let status: ModuleStatus = 'idle'
    let note: string = LAB_UI.status.idle
    if (id === 'cfg0' || id === 'cfg1') {
      const c = state.centrifuges[id === 'cfg1' ? 1 : 0]
      if (c.phase === 'spinning') {
        status = 'busy'
        note = fillLab(LAB_UI.status.spinning, { pct: `${Math.round(c.rpm01 * 100)}%` })
      } else if (c.phase === 'loading') {
        status = 'waiting'
        note = LAB_UI.status.loading
      } else if (c.phase === 'unloading') {
        status = 'waiting'
        note = LAB_UI.status.unloading
      }
    } else if (id === 'haem' || id === 'chem' || id === 'immuno' || id === 'coag') {
      const a = state.analysers[ANALYSER_OF[id]]
      if (a.aspirating !== null || a.running > 0) {
        status = 'busy'
        note = LAB_UI.status.busy
      } else if (a.queue > 0) {
        status = 'waiting'
        note = fillLab(LAB_UI.status.queue, { n: a.queue })
      }
    } else if (id === 'archive') {
      note = fillLab(LAB_UI.tiles.archive.count, { n: state.archived })
    } else if (busyAt.has(id)) {
      status = 'busy'
      note = LAB_UI.status.busy
    }
    out.push(box(id, h.x0, h.x1, h.z0, h.z1, status, note))
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Samples and results
// ---------------------------------------------------------------------------------------------

/** The tests of a tube by name ("Full blood count", or the first two and "+1"). */
export function testsText(tests: readonly string[]): string {
  const names = tests.map((t) => LAB_CATALOGUE.tests[t]?.name ?? t)
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

const STAGE_TONE: Record<SampleStage, SampleRow['stageTone']> = {
  ordered: 'wait',
  labelled: 'wait',
  drawn: 'wait',
  inTube: 'flight',
  received: 'wait',
  onTrack: 'busy',
  centrifuge: 'busy',
  decap: 'busy',
  analysing: 'busy',
  recap: 'busy',
  archived: 'done',
}

/** A tube's cap as a hex colour: its kind's, or white once it has been recapped. */
export function capHex(s: Sample): string {
  return s.stage === 'recap' || s.stage === 'archived' ? CAP_WHITE : LAB_CATALOGUE.tubes[s.tube].hex
}

/** Is the sample in the lab's own rooms or the pipe (on screen as a row and a dot), as opposed to the draw centre or the archive? */
function inLab(s: Sample): boolean {
  return s.slot >= 0 && (s.where.line === 'pneumatic' || s.where.line === 'track' || s.where.line === 'module')
}

function sampleRow(s: Sample, lab: LabSource, t: number): SampleRow {
  const order = lab.orderById(s.orderId)
  const since = s.stageAt.received ?? s.stageAt.inTube
  return {
    id: s.id,
    cap: capHex(s),
    title: fillLab(LAB_UI.row.sample, { tests: testsText(s.tests) }),
    detail: fillLab(LAB_UI.row.sampleDetail, { patient: order?.patientName ?? s.patientId, tube: LAB_CATALOGUE.tubes[s.tube].label }),
    stage: LAB_UI.stage[s.stage],
    stageTone: STAGE_TONE[s.stage],
    since: s.stage === 'inTube' ? LAB_UI.units.inTube : since === undefined ? LAB_UI.units.none : durationText(t - since),
    stat: s.priority === 'stat',
  }
}

/** The last `MAX_RESULT_ROWS` orders whose every test is verified, newest first. */
export function resultRows(lab: LabSource): ResultRow[] {
  const seen = new Set<string>()
  const done: LabOrder[] = []
  for (const s of lab.samples.samples.values()) {
    if (s.stage !== 'archived' || seen.has(s.orderId)) continue
    seen.add(s.orderId)
    const o = lab.orderById(s.orderId)
    if (o && o.completeAt !== null) done.push(o)
  }
  done.sort((a, b) => (b.completeAt ?? 0) - (a.completeAt ?? 0) || (a.id < b.id ? 1 : -1))
  return done.slice(0, MAX_RESULT_ROWS).map((o) => ({
    orderId: o.id,
    name: fillLab(LAB_UI.row.result, { name: o.patientName }),
    detail: fillLab(LAB_UI.row.resultDetail, {
      panel: LAB_CATALOGUE.panels[o.panel]?.name ?? o.panel,
      tests: testsText(o.tests.filter((id) => LAB_CATALOGUE.tests[id])),
      minutes: durationText((o.completeAt ?? 0) - (o.drawnAt ?? o.orderedAt)),
    }),
  }))
}

/** The whole view. `t` is sim seconds (the panel passes `sim.t`). */
export function labView(lab: LabSource, t: number): LabView {
  const state = lab.state
  const k = state.kpis
  const rows: SampleRow[] = []
  const pucks: Puck[] = []
  const busyAt = new Set<string>()
  const flying = state.pneumatic.inFlight !== null
  let total = 0
  // oldest in the lab first: the ones that have waited longest lead the list
  const inside: Sample[] = []
  for (let i = 0; i < state.slots.length; i++) {
    const id = state.slots[i]
    const s = id ? lab.samples.get(id) : undefined
    if (s && inLab(s)) inside.push(s)
  }
  inside.sort((a, b) => (a.stageAt.inTube ?? 0) - (b.stageAt.inTube ?? 0) || (a.id < b.id ? -1 : 1))
  const p = { x: 0, z: 0 }
  for (const s of inside) {
    total++
    if (rows.length < MAX_SAMPLE_ROWS) rows.push(sampleRow(s, lab, t))
    if (s.where.line === 'pneumatic') continue
    if (s.where.line === 'track') labTrackPointInto(s.where.sDraw, p)
    else {
      const id = s.where.module
      if (id === null) continue
      busyAt.add(id)
      const stop = STOP_OF(id)
      if (id.startsWith('cfg')) {
        const c = centrifuge(id === 'cfg1' ? 1 : 0).rotor
        p.x = c.x
        p.z = c.z
      } else if (stop) {
        p.x = stop.x
        p.z = stop.z
      } else continue
    }
    pucks.push({ id: s.id, x: toBoardX(p.x), y: toBoardY(p.z), color: capHex(s), stat: s.priority === 'stat' })
  }
  return {
    simulated: LAB_UI.simulated,
    kpis: [
      { id: 'samplesToday', label: LAB_UI.kpi.samplesToday, value: String(k.samplesToday) },
      { id: 'onTrack', label: LAB_UI.kpi.onTrack, value: String(k.onTrack) },
      { id: 'turnaround', label: LAB_UI.kpi.turnaround, value: k.medianTatMin === null ? '–' : fillLab(LAB_UI.units.minutes, { n: Math.round(k.medianTatMin) }) },
      { id: 'sends', label: LAB_UI.kpi.sends, value: String(state.pneumatic.sentToday) },
    ],
    track: { width: BOARD.w, height: BOARD.h, path: trackPath(), modules: moduleBoxes(state, busyAt), pucks, flying, empty: pucks.length === 0 && !flying },
    samples: rows,
    moreSamples: total - rows.length,
    results: resultRows(lab),
  }
}
