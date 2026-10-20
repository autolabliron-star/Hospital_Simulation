/**
 * R3 live patient monitors: the hub. It holds every monitor's state and runs the PUMP: a `setInterval` every 500 ms (never a frame callback) that
 * reads who is on each monitor, moves each patient's numbers on, extends their beats and breaths ahead of the sweep, and paints what is due into a
 * staging sheet within a 1.5 ms budget, then copies each painted rectangle into the atlas (`Uploader`: `copyTextureToTexture` in the browser, a
 * recorder in the tests). Nothing is uploaded per frame: the frame callback (mesh.ts) only moves quads over what the pump painted.
 *
 *   hot monitors   (within 9 m of you on your level, or in the room the presenter has focused) get their next sweep slots painted progressively,
 *                  chunk by chunk, where the screen does not show them (sweep.ts), and their numbers repainted every second
 *   cold monitors  keep cycling the two sweeps they have (the traces repeat) and repaint their numbers every 5 seconds
 *   a new patient  their row is filled first (every static, the band labels, both sweep slots); until then the row shows the standby face
 *
 * A patient on two monitors (a PACU bay and the central station) has ONE model: the same beats, the same numbers. A Jump (new sim generation) resets
 * everything. Painting runs only here, never in a frame callback.
 */
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { levelOf } from '@/sim/levels'
import type { AreaId } from '@/sim/places'
import { hashString } from '@/sim/rng'
import type { MonitorDef } from './anchors'
import { planAtlas, type AtlasPlan, type MonitorRegions } from './atlas'
import { displayedHr, displayedRr, extendBeats, extendBreaths, hashUnit, startBeats, startBreaths, TimeRing, type BreathDrive, type HeartDrive } from './beats'
import { DisplayClock } from './clock'
import { GAP, LAYOUT_IDS, LAYOUTS, SWEEP, waveOf, type FaceLayout, type FaceLayoutId, type WaveKind } from './layouts'
import { occupantOf, newOccupant, type Occupant, type OccupancySource } from './occupancy'
import { newRowNumbers, paintIdleFace, paintStatic, stationBeds, type FaceData, type RowNumbers } from './paintFace'
import { paintLabelSlot, paintSlotChunk, type WaveSource } from './paintSlot'
import { columnTime, entryOf, sweepAt, type SweepAt } from './sweep'
import { newNibp, newSituation, newVitals, nibpAt, nibpInterval, vitalsAt, type Baseline, type NibpReading, type Situation, type VitalsNow } from './vitals'
import { lookFor, type WaveLook } from './waves'

/** The pump's period and its paint budget per run. */
export const PUMP_MS = 500
export const PAINT_BUDGET_MS = 1.5
/** Seconds between repaints of the numbers: somebody looking, nobody looking. */
export const HOT_NUMBERS = 1
export const COLD_NUMBERS = 5
/** You make the monitors within this many metres of you hot (on your level). */
export const HOT_RADIUS = 9
/** The staging sheet the pump paints into before copying to the atlas. */
export const SHEET_W = 1024
export const SHEET_H = 512
/** How far back a new patient's beats start (the fill paints the sweep before this one), and how far ahead of now beats and breaths are kept. */
const BACKFILL = 2 * SWEEP.slow + 2
const AHEAD_BEATS = SWEEP.fast + 2
const AHEAD_BREATHS = SWEEP.slow + 2

/** Copies a painted rectangle of the staging sheet into the atlas. `mips` regenerates the atlas's mip levels after it (the last copy of a run). */
export interface Uploader {
  copy(sx: number, sy: number, w: number, h: number, dx: number, dy: number, mips: boolean): void
}

/** What the hub reads of the world. */
export interface HubEnv {
  occupancy: OccupancySource
  /** A patient's body: the health kiosks' profile when they have one, else a seeded one. */
  baseline(id: string, name: string, reason: string): Baseline
  simT(): number
  /** Bumped by a Jump: everything resets. */
  generation(): number
  /** Where you stand while walking (sim coordinates), else null. */
  walker(): { x: number; z: number } | null
  /** The room the presenter has focused, if any. */
  focus(): AreaId | null
  /** A millisecond clock for the budget. */
  nowMs(): number
}

