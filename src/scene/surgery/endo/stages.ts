/**
 * R5 (the stages): the endoscope picture follows the step of the operation. The room's `ProcedureView.scope` (a key the script's console steps carry:
 * src/content/procedures) picks a STAGE of the case's procedure; the stage sets what the picture shows:
 *
 *   camera     where the endoscope looks on the plate and how close (a pan and a zoom to the landmark of the step), eased from the stage before
 *   patches    pieces of plate baked from a changed layout (anatomy.ts `PATCHES`): Calot's triangle cleared (two structures), the gallbladder gone from its
 *              bed, the uterus out, the prostate out; they fade in over the step
 *   cleared    soft pale patches of tissue that dissection has been through
 *   marks      a thin line round the cervix as the cut goes round it (a mark, never a wound)
 *   sutures    a running stitch drawn along a line as the step goes on (the vaginal top, the join of bladder and urethra)
 *   clips      metal clips on the duct and artery; purple polymer (Hem-o-lok) clips on the prostate's side supports
 *   bag        the pale retrieval bag with the specimen in it
 *   glow       the dye's near-infrared view (Firefly): the tissue goes dark and the ducts glow green
 *
 * Every feature has a stage it first shows in and a window of that stage's progress it comes in over; after that stage it stays (the clips stay on, the
 * cleared tissue stays cleared), unless it names a stage where it goes (the bag is parked when the repair begins). A stage with no entry, a scope the
 * procedure does not know, or a case with no script give today's picture (the view's stage is -1: no features, the camera at rest).
 *
 * Nothing here allocates per frame (the tables are made at load; the draw functions read them) and nothing makes a new shader program: patches, blobs,
 * bags and glows are `drawImage` of canvases baked at load; clips, marks and sutures are a few rectangles and strokes.
 */
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import type { ProcedureId } from '@/sim/types'
import { PLATE_ASPECT } from './anatomy'
import { DECAL, endoDecals } from './decals'
import { smooth } from './field'
import { endoPlates, PLATE_H, type EndoPatchImage } from './plates'
import type { EndoView } from './view'

/** The picture's own window on the plate (plate units): see frame.ts `windowInto`. */
export interface PlateWindow {
  /** The tissue's window: its corner and size. */
  x0: number
  y0: number
  w: number
  h: number
  /** The wet layer's window (it moves a little more than the tissue): its corner. */
  lx0: number
  ly0: number
}

export const newWindow = (): PlateWindow => ({ x0: 0, y0: 0, w: 1, h: 1, lx0: 0, ly0: 0 })

const A = PLATE_ASPECT

// ---------------------------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------------------------

export interface StageDef {
  key: string
  /** Where the camera looks (plate units) and how close (1 is the picture at rest). */
  cx: number
  cy: number
  zoom: number
  /** The near-infrared view: 0 white light .. 1 full Firefly. */
  glow: number
}

const stage = (key: string, cx: number, cy: number, zoom: number, glow = 0): StageDef => ({ key, cx, cy, zoom, glow })

/** When a feature shows: from the stage `at` (coming in over `p0`..`p1` of its progress), until the start of stage `gone` (-1: it stays). */
interface Timing {
  at: number
  p0: number
  p1: number
  gone: number
}

interface PatchUse extends Timing {
  id: number
}
interface Blob extends Timing {
  x: number
  y: number
  rx: number
  ry: number
  rot: number
  /** Its strongest opacity. */
  a: number
}
interface Mark extends Timing {
  x: number
  y: number
  rx: number
  ry: number
}
interface Clip extends Timing {
  x: number
  y: number
  ang: number
  len: number
  /** 0 metal, 1 purple polymer (Hem-o-lok). */
  kind: number
}
interface Bag extends Timing {
  x: number
  y: number
  w: number
  h: number
  rot: number
  /** 0 gallbladder, 1 prostate. */
  kind: number
}
interface Suture extends Timing {
  /** The line [x0, y0, x1, y1, ...], each segment's length, the total, and the stitches (n of them, each [x, y, dx, dy]: where it is and which way it goes across the line). */
  pts: Float64Array
  seg: Float64Array
  total: number
  n: number
  st: Float64Array
}

