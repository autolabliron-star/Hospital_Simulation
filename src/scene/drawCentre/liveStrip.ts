/**
 * The robots' live view strip: ONE canvas (768 x 160) with three cells, one per robot, shown on the three 21 inch screens. Each cell is a small
 * monitor: a near-infrared vein map with a moving scan line, an ultrasound inset and a progress bar (needle depth, then the tubes filling).
 *
 * Refresh rules (the live demo must never stutter, see `cellRefresh`):
 *   a robot that is scanning, inserting or filling while the presenter or the player is in the draw centre   10 Hz
 *   a robot that is busy (any other phase, or any phase while nobody is in the room)                          2 Hz
 *   an idle robot                                                                                             one static "Ready" frame, drawn once
 *
 * Drawing only touches the canvas API (no DOM), through the `Env` the imaging suite uses, so it runs against a recording mock in node.
 * All the words come from src/content/drawUi.json.
 *
 * R3: with the imaging worker (`backend`), the map and the inset are real pictures of the patient's synthetic forearm (render/nir.ts, the
 * US_LINEAR preset along the median cubital vein, the needle in the image plane): a cell asks for a new picture each time it repaints and
 * shows the newest one that has arrived for THIS patient; until then (and without a worker) it keeps the vector drawing.
 */
import type { Ctx2D, Env, Surface } from '@/scene/imaging/images/ctx'
import type { FrameIn, ImagingBackend } from '@/scene/imaging/worker/client'
import type { VeinJob } from '@/scene/imaging/worker/protocol'
import { DRAW_UI, fillDraw, phaseText } from '@/content/drawUi'
import { LAB_CATALOGUE } from '@/content/lab'
import type { DrawPhase, DrawStationState } from '@/sim/types'
import { LED_HEX } from './motion'

export const STRIP_W = 768
export const STRIP_H = 160
export const CELLS = 3
export const CELL_W = STRIP_W / CELLS

/** Redraw periods in milliseconds. */
export const LIVE_MS = 100
export const BUSY_MS = 500

export type CellMode = 'idle' | 'busy' | 'live'

/** A phase in which the robot looks, inserts or fills: its screen is the interesting one. */
export function isLivePhase(phase: DrawPhase): boolean {
  return phase === 'veinScan' || phase === 'needleIn' || phase === 'filling' || phase === 'needleOut'
}

/** What a phase means for the screen: nothing to show (idle, resetting), something running, or a live procedure. */
export function cellMode(phase: DrawPhase): CellMode {
  if (phase === 'idle' || phase === 'reset') return 'idle'
  return isLivePhase(phase) ? 'live' : 'busy'
}

/** How often a cell repaints: the period in ms, or null for "once, then never until something changes". */
export function cellRefresh(phase: DrawPhase, inRoom: boolean): number | null {
  const mode = cellMode(phase)
  if (mode === 'idle') return null
  return mode === 'live' && inRoom ? LIVE_MS : BUSY_MS
}

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------

const FONT = 'ui-monospace, Menlo, Consolas, monospace'
const BG = '#061012'
const MAP = { x: 8, y: 26, w: 150, h: 96 }
const US = { x: 164, y: 26, w: 84, h: 96 }
const BAR = { x: 8, y: 130, w: 240, h: 10 }
/** The worker's ultrasound picture is square; the inset shows its middle `US.w` columns. */
const US_PX = 96

/** A worker picture of one robot's patient: the map on the left of `canvas`, the ultrasound right of it, and the needle's target on the map. */
export interface VeinPicture {
  canvas: Surface['canvas']
  tx: number
  ty: number
}

/** A small deterministic hash (0..2^32) of a string or numbers: the same patient always has the same veins. */
export function hash(seed: number, a = 0, b = 0): number {
  let h = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0
  return (h ^ (h >>> 15)) >>> 0
}
export function seedOf(text: string | null): number {
  let h = 5381
  const s = text ?? ''
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0
  return h
}
const unit = (h: number): number => h / 4294967296

function label(c: Ctx2D, s: string, x: number, y: number, align: CanvasTextAlign, size: number, fill: string, bold = false): void {
  c.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.fillStyle = fill
  c.fillText(s, x, y)
}