/** One patient's monitor model (shared by every monitor row that shows them). */
export interface PatientModel {
  id: string
  seed: number
  base: Baseline
  sit: Situation
  vit: VitalsNow
  heart: HeartDrive
  breath: BreathDrive
  beats: TimeRing
  breaths: TimeRing
  look: WaveLook
  nibp: NibpReading
  /** What the painters read (the same rings and targets). */
  src: WaveSource
  /** Rows showing this patient. */
  refs: number
}

export interface BandState {
  /** Which sweep each of the two slots holds (NaN: nothing of this patient yet), and how many of its columns are painted. */
  sweep: [number, number]
  upTo: [number, number]
  /** The wave this band shows for its row's patient. */
  wave: WaveKind
}

export interface RowState {
  occ: Occupant
  /** The patient's id, '' when nobody is on the row. */
  key: string
  model: PatientModel | null
  /** Painted and showing; else the row shows the standby face. */
  live: boolean
  /** Sim time the hub first saw this patient on the row. */
  attachedAt: number
  /** Display time of the last numbers repaint. */
  numbersAt: number
  numbers: RowNumbers
}

export interface MonitorState {
  def: MonitorDef
  layout: FaceLayout
  regions: MonitorRegions
  /** Seconds the sweeps are offset by (seeded: monitors do not sweep in step). */
  phase: number
  rows: RowState[]
  bands: BandState[]
  hot: boolean
  /** The monitor's own statics (the station's title bar) are painted; the minute they show. */
  ownLive: boolean
  ownMinute: number
}

export interface HubStats {
  pumps: number
  paints: number
  copies: number
  lastMs: number
  maxMs: number
  hot: number
  live: number
  waiting: number
  models: number
}

/** The staging sheet: shelf allocation of painted rectangles waiting to be copied. */
class Sheet {
  private x = 0
  private y = 0
  private shelf = 0
  private n = 0
  private readonly q: number[] = []

  constructor(
    readonly w: number,
    readonly h: number,
  ) {}

  get pending(): number {
    return this.n
  }

  /** Room for a `w` x `h` rectangle that will be copied to (dx, dy), or null when the sheet is full. */
  alloc(w: number, h: number, dx: number, dy: number, out: { x: number; y: number }): boolean {
    if (this.x + w > this.w) {
      this.y += this.shelf
      this.x = 0
      this.shelf = 0
    }
    if (this.y + h > this.h || w > this.w) return false
    out.x = this.x
    out.y = this.y
    this.x += w + 1
    if (h + 1 > this.shelf) this.shelf = h + 1
    const k = this.n * 6
    this.q[k] = out.x
    this.q[k + 1] = out.y
    this.q[k + 2] = w
    this.q[k + 3] = h
    this.q[k + 4] = dx
    this.q[k + 5] = dy
    this.n++
    return true
  }

  /** Copy everything waiting; the last copy regenerates the mipmaps when `mips`. Returns how many copies were made. */
  flush(up: Uploader, mips: boolean): number {
    const n = this.n
    for (let i = 0; i < n; i++) {
      const k = i * 6
      up.copy(this.q[k], this.q[k + 1], this.q[k + 2], this.q[k + 3], this.q[k + 4], this.q[k + 5], mips && i === n - 1)
    }
    this.x = 0
    this.y = 0
    this.shelf = 0
    this.n = 0
    return n
  }
}

export interface HubOptions {
  /** The sheet's 2D context (a real canvas in the browser, a recorder in the tests). */
  sheet: Ctx2D
  /** The atlas plan (default: planned from the defs). */
  plan?: AtlasPlan
}

export class MonitorHub {
  readonly clock = new DisplayClock()
  readonly plan: AtlasPlan
  readonly monitors: MonitorState[]
  readonly models = new Map<string, PatientModel>()
  readonly stats: HubStats = { pumps: 0, paints: 0, copies: 0, lastMs: 0, maxMs: 0, hot: 0, live: 0, waiting: 0, models: 0 }

  private uploader: Uploader | null = null
  private readonly sheet = new Sheet(SHEET_W, SHEET_H)
  private readonly ctx: Ctx2D
  private generation = Number.NaN
  private readonly scratch = newOccupant()
  private readonly at = { x: 0, y: 0 }
  private readonly sw: SweepAt = { k: 0, c: 0 }
  private readonly face: FaceData
  private readonly faceRows: (RowNumbers | null)[] = []
  private readonly beds = stationBeds()
  private warmed = false