export interface StageSet {
  stages: readonly StageDef[]
  index: ReadonlyMap<string, number>
  patches: readonly PatchUse[]
  blobs: readonly Blob[]
  marks: readonly Mark[]
  sutures: readonly Suture[]
  clips: readonly Clip[]
  bags: readonly Bag[]
  /** Glow stamps [x, y, radius, strength] ... for the near-infrared view. */
  glow: Float32Array
}

/** A set under construction: the stage list first, then features by stage key. */
function build(stages: readonly StageDef[]) {
  const index = new Map<string, number>(stages.map((s, i) => [s.key, i]))
  const at = (key: string): number => {
    const i = index.get(key)
    if (i === undefined) throw new Error(`endo stages: no stage "${key}" (${stages.map((s) => s.key).join(', ')})`)
    return i
  }
  const timing = (key: string, p0: number, p1: number, gone?: string): Timing => ({ at: at(key), p0, p1, gone: gone === undefined ? -1 : at(gone) })
  const patches: PatchUse[] = []
  const blobs: Blob[] = []
  const marks: Mark[] = []
  const sutures: Suture[] = []
  const clips: Clip[] = []
  const bags: Bag[] = []
  let glow = new Float32Array(0)
  return {
    done: (): StageSet => ({ stages, index, patches, blobs, marks, sutures, clips, bags, glow }),
    setGlow: (stamps: readonly number[]) => void (glow = Float32Array.from(stamps)),
    patch: (key: string, p0: number, p1: number, id: number) => void patches.push({ ...timing(key, p0, p1), id }),
    blob: (key: string, p0: number, p1: number, x: number, y: number, rx: number, ry: number, rot: number, a: number) => void blobs.push({ ...timing(key, p0, p1), x, y, rx, ry, rot, a }),
    mark: (key: string, p0: number, p1: number, x: number, y: number, rx: number, ry: number, gone?: string) => void marks.push({ ...timing(key, p0, p1, gone), x, y, rx, ry }),
    clip: (key: string, p0: number, p1: number, x: number, y: number, ang: number, len: number, kind: number) => void clips.push({ ...timing(key, p0, p1), x, y, ang, len, kind }),
    bag: (key: string, p0: number, p1: number, x: number, y: number, w: number, h: number, rot: number, kind: number, gone?: string) =>
      void bags.push({ ...timing(key, p0, p1, gone), x, y, w, h, rot, kind }),
    suture: (key: string, p0: number, p1: number, pts: readonly number[], n: number, gone?: string) => void sutures.push({ ...timing(key, p0, p1, gone), ...polyline(pts, n) }),
  }
}

const STITCH_SLANT = 0.5

/** A polyline's segment lengths and `n` stitch places along it, each with the direction a stitch goes across the line at its place (slanted). */
function polyline(xy: readonly number[], n: number): Pick<Suture, 'pts' | 'seg' | 'total' | 'n' | 'st'> {
  const pts = Float64Array.from(xy)
  const segs = pts.length / 2 - 1
  const seg = new Float64Array(segs)
  let total = 0
  for (let i = 0; i < segs; i++) {
    seg[i] = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1])
    total += seg[i]
  }
  const st = new Float64Array(n * 4)
  for (let j = 0; j < n; j++) {
    let d = ((j + 0.5) / n) * total
    let i = 0
    while (i < segs - 1 && d > seg[i]) d -= seg[i++]
    const f = seg[i] > 0 ? d / seg[i] : 0
    const dx = pts[i * 2 + 2] - pts[i * 2]
    const dy = pts[i * 2 + 3] - pts[i * 2 + 1]
    const l = Math.hypot(dx, dy) || 1
    st[j * 4] = pts[i * 2] + dx * f
    st[j * 4 + 1] = pts[i * 2 + 1] + dy * f
    // across the line, turned about 30 degrees: a running stitch goes through the tissue at a slant
    const nx = -dy / l
    const ny = dx / l
    st[j * 4 + 2] = nx * Math.cos(STITCH_SLANT) - ny * Math.sin(STITCH_SLANT)
    st[j * 4 + 3] = nx * Math.sin(STITCH_SLANT) + ny * Math.cos(STITCH_SLANT)
  }
  return { pts, seg, total, n, st }
}