function frame(c: Ctx2D, x0: number, n: number, accent: string): void {
  c.fillStyle = BG
  c.fillRect(x0, 0, CELL_W, STRIP_H)
  c.strokeStyle = accent
  c.globalAlpha = 0.55
  c.lineWidth = 2
  c.strokeRect(x0 + 1, 1, CELL_W - 2, STRIP_H - 2)
  c.globalAlpha = 1
  label(c, fillDraw(DRAW_UI.strip.robot, { n }), x0 + 8, 17, 'left', 11, accent, true)
}

/** The static frame of an idle robot: its name, "Ready" and the disclaimer. Drawn once. */
export function paintReadyCell(c: Ctx2D, index: number): void {
  const x0 = index * CELL_W
  frame(c, x0, index + 1, '#7fd6cf')
  label(c, DRAW_UI.strip.ready.toUpperCase(), x0 + CELL_W / 2, 84, 'center', 26, 'rgba(210,235,236,0.9)', true)
  label(c, phaseText('idle'), x0 + CELL_W / 2, 104, 'center', 10, 'rgba(160,190,194,0.9)')
  label(c, DRAW_UI.strip.simulated, x0 + CELL_W / 2, STRIP_H - 12, 'center', 9, 'rgba(150,175,178,0.8)')
}

/** The vein pattern of one patient: where the main vein crosses the map (as fractions) and its two branches. */
export interface Veins {
  /** Main vein: start, control and end, in map fractions. */
  a: [number, number, number, number, number, number]
  b: [number, number, number, number, number, number]
  c: [number, number, number, number, number, number]
  /** Where the needle goes (a fraction along x of the map; the vein's y there is `ty`). */
  tx: number
  ty: number
}

export function veinsFor(seed: number): Veins {
  const r = (k: number, lo: number, hi: number): number => lo + (hi - lo) * unit(hash(seed, k))
  const y0 = r(1, 0.55, 0.75)
  const y1 = r(2, 0.25, 0.45)
  const a: Veins['a'] = [0, y0, 0.5, r(3, 0.3, 0.7), 1, y1]
  const tx = r(4, 0.62, 0.78)
  // the vein's height at tx: with the control point at x 0.5, the Bezier's x is t itself
  const ty = (1 - tx) * (1 - tx) * a[1] + 2 * tx * (1 - tx) * a[3] + tx * tx * a[5]
  const b: Veins['b'] = [0.25, r(5, 0.1, 0.3), 0.45, r(6, 0.3, 0.5), 0.55, 0.45]
  const c: Veins['c'] = [0.35, r(7, 0.8, 0.95), 0.6, r(8, 0.65, 0.85), 0.8, r(9, 0.55, 0.7)]
  return { a, b, c, tx, ty }
}

function curve(c: Ctx2D, v: Veins['a'], w: number, h: number): void {
  c.beginPath()
  c.moveTo(v[0] * w, v[1] * h)
  c.quadraticCurveTo(v[2] * w, v[3] * h, v[4] * w, v[5] * h)
  c.stroke()
}