  constructor(
    readonly defs: readonly MonitorDef[],
    private readonly env: HubEnv,
    opts: HubOptions,
  ) {
    this.ctx = opts.sheet
    this.plan = opts.plan ?? planAtlas(defs)
    this.monitors = defs.map((def) => ({
      def,
      layout: def.layout,
      regions: this.plan.monitors[def.index],
      phase: hashUnit(def.index + 1, 77) * SWEEP.slow,
      rows: Array.from({ length: def.layout.rows }, () => ({
        occ: newOccupant(),
        key: '',
        model: null,
        live: false,
        attachedAt: 0,
        numbersAt: -Infinity,
        numbers: newRowNumbers(),
      })),
      bands: def.layout.bands.map(() => ({ sweep: [Number.NaN, Number.NaN], upTo: [0, 0], wave: 'ecg' })),
      hot: false,
      ownLive: false,
      ownMinute: -1,
    }))
    this.face = { layout: LAYOUTS.bedside3, bed: '', rowBeds: this.beds, simT: 0, rows: this.faceRows }
  }

  /** Start copying into the atlas. */
  attach(up: Uploader): void {
    this.uploader = up
  }

  /** The standby faces and every monitor's own statics, painted once (behind the loading screen), with no budget. */
  warm(): void {
    if (!this.uploader) return
    const done = new Set<AtlasPlan['idle'][FaceLayoutId]>()
    for (const id of LAYOUT_IDS) {
      const r = this.plan.idle[id]
      // a shared standby face (atlas.ts IDLE_SHARED) is painted once
      if (done.has(r)) continue
      done.add(r)
      if (!this.place(r.w, r.h, r.x, r.y)) continue
      paintIdleFace(this.ctx, this.at.x, this.at.y, LAYOUTS[id], this.beds)
      this.stats.paints++
    }
    const simT = this.env.simT()
    for (const m of this.monitors) this.paintOwn(m, simT)
    this.stats.copies += this.sheet.flush(this.uploader, true)
    this.warmed = true
  }

  /** One pump run. `budgetMs` caps the painting (the first job always runs). */
  pump(budgetMs = PAINT_BUDGET_MS): void {
    const up = this.uploader
    if (!up) return
    if (!this.warmed) this.warm()
    const start = this.env.nowMs()
    const t = this.clock.t
    const simT = this.env.simT()
    const gen = this.env.generation()
    if (gen !== this.generation) {
      this.reset()
      this.generation = gen
    }
    this.readOccupancy(simT)
    this.stepModels(t, simT)
    this.markHot()

    let jobs = 0
    const over = (): boolean => jobs > 0 && this.env.nowMs() - start > budgetMs
    // 1. hot rows waiting for their first paint, 2. hot sweeps, 3. hot numbers, 4. the monitors' own statics, 5. cold rows waiting, 6. cold numbers
    for (const m of this.monitors) if (m.hot) for (let r = 0; r < m.rows.length; r++) if (!over() && this.needsFill(m, r)) jobs += this.fill(m, r, t, simT)
    for (const m of this.monitors) if (m.hot && !over()) jobs += this.sweepHot(m, t)
    for (const m of this.monitors) if (m.hot) for (let r = 0; r < m.rows.length; r++) if (!over() && this.numbersDue(m, r, t)) jobs += this.paintRow(m, r, t, simT)
    for (const m of this.monitors) if (!over() && this.ownDue(m, simT)) jobs += this.paintOwn(m, simT)
    for (const m of this.monitors) if (!m.hot) for (let r = 0; r < m.rows.length; r++) if (!over() && this.needsFill(m, r)) jobs += this.fill(m, r, t, simT)
    for (const m of this.monitors) if (!m.hot) for (let r = 0; r < m.rows.length; r++) if (!over() && this.numbersDue(m, r, t)) jobs += this.paintRow(m, r, t, simT)

    if (this.sheet.pending > 0) this.stats.copies += this.sheet.flush(up, true)
    const ms = this.env.nowMs() - start
    this.stats.pumps++
    this.stats.lastMs = ms
    if (ms > this.stats.maxMs) this.stats.maxMs = ms
    this.countStats()
  }

  // -------------------------------------------------------------------------------------------
  // Occupancy and the patients' models
  // -------------------------------------------------------------------------------------------

  private reset(): void {
    for (const m of this.monitors) {
      for (let r = 0; r < m.rows.length; r++) this.setRow(m, r, null, 0)
    }
    this.models.clear()
  }