/** Glow stamps along a polyline, `step` apart. */
function along(out: number[], xy: readonly number[], step: number, r: number, a: number): void {
  for (let i = 0; i + 3 < xy.length; i += 2) {
    const dx = xy[i + 2] - xy[i]
    const dy = xy[i + 3] - xy[i + 1]
    const n = Math.max(1, Math.round(Math.hypot(dx, dy) / step))
    for (let j = 0; j < n; j++) out.push(xy[i] + (dx * j) / n, xy[i + 1] + (dy * j) / n, r, a)
  }
  out.push(xy[xy.length - 2], xy[xy.length - 1], r, a)
}

// ---- cholecystectomy -------------------------------------------------------------------------

/** The cystic duct as the plate draws it (anatomy.ts), and the dye's other ducts: the common hepatic duct going up into the liver, the bile duct going down. */
const DUCT = [0.86, 0.54, 0.71, 0.64, 0.57, 0.74, 0.42, 0.87]
const HEPATIC = [0.42, 0.87, 0.36, 0.7, 0.3, 0.52, 0.26, 0.36]
const BILE = [0.42, 0.87, 0.4, 0.95, 0.4, 1.0]
const GALLBLADDER_AXIS = [1.4, 0.09, 1.2, 0.25, 1.0, 0.39, 0.9, 0.5]

function chole(): StageSet {
  const b = build([
    stage('survey', A / 2, 0.5, 1),
    stage('liverEdge', 1.0, 0.36, 1.15),
    stage('firefly', 0.78, 0.6, 1.3, 1),
    stage('retract', 1.0, 0.38, 1.3),
    stage('calotDissection', 0.7, 0.66, 1.85),
    stage('criticalView', 0.7, 0.64, 1.6, 0.5),
    stage('clipping', 0.68, 0.68, 2.0),
    stage('dividing', 0.68, 0.68, 2.0),
    stage('liverBed', 1.05, 0.28, 1.45),
    stage('bagging', 1.05, 0.34, 1.3),
    stage('finalCheck', 0.9, 0.5, 1.1),
  ])
  // Calot's triangle cleared (two structures, and only two), then the gallbladder peeled off its bed
  b.patch('calotDissection', 0.1, 0.95, 0)
  b.patch('liverBed', 0.15, 0.95, 1)
  // clips across the cystic duct (two on the patient's side, one on the gallbladder's) and then the cystic artery: one at a time
  const duct = 4.12
  const artery = 4.5
  b.clip('clipping', 0.04, 0.16, 0.66, 0.676, duct, 0.076, 0)
  b.clip('clipping', 0.18, 0.3, 0.6, 0.716, duct, 0.076, 0)
  b.clip('clipping', 0.32, 0.44, 0.8, 0.578, duct, 0.076, 0)
  b.clip('clipping', 0.48, 0.6, 0.62, 0.58, artery, 0.054, 0)
  b.clip('clipping', 0.62, 0.74, 0.55, 0.59, artery, 0.054, 0)
  b.clip('clipping', 0.76, 0.88, 0.8, 0.52, artery, 0.054, 0)
  // the gallbladder in its bag, in the middle of the picture and then by the liver
  b.bag('bagging', 0, 0.7, 1.06, 0.36, 0.64, 0.48, -0.5, 0)
  const glow: number[] = []
  along(glow, DUCT, 0.025, 0.03, 1)
  along(glow, HEPATIC, 0.025, 0.027, 0.9)
  along(glow, BILE, 0.025, 0.03, 0.9)
  // a wide, faint halo on the cystic duct and the gallbladder's own faint glow
  along(glow, DUCT, 0.05, 0.07, 0.3)
  along(glow, GALLBLADDER_AXIS, 0.07, 0.11, 0.2)
  b.setGlow(glow)
  return b.done()
}