/** The NIR vein map: a dark red field, veins as bright lines, the scan line sweeping wrist to crease, then the target mark. */
function paintMap(c: Ctx2D, x0: number, s: DrawStationState, veins: Veins, pic: VeinPicture | null): void {
  const { x, y, w, h } = MAP
  c.save()
  c.beginPath()
  c.rect(x0 + x, y, w, h)
  c.clip()
  if (pic) {
    // the near-infrared camera's picture: the veins dark through the skin
    c.drawImage(pic.canvas, 0, 0, w, h, x0 + x, y, w, h)
    c.translate(x0 + x, y)
  } else {
    c.fillStyle = '#2a0709'
    c.fillRect(x0 + x, y, w, h)
    c.translate(x0 + x, y)
    c.lineCap = 'round'
    c.strokeStyle = 'rgba(255,120,105,0.85)'
    c.lineWidth = 5
    curve(c, veins.a, w, h)
    c.lineWidth = 3
    curve(c, veins.b, w, h)
    curve(c, veins.c, w, h)
    c.strokeStyle = 'rgba(255,214,205,0.9)'
    c.lineWidth = 1.5
    curve(c, veins.a, w, h)
  }
  const scanning = s.phase === 'veinScan'
  const sx = Math.max(0, Math.min(1, s.scan)) * w
  if (scanning) {
    c.fillStyle = 'rgba(255,60,50,0.28)'
    c.fillRect(Math.max(0, sx - 18), 0, 18, h)
    c.fillStyle = 'rgba(255,225,215,0.95)'
    c.fillRect(sx - 1, 0, 2, h)
  } else if (s.phase === 'needleIn' || s.phase === 'filling' || s.phase === 'needleOut') {
    const tx = (pic ? pic.tx : veins.tx) * w
    const ty = (pic ? pic.ty : veins.ty) * h
    c.strokeStyle = '#7fffd6'
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(tx, ty, 9, 0, Math.PI * 2)
    c.moveTo(tx - 14, ty)
    c.lineTo(tx + 14, ty)
    c.moveTo(tx, ty - 14)
    c.lineTo(tx, ty + 14)
    c.stroke()
  }
  c.restore()
  c.strokeStyle = 'rgba(255,120,105,0.45)'
  c.lineWidth = 1
  c.strokeRect(x0 + x + 0.5, y + 0.5, w - 1, h - 1)
  label(c, DRAW_UI.strip.nir, x0 + x + 5, y + 11, 'left', 8, 'rgba(255,200,190,0.9)')
  if (scanning) label(c, DRAW_UI.strip.scanning, x0 + x + w - 5, y + h - 6, 'right', 8, 'rgba(255,225,215,0.95)', true)
  else if (s.phase !== 'armIn' && s.phase !== 'cuff' && s.phase !== 'sanitise' && s.phase !== 'cardScan' && s.phase !== 'calling') label(c, DRAW_UI.strip.vein, x0 + x + w - 5, y + h - 6, 'right', 8, '#7fffd6', true)
}

/** The ultrasound inset: a sector with speckle, the vein's cross section and, while the needle goes in, the bright needle line. */
function paintUltrasound(c: Ctx2D, x0: number, s: DrawStationState, seed: number, t: number, pic: VeinPicture | null): void {
  const { x, y, w, h } = US
  c.save()
  c.beginPath()
  c.rect(x0 + x, y, w, h)
  c.clip()
  if (pic) {
    // the needle guide: the linear probe's picture along the vein (the needle comes in from the left)
    c.drawImage(pic.canvas, MAP.w + (US_PX - w) / 2, 0, w, h, x0 + x, y, w, h)
    c.restore()
    c.strokeStyle = 'rgba(160,200,208,0.4)'
    c.lineWidth = 1
    c.strokeRect(x0 + x + 0.5, y + 0.5, w - 1, h - 1)
    label(c, DRAW_UI.strip.us, x0 + x + 5, y + 11, 'left', 8, 'rgba(190,225,230,0.9)')
    return
  }
  c.fillStyle = '#040809'
  c.fillRect(x0 + x, y, w, h)
  // the sector
  const cx = x0 + x + w / 2
  c.fillStyle = '#16232a'
  c.beginPath()
  c.moveTo(cx, y + 2)
  c.lineTo(cx - w * 0.46, y + h - 2)
  c.lineTo(cx + w * 0.46, y + h - 2)
  c.closePath()
  c.fill()
  // speckle: a fresh scatter every 100 ms while it is live
  const frameNo = Math.floor(t * 10)
  c.fillStyle = 'rgba(190,215,220,0.5)'
  for (let k = 0; k < 46; k++) {
    const hh = hash(seed, k, frameNo)
    const u = unit(hh)
    const v = unit(hash(hh, 3))
    const px = cx + (u - 0.5) * w * 0.8 * (0.2 + 0.8 * v)
    const py = y + 4 + v * (h - 8)
    c.fillRect(px, py, 1.5, 1.5)
  }
  // the vessel: a dark oval; the needle line crosses to it as the needle advances
  const vx = cx + (unit(hash(seed, 11)) - 0.5) * 10
  const vy = y + h * 0.58
  c.fillStyle = '#020405'
  c.beginPath()
  c.ellipse(vx, vy, 13, 8, 0, 0, Math.PI * 2)
  c.fill()
  c.strokeStyle = 'rgba(180,210,215,0.6)'
  c.lineWidth = 1
  c.stroke()
  const depth = s.phase === 'needleIn' || s.phase === 'filling' || s.phase === 'needleOut' ? Math.max(0, Math.min(1, s.needle)) : 0
  if (depth > 0) {
    c.strokeStyle = 'rgba(255,255,255,0.95)'
    c.lineWidth = 1.5
    c.beginPath()
    c.moveTo(vx - 34, vy - 30)
    c.lineTo(vx - 34 + 34 * depth, vy - 30 + 30 * depth)
    c.stroke()
  }
  c.restore()
  c.strokeStyle = 'rgba(160,200,208,0.4)'
  c.lineWidth = 1
  c.strokeRect(x0 + x + 0.5, y + 0.5, w - 1, h - 1)
  label(c, DRAW_UI.strip.us, x0 + x + 5, y + 11, 'left', 8, 'rgba(190,225,230,0.9)')
}