  private readOccupancy(simT: number): void {
    const o = this.scratch
    for (const m of this.monitors) {
      for (let r = 0; r < m.rows.length; r++) {
        const found = occupantOf(this.env.occupancy, m.def.context, m.def.seats[r], o)
        const key = found ? o.id : ''
        const row = m.rows[r]
        if (key !== row.key) this.setRow(m, r, found ? o : null, simT)
        if (found) {
          copyOccupant(o, row.occ)
          if (Number.isNaN(row.occ.since)) row.occ.since = row.attachedAt
          if (row.model) syncSituation(row.occ, row.model.sit)
        }
      }
    }
  }

  /** Put `occ` (or nobody) on row r: the row shows the standby face until its first paint. */
  private setRow(m: MonitorState, r: number, occ: Occupant | null, simT: number): void {
    const row = m.rows[r]
    if (row.model) {
      row.model.refs--
      if (row.model.refs <= 0) this.models.delete(row.model.id)
    }
    row.model = null
    row.key = occ ? occ.id : ''
    row.live = false
    row.numbersAt = -Infinity
    row.attachedAt = simT
    if (occ) {
      copyOccupant(occ, row.occ)
      if (Number.isNaN(row.occ.since)) row.occ.since = simT
      row.model = this.modelFor(row.occ, simT)
      row.model.refs++
    }
    for (let b = 0; b < m.layout.bands.length; b++) {
      if (m.layout.bands[b].row !== r) continue
      const bs = m.bands[b]
      bs.sweep[0] = Number.NaN
      bs.sweep[1] = Number.NaN
      bs.upTo[0] = 0
      bs.upTo[1] = 0
    }
  }

  private modelFor(occ: Occupant, simT: number): PatientModel {
    const have = this.models.get(occ.id)
    if (have) return have
    const seed = hashString(occ.id)
    const base = this.env.baseline(occ.id, occ.name, occ.reason)
    const sit = newSituation(occ.context)
    syncSituation(occ, sit)
    const vit = vitalsAt(base, sit, simT, newVitals())
    const heart: HeartDrive = { hr: vit.hr, rsa: vit.rsa, breathPeriod: 60 / vit.rr, jitter: vit.jitter }
    const breath: BreathDrive = { rr: vit.rr, jitter: vit.ventilated ? 0 : 0.08 }
    const beats = new TimeRing(256)
    const breaths = new TimeRing(64)
    const t0 = this.clock.t - BACKFILL
    startBeats(beats, seed, t0, heart)
    startBreaths(breaths, seed, t0, breath)
    const look = lookFor(seed)
    const model: PatientModel = {
      id: occ.id,
      seed,
      base,
      sit,
      vit,
      heart,
      breath,
      beats,
      breaths,
      look,
      nibp: newNibp(),
      src: { beats, breaths, look, vit },
      refs: 0,
    }
    this.models.set(occ.id, model)
    return model
  }

  private stepModels(t: number, simT: number): void {
    for (const model of this.models.values()) {
      const v = vitalsAt(model.base, model.sit, simT, model.vit)
      model.heart.hr = v.hr
      model.heart.rsa = v.rsa
      model.heart.breathPeriod = 60 / v.rr
      model.heart.jitter = v.jitter
      model.breath.rr = v.rr
      model.breath.jitter = v.ventilated ? 0 : 0.08
      extendBeats(model.beats, model.seed, t + AHEAD_BEATS, model.heart)
      extendBreaths(model.breaths, model.seed, t + AHEAD_BREATHS, model.breath)
      nibpAt(model.base, model.sit, simT, model.nibp)
    }
  }

  private markHot(): void {
    const you = this.env.walker()
    const focus = this.env.focus()
    const yourLevel = you ? levelOf(you.x) : 0
    for (const m of this.monitors) {
      const a = m.def.anchor
      const near = you !== null && yourLevel === m.def.level && (you.x - a.x) ** 2 + (you.z - a.z) ** 2 < HOT_RADIUS * HOT_RADIUS
      m.hot = near || focus === m.def.area
    }
  }

  // -------------------------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------------------------

  /** Room on the sheet for a rectangle bound for atlas (dx, dy); flushes a full sheet first. Writes `this.at`. */
  private place(w: number, h: number, dx: number, dy: number): boolean {
    if (this.sheet.alloc(w, h, dx, dy, this.at)) return true
    if (this.uploader) this.stats.copies += this.sheet.flush(this.uploader, false)
    return this.sheet.alloc(w, h, dx, dy, this.at)
  }

  private needsFill(m: MonitorState, r: number): boolean {
    const row = m.rows[r]
    return row.model !== null && !row.live
  }