// ---- hysterectomy ----------------------------------------------------------------------------

function hyst(): StageSet {
  const b = build([
    stage('survey', A / 2, 0.5, 1),
    stage('roundLigament', 0.5, 0.34, 1.8),
    stage('bladderFlap', A / 2, 0.76, 1.8),
    stage('uterineVessels', 0.8, 0.7, 1.9),
    stage('colpotomy', A / 2, 0.75, 1.9),
    stage('delivery', A / 2, 0.62, 1.4),
    stage('needleDrivers', A / 2, 0.76, 1.8),
    stage('cuffClosure', A / 2, 0.76, 2.0),
    stage('finalCheck', A / 2, 0.55, 1.15),
  ])
  // the round ligaments sealed and divided, the bladder fold opened, the vessels at the cervix cleared
  b.blob('roundLigament', 0.2, 0.9, 0.42, 0.33, 0.3, 0.07, -0.05, 0.5)
  b.blob('roundLigament', 0.2, 0.9, A - 0.42, 0.33, 0.3, 0.07, 0.05, 0.5)
  b.blob('bladderFlap', 0.2, 0.9, A / 2, 0.88, 0.42, 0.075, 0, 0.5)
  b.blob('uterineVessels', 0.2, 0.9, 0.72, 0.72, 0.15, 0.09, 0.6, 0.55)
  b.blob('uterineVessels', 0.2, 0.9, A - 0.72, 0.72, 0.15, 0.09, -0.6, 0.55)
  // the line round the cervix, going round as the cut does (it goes when the uterus is out: it is the edge of the vagina then)
  b.mark('colpotomy', 0.1, 0.95, A / 2, 0.76, 0.2, 0.045, 'delivery')
  // the uterus leaves downward, and the top of the vagina is closed with a running stitch
  b.patch('delivery', 0.15, 0.95, 2)
  b.suture('cuffClosure', 0.05, 0.95, [A / 2 - 0.21, 0.796, A / 2 - 0.1, 0.806, A / 2, 0.809, A / 2 + 0.1, 0.806, A / 2 + 0.21, 0.796], 11)
  return b.done()
}

// ---- prostatectomy ---------------------------------------------------------------------------