/** The bar under the pictures: needle depth, then one segment per tube (in its cap colour) filling in turn; otherwise the scan's progress. */
function paintBar(c: Ctx2D, x0: number, s: DrawStationState): void {
  const { x, y, w, h } = BAR
  c.fillStyle = 'rgba(255,255,255,0.09)'
  c.fillRect(x0 + x, y, w, h)
  let caption = phaseText(s.phase, s.tube, s.tubes.length)
  if (s.phase === 'needleIn') {
    c.fillStyle = '#f4f8f8'
    c.fillRect(x0 + x, y, w * Math.max(0, Math.min(1, s.needle)), h)
    caption = `${DRAW_UI.strip.needle}  ${Math.round(Math.max(0, Math.min(1, s.needle)) * 100)}%`
  } else if (s.phase === 'filling' || s.phase === 'needleOut') {
    const n = Math.max(1, s.tubes.length)
    const gap = 3
    const seg = (w - gap * (n - 1)) / n
    for (let k = 0; k < n; k++) {
      const fill = s.phase === 'needleOut' ? 1 : k < s.tube ? 1 : k === s.tube ? Math.max(0, Math.min(1, s.tubeFill)) : 0
      const kind = s.tubes[k]
      c.fillStyle = kind ? LAB_CATALOGUE.tubes[kind].hex : '#c8d4d6'
      c.fillRect(x0 + x + k * (seg + gap), y, seg * fill, h)
    }
    caption = s.phase === 'filling' ? fillDraw(DRAW_UI.strip.tube, { n: Math.min(n, s.tube + 1), total: n }) : phaseText(s.phase)
  } else if (s.phase === 'veinScan') {
    c.fillStyle = '#ff6a5c'
    c.fillRect(x0 + x, y, w * Math.max(0, Math.min(1, s.scan)), h)
  }
  label(c, caption, x0 + x, y + h + 14, 'left', 9, 'rgba(215,235,236,0.95)')
  if (s.ticket) label(c, s.ticket, x0 + x + w, y + h + 14, 'right', 9, 'rgba(160,190,194,0.95)', true)
}

/** One robot's live cell (a patient is at the robot). */
export function paintCell(c: Ctx2D, index: number, s: DrawStationState, t: number, pic: VeinPicture | null = null): void {
  const x0 = index * CELL_W
  const accent = LED_HEX[s.light]
  frame(c, x0, index + 1, accent)
  label(c, phaseText(s.phase, s.tube, s.tubes.length), x0 + CELL_W - 8, 17, 'right', 9, 'rgba(200,225,228,0.95)')
  const seed = seedOf(s.patientId ?? s.ticket)
  paintMap(c, x0, s, veinsFor(seed), pic)
  paintUltrasound(c, x0, s, seed, t, pic)
  paintBar(c, x0, s)
}

// ---------------------------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------------------------

export class LiveStrip {
  readonly surface: Surface
  readonly canvas: Surface['canvas']
  /** Called after any redraw: the 3D texture flags itself for upload here. */
  onDraw: (() => void) | null = null
  /** How many cell paints so far (for the tests and the probe). */
  paints = 0