  private numbersDue(m: MonitorState, r: number, t: number): boolean {
    const row = m.rows[r]
    return row.live && t - row.numbersAt >= (m.hot ? HOT_NUMBERS : COLD_NUMBERS)
  }

  private ownDue(m: MonitorState, simT: number): boolean {
    return m.layout.statics.some((s) => s.row < 0) && (!m.ownLive || Math.floor(simT / 60) !== m.ownMinute)
  }

  /** The face data of monitor m for the painters (rows' numbers refreshed from their models at display time t). */
  private faceOf(m: MonitorState, t: number, simT: number): FaceData {
    const f = this.face
    f.layout = m.layout
    f.bed = m.def.bed
    f.simT = simT
    this.faceRows.length = m.rows.length
    for (let r = 0; r < m.rows.length; r++) {
      const row = m.rows[r]
      if (row.model) fillNumbers(row, row.model, t)
      this.faceRows[r] = row.model ? row.numbers : null
    }
    return f
  }

  /** The monitor's own statics (row -1: the station's title bar). */
  private paintOwn(m: MonitorState, simT: number): number {
    let n = 0
    const d = this.faceOf(m, this.clock.t, simT)
    m.layout.statics.forEach((s, i) => {
      if (s.row >= 0) return
      const reg = m.regions.statics[i]
      if (!this.place(reg.w, reg.h, reg.x, reg.y)) return
      paintStatic(this.ctx, this.at.x, this.at.y, s, d)
      n++
    })
    this.stats.paints += n
    m.ownLive = true
    m.ownMinute = Math.floor(simT / 60)
    return n
  }

  /** Repaint row r's statics (its numbers, its header). */
  private paintRow(m: MonitorState, r: number, t: number, simT: number): number {
    let n = 0
    const d = this.faceOf(m, t, simT)
    m.layout.statics.forEach((s, i) => {
      if (s.row !== r) return
      const reg = m.regions.statics[i]
      if (!this.place(reg.w, reg.h, reg.x, reg.y)) return
      paintStatic(this.ctx, this.at.x, this.at.y, s, d)
      n++
    })
    m.rows[r].numbersAt = t
    this.stats.paints += n
    return n
  }

  /** A new patient's first paint: the row's statics, its bands' labels and both sweep slots in full (this sweep and the one before). Then it shows. */
  private fill(m: MonitorState, r: number, t: number, simT: number): number {
    const row = m.rows[r]
    const model = row.model
    if (!model) return 0
    let n = this.paintRow(m, r, t, simT)
    for (let b = 0; b < m.layout.bands.length; b++) {
      const spec = m.layout.bands[b]
      if (spec.row !== r) continue
      const bs = m.bands[b]
      const reg = m.regions.bands[b]
      bs.wave = waveOf(spec.channel, model.vit.art, model.vit.co2)
      if (this.place(reg.label.w, reg.label.h, reg.label.x, reg.label.y)) {
        paintLabelSlot(this.ctx, this.at.x, this.at.y, reg.label.w, reg.label.h, bs.wave)
        n++
      }
      const period = SWEEP[spec.speed]
      sweepAt(t, m.phase, period, spec.w, this.sw)
      const k = this.sw.k
      for (const sweep of [k, k - 1]) {
        const e = entryOf(sweep)
        const dst = reg.entries[e]
        if (!this.place(dst.w, dst.h, dst.x, dst.y)) continue
        paintSlotChunk(this.ctx, this.at.x, this.at.y, spec.w, spec.h, m.layout.labelW, bs.wave, model.src, columnTime(sweep, 0, m.phase, period, spec.w), period, 0, spec.w)
        bs.sweep[e] = sweep
        bs.upTo[e] = spec.w
        n++
      }
    }
    row.live = true
    this.stats.paints += n
    return n
  }