function prost(): StageSet {
  const b = build([
    stage('survey', A / 2, 0.5, 1),
    stage('retzius', A / 2, 0.4, 1.3),
    stage('endopelvic', A / 2, 0.62, 1.5),
    stage('dorsalVein', A / 2, 0.8, 1.9),
    stage('bladderNeck', A / 2, 0.52, 1.9),
    stage('seminalVesicles', A / 2, 0.44, 1.7),
    stage('posteriorPlane', A / 2, 0.7, 1.5),
    stage('pedicles', A / 2, 0.66, 1.6),
    stage('apex', A / 2, 0.82, 1.8),
    stage('bagging', A / 2, 0.68, 1.35),
    stage('posteriorRepair', A / 2, 0.62, 1.9),
    stage('anastomosis', A / 2, 0.64, 2.0),
    stage('leakTest', A / 2, 0.64, 1.6),
    stage('finalCheck', A / 2, 0.55, 1.15),
  ])
  const x = A / 2
  // the space behind the pubic bone opened, the fat and fascia cleared off the prostate, the bladder neck opened, the sperm ducts and vesicles freed
  b.blob('retzius', 0.2, 0.9, x, 0.33, 0.56, 0.12, 0, 0.45)
  b.blob('endopelvic', 0.2, 0.9, x, 0.62, 0.28, 0.1, 0, 0.5)
  b.blob('endopelvic', 0.2, 0.9, x - 0.31, 0.7, 0.12, 0.17, 0.3, 0.45)
  b.blob('endopelvic', 0.2, 0.9, x + 0.31, 0.7, 0.12, 0.17, -0.3, 0.45)
  b.blob('bladderNeck', 0.2, 0.9, x, 0.5, 0.27, 0.065, 0, 0.5)
  b.blob('seminalVesicles', 0.2, 0.9, x, 0.4, 0.31, 0.065, 0, 0.45)
  b.blob('posteriorPlane', 0.2, 0.9, x, 0.74, 0.3, 0.08, 0, 0.4)
  // the stitch round the vein bundle (the bundle is divided on it at the apex; it goes once the prostate is bagged)
  b.suture('dorsalVein', 0.1, 0.9, [x - 0.07, 0.8, x - 0.03, 0.87, x + 0.03, 0.87, x + 0.07, 0.8], 4, 'bagging')
  // three purple clips on each side support, one after the other, left then right
  const sides = [-1, 1]
  const at = [0.6, 0.655, 0.71]
  sides.forEach((side, s) => {
    at.forEach((y, j) => b.clip('pedicles', 0.05 + s * 0.45 + j * 0.15, 0.15 + s * 0.45 + j * 0.15, x + side * (0.28 + j * 0.01), y, 0.1 * side, 0.068, 1))
  })
  // the prostate comes free and goes into its bag, which is parked once the repair begins
  b.patch('apex', 0.25, 1, 3)
  b.bag('bagging', 0, 0.7, x, 0.68, 0.64, 0.48, 0, 1, 'posteriorRepair')
  // the bladder's back wall rebuilt, then the join: two running stitches up either side from six o'clock
  b.suture('posteriorRepair', 0.1, 0.95, [x - 0.15, 0.63, x - 0.05, 0.64, x + 0.05, 0.64, x + 0.15, 0.63], 5)
  b.suture('anastomosis', 0.05, 0.95, [x - 0.005, 0.8, x - 0.07, 0.775, x - 0.12, 0.71, x - 0.14, 0.64, x - 0.12, 0.575], 7)
  b.suture('anastomosis', 0.05, 0.95, [x + 0.005, 0.8, x + 0.07, 0.775, x + 0.12, 0.71, x + 0.14, 0.64, x + 0.12, 0.575], 7)
  return b.done()
}

/** The stage sets by procedure (0 cholecystectomy, 1 hysterectomy, 2 prostatectomy). */
export const STAGE_SETS: readonly StageSet[] = [chole(), hyst(), prost()]

/** The keys of a procedure's stages, in order. */
export function stageKeys(proc: number): string[] {
  return STAGE_SETS[proc]?.stages.map((s) => s.key) ?? []
}

/** The procedure (0, 1, 2) of a script id, or -1. A switch: no allocation. */
export function procOfId(id: ProcedureId | null): number {
  switch (id) {
    case 'or-cholecystectomy':
      return 0
    case 'or-hysterectomy':
      return 1
    case 'or-prostatectomy':
      return 2
    default:
      return -1
  }
}

/** The stage of procedure `proc` that scope key `key` names, or -1 (no key, or one this procedure's pictures do not know: today's picture). */
export function stageIndex(proc: number, key: string | null): number {
  if (key === null) return -1
  const set = STAGE_SETS[proc]
  if (set === undefined) return -1
  return set.index.get(key) ?? -1
}

// ---------------------------------------------------------------------------------------------
// The camera and the light of a stage
// ---------------------------------------------------------------------------------------------

/** Where a stage points the camera. */
export interface StageCam {
  cx: number
  cy: number
  zoom: number
}

/** The camera of a stage (the picture at rest for -1 or a stage that does not exist). Writes into `out`. */
export function stageCamInto(proc: number, st: number, out: StageCam): StageCam {
  const set = STAGE_SETS[proc]
  const s = set === undefined || st < 0 ? undefined : set.stages[st]
  if (s === undefined) {
    out.cx = A / 2
    out.cy = 0.5
    out.zoom = 1
  } else {
    out.cx = s.cx
    out.cy = s.cy
    out.zoom = s.zoom
  }
  return out
}