  private readonly lastDraw: number[] = [-1e9, -1e9, -1e9]
  private readonly lastPhase: DrawPhase[] = ['idle', 'idle', 'idle']
  private readonly readyShown: boolean[] = [false, false, false]
  // R3: the worker's pictures per robot: the job (reused), the patient it was asked for, the newest picture and whose it is
  private readonly jobs: VeinJob[] = []
  private readonly asked: number[] = [-1, -1, -1]
  private readonly pics: (VeinPicture | null)[] = [null, null, null]
  private readonly picSeed: number[] = [-1, -1, -1]
  private readonly stages: (Surface | null)[] = [null, null, null]
  private frameNo = 0

  constructor(
    private readonly env: Env,
    /** R3: the imaging worker (null: the vector drawings). */
    private readonly backend: ImagingBackend | null = null,
  ) {
    for (let i = 0; i < CELLS; i++) this.jobs.push({ t: 'vein', slot: `draw${i}`, id: 0, seed: 0, needle: 0, time: 0, n: 0, mapW: MAP.w, mapH: MAP.h, us: US_PX })
    this.surface = env.createSurface(STRIP_W, STRIP_H)
    this.canvas = this.surface.canvas
    for (let i = 0; i < CELLS; i++) {
      paintReadyCell(this.surface.ctx, i)
      this.readyShown[i] = true
    }
  }

  /**
   * Call every frame. Decides for itself which cells are due (see `cellRefresh`) and repaints only those; returns how many it painted.
   * `simT` is the sim clock in seconds (the speckle and the scan marker follow it), `nowMs` the page clock.
   */
  update(stations: readonly DrawStationState[], inRoom: boolean, nowMs: number, simT: number): number {
    let painted = 0
    for (let i = 0; i < CELLS && i < stations.length; i++) {
      const s = stations[i]
      const every = cellRefresh(s.phase, inRoom)
      if (every === null) {
        if (!this.readyShown[i]) {
          paintReadyCell(this.surface.ctx, i)
          this.readyShown[i] = true
          this.lastPhase[i] = s.phase
          painted++
        }
        continue
      }
      const changed = this.lastPhase[i] !== s.phase || this.readyShown[i]
      if (!changed && nowMs - this.lastDraw[i] < every) continue
      paintCell(this.surface.ctx, i, s, simT, this.backend ? this.picture(i, s, simT) : null)
      this.readyShown[i] = false
      this.lastDraw[i] = nowMs
      this.lastPhase[i] = s.phase
      painted++
    }
    if (painted > 0) {
      this.paints += painted
      this.onDraw?.()
    }
    return painted
  }

  /** R3: file the newest worker picture of robot i, ask for the next one, and give the picture to paint if it is this patient's. */
  private picture(i: number, s: DrawStationState, simT: number): VeinPicture | null {
    const backend = this.backend!
    const f = backend.take(`draw${i}`)
    if (f) this.file(i, f)
    const seed = seedOf(s.patientId ?? s.ticket)
    const j = this.jobs[i]
    j.id++
    j.seed = seed
    j.needle = s.phase === 'needleIn' || s.phase === 'filling' || s.phase === 'needleOut' ? (s.phase === 'needleIn' ? s.needle : 1) : 0
    j.time = simT
    j.n = this.frameNo++
    backend.send(j)
    this.asked[i] = seed
    return this.picSeed[i] === seed ? this.pics[i] : null
  }

  private file(i: number, f: FrameIn): void {
    let pic = this.pics[i]
    if (!pic || pic.canvas.width !== f.w || pic.canvas.height !== f.h) {
      const st = this.env.createSurface(f.w, f.h)
      pic = { canvas: st.canvas, tx: 0.5, ty: 0.5 }
      this.pics[i] = pic
      this.stages[i] = st
    }
    const c = this.stages[i]!.ctx
    if (f.bitmap) {
      c.drawImage(f.bitmap, 0, 0)
      f.bitmap.close()
    } else if (f.rgba) {
      const img = c.createImageData(f.w, f.h)
      img?.data?.set?.(f.rgba)
      c.putImageData(img, 0, 0)
    }
    pic.tx = f.meta.vein?.tx ?? 0.5
    pic.ty = f.meta.vein?.ty ?? 0.5
    // the worker answers the newest job only: a frame for the last ask is that patient's
    this.picSeed[i] = f.id === this.jobs[i].id ? this.asked[i] : -1
  }

}