  /**
   * A hot monitor's sweeps: for every band of a live row, finish this sweep's slot where the cursor has not reached yet, and paint the next sweep's
   * slot as far as the screen no longer shows the slot it replaces (up to the far edge of the erase bar). Each piece is copied on its own.
   */
  private sweepHot(m: MonitorState, t: number): number {
    let n = 0
    for (let b = 0; b < m.layout.bands.length; b++) {
      const spec = m.layout.bands[b]
      const row = m.rows[spec.row]
      const model = row.model
      if (!row.live || !model) continue
      const bs = m.bands[b]
      const period = SWEEP[spec.speed]
      sweepAt(t, m.phase, period, spec.w, this.sw)
      const k = this.sw.k
      const c = this.sw.c
      const ec = entryOf(k)
      if (bs.sweep[ec] !== k) {
        // this slot holds an older sweep (the monitor was cold): leave what the screen shows, paint the rest
        bs.sweep[ec] = k
        bs.upTo[ec] = Math.min(spec.w, Math.ceil(c) + 1)
      }
      if (bs.upTo[ec] < spec.w) n += this.chunk(m, b, ec, k, bs.upTo[ec], spec.w, model)
      const en = entryOf(k + 1)
      if (bs.sweep[en] !== k + 1) {
        bs.sweep[en] = k + 1
        bs.upTo[en] = 0
      }
      const limit = Math.min(spec.w, Math.floor(c + GAP))
      if (limit > bs.upTo[en]) n += this.chunk(m, b, en, k + 1, bs.upTo[en], limit, model)
    }
    this.stats.paints += n
    return n
  }

  /** Paint columns [x0, x1) of sweep k's slot into entry e of band b and queue the copy of just those columns. */
  private chunk(m: MonitorState, b: number, e: 0 | 1, k: number, x0: number, x1: number, model: PatientModel): number {
    const spec = m.layout.bands[b]
    const bs = m.bands[b]
    const dst = m.regions.bands[b].entries[e]
    const w = x1 - x0
    if (w <= 0 || !this.place(w, spec.h, dst.x + x0, dst.y)) return 0
    // the chunk is painted with the slot's own (0, 0) shifted so that column x0 lands at the allocated spot (the painter clips to the chunk)
    const period = SWEEP[spec.speed]
    paintSlotChunk(this.ctx, this.at.x - x0, this.at.y, spec.w, spec.h, m.layout.labelW, bs.wave, model.src, columnTime(k, 0, m.phase, period, spec.w), period, x0, x1)
    bs.upTo[e] = x1
    return 1
  }

  private countStats(): void {
    let hot = 0
    let live = 0
    let waiting = 0
    for (const m of this.monitors) {
      if (m.hot) hot++
      for (const row of m.rows) {
        if (row.live) live++
        else if (row.model) waiting++
      }
    }
    this.stats.hot = hot
    this.stats.live = live
    this.stats.waiting = waiting
    this.stats.models = this.models.size
  }
}

function copyOccupant(from: Occupant, to: Occupant): void {
  to.id = from.id
  to.name = from.name
  to.reason = from.reason
  to.context = from.context
  to.since = from.since
  to.acuity = from.acuity
  to.phase = from.phase
  to.procedure = from.procedure
  to.dockedAt = from.dockedAt
  to.insufflationEnd = from.insufflationEnd
}

function syncSituation(o: Occupant, s: Situation): void {
  s.context = o.context
  s.since = o.since
  s.acuity = o.acuity
  s.phase = o.phase
  s.procedure = o.procedure
  s.dockedAt = o.dockedAt
  s.insufflationEnd = o.insufflationEnd
}

/** A row's numbers at display time t: HR and RR counted from the beats and breaths, the rest from the targets and the cuff. */
export function fillNumbers(row: RowState, model: PatientModel, t: number): RowNumbers {
  const out = row.numbers
  const v = model.vit
  out.name = row.occ.name
  const hr = displayedHr(model.beats, t)
  out.hr = hr > 0 ? hr : Math.round(v.hr)
  out.spo2 = Math.round(v.spo2)
  const rr = v.ventilated ? Math.round(v.rr) : displayedRr(model.breaths, t)
  out.rr = rr > 0 ? rr : Math.round(v.rr)
  out.temp = v.temp
  const n = model.nibp
  out.nibp.has = n.has
  out.nibp.sys = n.sys
  out.nibp.dia = n.dia
  out.nibp.map = n.map
  out.nibp.at = n.at
  out.nibp.n = n.n
  const every = nibpInterval(model.sit)
  out.nibpEvery = Number.isFinite(every) ? Math.round(every / 60) : 0
  out.art = v.art
  // the arterial line's numbers swing a little with the breathing, beat to beat
  const swing = Math.sin(t * 0.9 + model.seed) * 2
  out.artSys = Math.round(v.sys + 4 + swing)
  out.artDia = Math.round(v.dia + 1)
  out.co2 = v.co2
  out.etco2 = v.etco2
  out.ventilated = v.ventilated
  return out
}