/** The near-infrared view of a stage: 0..1. */
export function stageGlow(proc: number, st: number): number {
  const set = STAGE_SETS[proc]
  const s = set === undefined || st < 0 ? undefined : set.stages[st]
  return s === undefined ? 0 : s.glow
}

/** How long the camera takes to settle on a new stage (sim seconds). */
export const STAGE_EASE = 2.4

/** The near-infrared view of the picture now: the stage's, eased from the stage before it (0..1). */
export function glowOf(v: Readonly<EndoView>): number {
  const a = stageGlow(v.proc, v.prevStage)
  const b = stageGlow(v.proc, v.stage)
  return a + (b - a) * v.stageMix
}

// ---------------------------------------------------------------------------------------------
// Drawing (per frame: nothing allocates)
// ---------------------------------------------------------------------------------------------

/** How far a feature has come in (0..1): not at all before its stage, over its window of the stage's progress, all the way after. */
export function progressOf(t: Timing, v: Readonly<EndoView>): number {
  const s = v.stage
  if (s < t.at) return 0
  return s === t.at ? smooth(t.p0, t.p1, v.stageP) : 1
}

/** How much of a feature is still there (0..1): all of it, until the stage it goes in begins; then fading as the camera moves, and gone after. */
export function fadeOf(t: Timing, v: Readonly<EndoView>): number {
  if (t.gone < 0 || v.stage < t.gone) return 1
  return v.stage > t.gone ? 0 : 1 - v.stageMix
}

/** How much of a feature shows now (0..1): it comes in over its window of the stage it begins in, stays, and leaves as its `gone` stage begins. */
export function appear(t: Timing, v: Readonly<EndoView>): number {
  return progressOf(t, v) * fadeOf(t, v)
}

export const STAGE_COLOURS = {
  /** The clips: steel and violet polymer, each with its light and dark edge. */
  clip: [
    { body: '#aeb6bf', light: '#eef2f6', dark: '#59616a' },
    { body: '#7a55cf', light: '#c4b0f4', dark: '#3b2a78' },
  ],
  clipShadow: '#201a1a',
  /** The running stitch: dyed violet. */
  suture: '#6c5fb4',
  sutureLight: '#c3baf0',
  /** The line round the cervix. */
  mark: '#f7e5d6',
  markEdge: '#9a6a5e',
  /** The near-infrared view: tissue goes dark green-black. */
  dark: '#05120b',
} as const

const CLIP_COLOURS = STAGE_COLOURS.clip

/** Draw `rect` of the decal atlas centred at (x, y) pixels, `w` x `h` pixels, turned by `rot`, at opacity `a`. */
function stamp(c: Ctx2D, atlas: CanvasImageSource, rect: { x: number; y: number; w: number; h: number }, x: number, y: number, w: number, h: number, rot: number, a: number): void {
  const cs = Math.cos(rot)
  const sn = Math.sin(rot)
  c.setTransform(cs, sn, -sn, cs, x, y)
  c.globalAlpha = a
  c.drawImage(atlas, rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, -w / 2, -h / 2, w, h)
}

function drawPatch(c: Ctx2D, w: number, h: number, img: EndoPatchImage, win: PlateWindow, k: number, a: number): void {
  const m = img.patch
  const dw = (img.w / PLATE_H) * k
  const dh = (img.h / PLATE_H) * k
  const dx = (m.x0 - win.x0) * k
  const dy = (m.y0 - win.y0) * k
  if (dx > w || dy > h || dx + dw < 0 || dy + dh < 0) return
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalCompositeOperation = 'source-over'
  c.globalAlpha = a
  c.drawImage(img.plate.canvas, 0, 0, img.w, img.h, dx, dy, dw, dh)
  // its wet highlights, through the window that leads the camera a little (as the plate's)
  c.globalCompositeOperation = 'lighter'
  c.globalAlpha = 0.85 * a
  c.drawImage(img.spec.canvas, 0, 0, img.w, img.h, (m.x0 - win.lx0) * k, (m.y0 - win.ly0) * k, dw, dh)
  c.globalCompositeOperation = 'source-over'
  c.globalAlpha = 1
}

function drawClip(c: Ctx2D, k: number, px: number, py: number, f: Clip, a: number): void {
  const cs = Math.cos(f.ang) * k
  const sn = Math.sin(f.ang) * k
  const col = CLIP_COLOURS[f.kind]
  const L = f.len
  const T = 0.017
  c.setTransform(cs, sn, -sn, cs, px, py)
  // its shadow, down and to the right of it
  c.globalAlpha = a * 0.4
  c.fillStyle = STAGE_COLOURS.clipShadow
  c.fillRect(-L / 2 + 0.007, -T / 2 + 0.011, L, T)
  c.globalAlpha = a
  c.fillStyle = col.body
  c.fillRect(-L / 2, -T / 2, L, T)
  // the light along its top edge, the hinge at one end and the locking tab (polymer) at the other
  c.fillStyle = col.light
  c.fillRect(-L / 2 + 0.004, -T / 2 + 0.002, L - 0.008, T * 0.28)
  c.fillStyle = col.dark
  c.fillRect(-L / 2, -T / 2, T * 0.7, T)
  if (f.kind === 1) c.fillRect(L / 2 - T * 0.5, -T / 2 - 0.004, T * 0.5, T + 0.008)
}

function drawSuture(c: Ctx2D, k: number, win: PlateWindow, s: Suture, a: number, fade: number): void {
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = fade
  c.lineCap = 'round'
  c.lineJoin = 'round'
  // the running line, as far as the step has got
  const reach = s.total * a
  let run = 0
  c.beginPath()
  for (let i = 0; i < s.seg.length; i++) {
    if (run >= reach) break
    const x0 = s.pts[i * 2]
    const y0 = s.pts[i * 2 + 1]
    const f = s.seg[i] > 0 ? Math.min(1, (reach - run) / s.seg[i]) : 1
    if (i === 0) c.moveTo((x0 - win.x0) * k, (y0 - win.y0) * k)
    c.lineTo((x0 + (s.pts[i * 2 + 2] - x0) * f - win.x0) * k, (y0 + (s.pts[i * 2 + 3] - y0) * f - win.y0) * k)
    run += s.seg[i]
  }
  c.strokeStyle = STAGE_COLOURS.suture
  c.lineWidth = Math.max(1.4, 0.011 * k)
  c.stroke()
  c.strokeStyle = STAGE_COLOURS.sutureLight
  c.lineWidth = Math.max(0.7, 0.004 * k)
  c.stroke()
  // the stitches: short strokes across the line, one more as each is reached
  c.beginPath()
  const half = 0.02
  for (let j = 0; j < s.n; j++) {
    if ((j + 0.5) / s.n > a) break
    const sx = (s.st[j * 4] - win.x0) * k
    const sy = (s.st[j * 4 + 1] - win.y0) * k
    c.moveTo(sx - s.st[j * 4 + 2] * half * k, sy - s.st[j * 4 + 3] * half * k)
    c.lineTo(sx + s.st[j * 4 + 2] * half * k, sy + s.st[j * 4 + 3] * half * k)
  }
  c.strokeStyle = STAGE_COLOURS.suture
  c.lineWidth = Math.max(1.1, 0.0065 * k)
  c.stroke()
}

function drawMark(c: Ctx2D, k: number, win: PlateWindow, m: Mark, a: number, fade: number): void {
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = fade
  c.lineCap = 'round'
  c.beginPath()
  c.ellipse((m.x - win.x0) * k, (m.y - win.y0) * k, m.rx * k, m.ry * k, 0, -Math.PI / 2, -Math.PI / 2 + a * 2 * Math.PI)
  c.strokeStyle = STAGE_COLOURS.markEdge
  c.lineWidth = Math.max(1.6, 0.013 * k)
  c.stroke()
  c.strokeStyle = STAGE_COLOURS.mark
  c.lineWidth = Math.max(0.9, 0.0055 * k)
  c.stroke()
}

/**
 * What the stage lays over the tissue: patches, cleared patches, the line round the cervix, running stitches, clips and the bag (in that order, each over
 * the one before), through the picture's window on the plate (`win`, frame.ts). Nothing for a view without a stage.
 */
export function drawStage(c: Ctx2D, w: number, h: number, v: Readonly<EndoView>, win: PlateWindow): void {
  if (v.stage < 0) return
  const set = STAGE_SETS[v.proc]
  if (set === undefined) return
  const k = w / win.w
  const ps = set.patches
  for (let i = 0; i < ps.length; i++) {
    const a = appear(ps[i], v)
    const img = endoPlates.patches[ps[i].id]
    if (a > 0.004 && img) drawPatch(c, w, h, img, win, k, a)
  }
  const atlas = endoDecals.atlas
  const bl = set.blobs
  if (atlas) {
    for (let i = 0; i < bl.length; i++) {
      const a = appear(bl[i], v) * bl[i].a
      if (a > 0.004) stamp(c, atlas.canvas, DECAL.blob, (bl[i].x - win.x0) * k, (bl[i].y - win.y0) * k, bl[i].rx * 2.4 * k, bl[i].ry * 2.4 * k, bl[i].rot, a)
    }
  }
  const mk = set.marks
  for (let i = 0; i < mk.length; i++) {
    const a = progressOf(mk[i], v)
    const fade = fadeOf(mk[i], v)
    if (a > 0.01 && fade > 0.01) drawMark(c, k, win, mk[i], a, fade)
  }
  const su = set.sutures
  for (let i = 0; i < su.length; i++) {
    const a = progressOf(su[i], v)
    const fade = fadeOf(su[i], v)
    if (a > 0.01 && fade > 0.01) drawSuture(c, k, win, su[i], a, fade)
  }
  const cl = set.clips
  for (let i = 0; i < cl.length; i++) {
    const a = appear(cl[i], v)
    if (a > 0.01) drawClip(c, k, (cl[i].x - win.x0) * k, (cl[i].y - win.y0) * k, cl[i], a)
  }
  const bg = set.bags
  if (atlas) {
    for (let i = 0; i < bg.length; i++) {
      const a = appear(bg[i], v)
      if (a > 0.01) {
        const grow = 0.85 + 0.15 * a
        stamp(c, atlas.canvas, bg[i].kind === 0 ? DECAL.bagGallbladder : DECAL.bagProstate, (bg[i].x - win.x0) * k, (bg[i].y - win.y0) * k, bg[i].w * k * grow, bg[i].h * k * grow, bg[i].rot, a)
      }
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
}

/**
 * The near-infrared view (Firefly): the picture goes dark and the dye's ducts glow green, added to what is there. Drawn after the instruments, so they go
 * dark with the rest. Nothing while the stage has no glow.
 */
export function drawGlow(c: Ctx2D, w: number, h: number, v: Readonly<EndoView>, win: PlateWindow): void {
  const g = glowOf(v)
  if (g < 0.01 || v.stage < 0) return
  const set = STAGE_SETS[v.proc]
  const atlas = endoDecals.atlas
  if (set === undefined) return
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalCompositeOperation = 'source-over'
  c.globalAlpha = 0.8 * g
  c.fillStyle = STAGE_COLOURS.dark
  c.fillRect(0, 0, w, h)
  if (atlas) {
    const k = w / win.w
    const s = set.glow
    c.globalCompositeOperation = 'lighter'
    for (let i = 0; i + 3 < s.length; i += 4) {
      const r = s[i + 2] * k * 2
      stamp(c, atlas.canvas, DECAL.glow, (s[i] - win.x0) * k, (s[i + 1] - win.y0) * k, r, r, 0, s[i + 3] * g)
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
}
