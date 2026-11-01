/**
 * R4: the cryoablation suite's pictures, pure (a `Ctx2D`, so they run against the recording mock in node and a real canvas in the browser). Each draws a
 * whole view into a logical `w` x `h` box at the origin of the context's current transform:
 *
 *   paintPlanning      the planning CT: the base slice, the tumour, and the planned paths dashed and numbered (the one being worked on in amber)
 *   paintLive          the live CT: the needles bright with their metal streaks, the ice ball (low density, dark grey) growing with `ice`, and the
 *                      scanner's sweep while a scan runs
 *   paintConsole       the argon console: each needle's temperature, argon and heater, the freeze timer and the margin sensor
 *   paintRobotStation  the robot's planning station: the path list, the needle being aimed and "Aligned 1.2 mm"
 *
 * Every view says "Simulated". The base slice is painted once per seed and target into a square surface (`baseSliceFor`) and only blitted after that.
 * The kidney's (the synthetic abdomen of `imageSeed` at the kidneys, images/torso.ts) has anterior at the top and the patient's right on the image's
 * left; a needle's path (mm from the tumour centre, +x the patient's left, +y posterior) is drawn at the tumour, which sits in the left kidney.
 * R5 wave 3: the lung's and the liver's patients lie face down, so their pictures (ctSlices.ts) are turned half a turn, the way a scanner shows a prone
 * patient: the BACK at the top, the patient's right on the picture's right, the table pad at the bottom. A path's mm are then the picture's own axes
 * (+x right, +y down: its skin entry is up and to the right, through the back from the robot's side) and the tumour sits where `CRYO_SLICES` says.
 */
import { CRYO_SUITE_COPY, cryoStepLabel, fillCryo } from '@/content/cryoSuite'
import type { Ctx2D, Env, Surface } from '@/scene/imaging/images/ctx'
import { ctLook } from '@/scene/imaging/images/looks'
import { drawShapes } from '@/scene/imaging/images/paint'
import { CT_WINDOWS } from '@/scene/imaging/images/tones'
import { abdomenAxial } from '@/scene/imaging/images/torso'
import type { CryoSuiteState, CryoTarget } from '@/sim/types'
import { CHEST_WINDOW, CRYO_SLICES, proneSliceModel, PRONE_FLIP } from './ctSlices'

/**
 * The picture's geometry: mm per unit of the slice's -1..1 square, the tumour's centre (the left kidney's lateral lip), the slice through the kidneys.
 * `size` is the base slice's resolution: 768 so the live view, magnified LIVE_ZOOM times, stays sharp.
 */
export const CRYO_IMAGE = { mmPerUnit: 180, tumour: { x: 0.52, y: 0.16 }, kidneyZ: 0.42, size: 768 } as const

/** The palette of the screens. */
export const INK = {
  bg: '#05080a',
  panel: '#0d1418',
  text: '#d9e4e8',
  dim: '#7f9299',
  teal: '#3fd0c0',
  amber: '#f0a33a',
  green: '#45d68a',
  red: '#ff6b5a',
  ice: 'rgb(36,40,44)',
  iceEdge: 'rgba(200,225,238,0.9)',
  needle: '#ffffff',
  tumour: 'rgba(120,120,120,0.55)',
  // R5 wave 3 (the lung's and the liver's pictures: no red anywhere): a soft-tissue lump in the black lung is bright; in the liver it is darker than the
  // liver around it; the outline is pale; the ice in the lung is a grey haze (ground glass) rather than the dark of the kidney's and the liver's
  tumourLung: 'rgba(214,214,214,0.92)',
  tumourLiver: 'rgba(86,86,86,0.72)',
  edge: '#e9f0f2',
  iceLung: 'rgba(132,142,150,0.55)',
} as const

/** How a target's picture draws the tumour, its outline and the ice (the kidney's are the original ones). */
interface PictureInk {
  tumour: string
  edge: string
  ice: string
}
const PICTURE_INK: Readonly<Record<CryoTarget, PictureInk>> = {
  kidney: { tumour: INK.tumour, edge: INK.red, ice: INK.ice },
  lung: { tumour: INK.tumourLung, edge: INK.edge, ice: INK.iceLung },
  liver: { tumour: INK.tumourLiver, edge: INK.edge, ice: INK.ice },
}
/** The target's picture ink (an unknown target falls back to the kidney's). */
const inkOf = (s: CryoSuiteState): PictureInk => PICTURE_INK[s.target] ?? PICTURE_INK.kidney

/** Steps that run the CT (the sweep shows). */
const SCAN_STEPS: ReadonlySet<string> = new Set(['planningCt', 'checkCt', 'finalCt'])
// (R5 wave 3: the lung's short first freeze and its thaw are a freeze and a thaw)
const FREEZE_STEPS: ReadonlySet<string> = new Set(['anchorFreeze', 'freeze1', 'freeze2'])
const THAW_STEPS: ReadonlySet<string> = new Set(['anchorThaw', 'thaw', 'activeThaw'])

// ---------------------------------------------------------------------------------------------
// The base slice
// ---------------------------------------------------------------------------------------------

export interface BaseSliceCache {
  seed: number
  /** R5 wave 3: the target the surface shows (the kidney's slice until a lung or a liver case asks for its own). */
  target: CryoTarget
  surface: Surface | null
  /** How many times a slice was painted (tests: once per seed). */
  paints: number
}

export const newBaseSliceCache = (): BaseSliceCache => ({ seed: Number.NaN, target: 'kidney', surface: null, paints: 0 })

/**
 * The base slice of `seed` for `target` (painted on the first call for a seed and target, blitted after). The kidney's is the abdomen at the kidneys, as
 * it always was; the lung's and the liver's are the prone slices of ctSlices.ts (turned half a turn: back at the top).
 */
export function baseSliceFor(cache: BaseSliceCache, env: Env, seed: number, target: CryoTarget = 'kidney'): Surface {
  const n = CRYO_IMAGE.size
  if (!cache.surface) cache.surface = env.createSurface(n, n)
  if (cache.seed !== seed || cache.target !== target) {
    const c = cache.surface.ctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = '#000000'
    c.fillRect(0, 0, n, n)
    if (target === 'lung' || target === 'liver') {
      // the supine slice turned half a turn about the square's centre: the table at the bottom, the back at the top
      c.setTransform((PRONE_FLIP * n) / 2, 0, 0, (PRONE_FLIP * n) / 2, n / 2, n / 2)
      drawShapes(c, proneSliceModel(target, seed), ctLook('portal', target === 'lung' ? CHEST_WINDOW : CT_WINDOWS.abdomen))
    } else {
      c.setTransform(n / 2, 0, 0, n / 2, n / 2, n / 2)
      drawShapes(c, abdomenAxial(seed, CRYO_IMAGE.kidneyZ), ctLook('portal', CT_WINDOWS.abdomen))
    }
    c.setTransform(1, 0, 0, 1, 0, 0)
    cache.seed = seed
    cache.target = target
    cache.paints++
  }
  return cache.surface
}

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

/** Where the square image sits in a w x h view: on the left with a text column beside it when there is room, else filling the square. */
export interface ImageBox {
  x: number
  y: number
  size: number
  /** The text column (x, width); width 0 when the text overlays the image. */
  colX: number
  colW: number
  /** R5 wave 3: where the tumour's centre is in the slice's -1..1 square (the kidney's, `CRYO_IMAGE.tumour`, when absent). */
  tumour?: { x: number; y: number }
}

export function imageBox(w: number, h: number, out: ImageBox): ImageBox {
  const size = Math.min(w, h)
  out.size = size
  out.y = (h - size) / 2
  if (w - size >= 100) {
    out.x = 0
    out.colX = size + 8
    out.colW = w - size - 12
  } else {
    out.x = (w - size) / 2
    out.colX = out.x + 8
    out.colW = 0
  }
  return out
}

/** Slice units (-1..1) to view pixels. */
const px = (b: ImageBox, u: number): number => b.x + b.size / 2 + (u * b.size) / 2
const py = (b: ImageBox, v: number): number => b.y + b.size / 2 + (v * b.size) / 2
/** A needle-path point (mm from the tumour centre) to view pixels. */
const mmX = (b: ImageBox, mm: number): number => px(b, (b.tumour ?? CRYO_IMAGE.tumour).x + mm / CRYO_IMAGE.mmPerUnit)
const mmY = (b: ImageBox, mm: number): number => py(b, (b.tumour ?? CRYO_IMAGE.tumour).y + mm / CRYO_IMAGE.mmPerUnit)
const mmLen = (b: ImageBox, mm: number): number => ((mm / CRYO_IMAGE.mmPerUnit) * b.size) / 2

function clear(c: Ctx2D, w: number, h: number): void {
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  c.setLineDash([])
  c.fillStyle = INK.bg
  c.fillRect(0, 0, w, h)
}

function text(c: Ctx2D, s: string, x: number, y: number, size: number, color: string, weight = 500, align: CanvasTextAlign = 'left'): void {
  c.font = `${weight} ${size}px system-ui, sans-serif`
  c.fillStyle = color
  c.textAlign = align
  c.textBaseline = 'alphabetic'
  c.fillText(s, x, y)
}

/** The "Simulated" tag, top right of the view. */
export function simulatedTag(c: Ctx2D, w: number, size = 11): void {
  const label = CRYO_SUITE_COPY.panel.tag
  c.font = `600 ${size}px system-ui, sans-serif`
  const tw = c.measureText(label).width + 10
  c.globalAlpha = 0.85
  c.fillStyle = INK.panel
  c.fillRect(w - tw - 6, 5, tw, size + 7)
  c.globalAlpha = 1
  text(c, label, w - 11, 5 + size + 2, size, INK.amber, 600, 'right')
}

function drawBase(c: Ctx2D, b: ImageBox, base: Surface): void {
  c.imageSmoothingEnabled = true
  c.drawImage(base.canvas, b.x, b.y, b.size, b.size)
}

function drawTumour(c: Ctx2D, b: ImageBox, s: CryoSuiteState, outline: boolean): void {
  const r = mmLen(b, Math.max(8, s.tumourMm) / 2)
  const ink = inkOf(s)
  c.fillStyle = ink.tumour
  c.beginPath()
  c.ellipse(mmX(b, 0), mmY(b, 0), r, r * 0.9, 0.3, 0, Math.PI * 2)
  c.fill()
  if (outline) {
    c.strokeStyle = ink.edge
    c.lineWidth = 1.2
    c.setLineDash([3, 2])
    c.stroke()
    c.setLineDash([])
  }
}

/** The needle being worked on (aim, needlesOut), or -1. */
export function currentNeedle(s: CryoSuiteState): number {
  if (s.needle >= 0) return s.needle
  if (s.robot.needle >= 0 && s.robot.phase !== 'stowed') return s.robot.needle
  return -1
}

/** "mm:ss". */
export function clockOf(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds))
  const m = Math.floor(t / 60)
  const sec = t % 60
  return `${m}:${sec < 10 ? '0' : ''}${sec}`
}

const _box: ImageBox = { x: 0, y: 0, size: 0, colX: 0, colW: 0 }

/** The picture's box for the state's target: `imageBox`, with the tumour where that target's slice has it. */
function boxFor(w: number, h: number, s: CryoSuiteState, out: ImageBox): ImageBox {
  imageBox(w, h, out)
  out.tumour = (CRYO_SLICES[s.target] ?? CRYO_SLICES.kidney).tumour
  return out
}

/** The patient's-right marker of a prone picture (the slice is turned, so the side is named: R on the picture's right edge). */
function sideMarker(c: Ctx2D, b: ImageBox, s: CryoSuiteState): void {
  if (!(CRYO_SLICES[s.target] ?? CRYO_SLICES.kidney).prone) return
  text(c, 'R', b.x + b.size - 8, b.y + b.size / 2 + 4, 12, INK.dim, 700, 'right')
}

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

export function paintPlanning(c: Ctx2D, w: number, h: number, s: CryoSuiteState, base: Surface): void {
  clear(c, w, h)
  const b = boxFor(w, h, s, _box)
  drawBase(c, b, base)
  sideMarker(c, b, s)
  drawTumour(c, b, s, true)
  const cur = currentNeedle(s)
  c.lineWidth = Math.max(1.2, b.size / 200)
  for (const n of s.needles) {
    const x0 = mmX(b, n.entry.x)
    const y0 = mmY(b, n.entry.y)
    const x1 = mmX(b, n.tip.x)
    const y1 = mmY(b, n.tip.y)
    // the path runs on past the entry, out to where the guide stands
    const dx = x0 - x1
    const dy = y0 - y1
    const len = Math.hypot(dx, dy) || 1
    const ext = b.size * 0.12
    c.strokeStyle = n.index === cur ? INK.amber : INK.teal
    c.setLineDash([5, 4])
    c.beginPath()
    c.moveTo(x1, y1)
    c.lineTo(x0 + (dx / len) * ext, y0 + (dy / len) * ext)
    c.stroke()
    c.setLineDash([])
    c.fillStyle = n.index === cur ? INK.amber : INK.teal
    c.beginPath()
    c.arc(x1, y1, 2.2, 0, Math.PI * 2)
    c.fill()
    text(c, String(n.index + 1), x0 + (dx / len) * (ext + 8), y0 + (dy / len) * (ext + 8) + 4, Math.max(10, b.size / 22), n.index === cur ? INK.amber : INK.teal, 700, 'center')
  }
  const p = CRYO_SUITE_COPY.panel
  const tx = b.colW > 0 ? b.colX : b.x + 8
  text(c, p.planning, tx, b.y + 18, 14, INK.text, 650)
  if (cur >= 0) text(c, fillCryo(p.needle, { k: cur + 1, n: s.needles.length }), tx, b.y + 36, 12, INK.amber, 600)
  if (b.colW > 0) {
    let y = b.y + 60
    for (const n of s.needles) {
      const done = n.inserted > 0.999
      text(c, `${n.index + 1}  ${done ? '✓' : '•'}`, tx, y, 12, n.index === cur ? INK.amber : done ? INK.green : INK.dim, 600)
      y += 17
    }
  }
  text(c, cryoStepLabel(s.step, s.target), tx, h - 10, 11, INK.dim, 500)
  simulatedTag(c, w)
}

// ---------------------------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------------------------

/** The ice ball's radius around one needle's tip (mm): grows with `ice`, from the console's size when the sim gives one. */
export function iceRadiusMm(s: CryoSuiteState): number {
  const full = s.iceMm.short > 0 && s.ice > 0 ? s.iceMm.short / 2 / Math.max(0.05, s.ice) : 20
  return Math.max(0, s.ice) * Math.min(28, Math.max(12, full)) * (s.needles.length > 1 ? 0.62 : 1)
}

/**
 * The live view is magnified round the tumour, as an interventional console shows it: the whole abdomen is about 36 cm across, so at full
 * view a 3-5 cm ice ball would be a speck. `zoomBox` maps the slice so the tumour sits at the picture's centre, LIVE_ZOOM times larger.
 */
export const LIVE_ZOOM = 2.4

export function zoomBox(b: ImageBox, zoom: number, out: ImageBox): ImageBox {
  const t = b.tumour ?? CRYO_IMAGE.tumour
  out.size = b.size * zoom
  out.x = b.x + b.size / 2 - out.size / 2 - (t.x * out.size) / 2
  out.y = b.y + b.size / 2 - out.size / 2 - (t.y * out.size) / 2
  out.colX = b.colX
  out.colW = b.colW
  out.tumour = b.tumour
  return out
}

const _zoom: ImageBox = { x: 0, y: 0, size: 0, colX: 0, colW: 0 }

export function paintLive(c: Ctx2D, w: number, h: number, s: CryoSuiteState, base: Surface): void {
  clear(c, w, h)
  const b = boxFor(w, h, s, _box)
  const z = zoomBox(b, LIVE_ZOOM, _zoom)
  const ink = inkOf(s)
  c.save()
  c.beginPath()
  c.rect(b.x, b.y, b.size, b.size)
  c.clip()
  drawBase(c, z, base)
  drawTumour(c, z, s, false)
  // the ice: the needles' balls merge into one oval (a real multi-probe ice ball), centred on the tips, its long axis along the row of tips
  // (along the needle for a single one), sized by the console's measurement while it has one; the rim drawn first so only its edge shows
  let count = 0
  let cx = 0
  let cy = 0
  let fx = 0
  let fy = 0
  let lx = 0
  let ly = 0
  let ax = 0
  for (const n of s.needles) {
    if (n.inserted < 0.999) continue
    const tx = mmX(z, n.tip.x)
    const ty = mmY(z, n.tip.y)
    if (count === 0) {
      fx = tx
      fy = ty
      ax = Math.atan2(ty - mmY(z, n.entry.y), tx - mmX(z, n.entry.x))
    }
    lx = tx
    ly = ty
    cx += tx
    cy += ty
    count++
  }
  const ice = s.ice > 0 ? s.ice : 0
  if (count > 0 && ice > 0.005) {
    const fallback = iceRadiusMm(s)
    const rx = mmLen(z, s.iceMm.long > 0 ? s.iceMm.long / 2 : fallback * 1.25)
    const ry = mmLen(z, s.iceMm.short > 0 ? s.iceMm.short / 2 : fallback)
    const spread = Math.hypot(lx - fx, ly - fy)
    const angle = count > 1 && spread > 1 ? Math.atan2(ly - fy, lx - fx) : ax
    for (let pass = 0; pass < 2; pass++) {
      c.beginPath()
      c.ellipse(cx / count, cy / count, rx, ry, angle, 0, Math.PI * 2)
      if (pass === 0) {
        c.strokeStyle = INK.iceEdge
        c.lineWidth = Math.max(2.4, b.size / 110)
        c.stroke()
      } else {
        c.fillStyle = ink.ice
        c.fill()
      }
    }
  }
  // the needles: bright metal from the entry to where the tip is now, with streaks fanning from the tip
  for (const n of s.needles) {
    if (n.inserted <= 0.001) continue
    const x0 = mmX(z, n.entry.x)
    const y0 = mmY(z, n.entry.y)
    const k = n.inserted > 1 ? 1 : n.inserted
    const x1 = x0 + (mmX(z, n.tip.x) - x0) * k
    const y1 = y0 + (mmY(z, n.tip.y) - y0) * k
    const a = Math.atan2(y1 - y0, x1 - x0)
    c.strokeStyle = INK.needle
    c.globalAlpha = 0.16
    c.lineWidth = 1
    for (let i = -1; i <= 1; i++) {
      const sa = a + Math.PI / 2 + i * 0.45
      const l = b.size * 0.16
      c.beginPath()
      c.moveTo(x1 - Math.cos(sa) * l, y1 - Math.sin(sa) * l)
      c.lineTo(x1 + Math.cos(sa) * l, y1 + Math.sin(sa) * l)
      c.stroke()
    }
    c.globalAlpha = 1
    c.lineWidth = Math.max(1.6, b.size / 140)
    c.beginPath()
    c.moveTo(x0 - Math.cos(a) * b.size * 0.06, y0 - Math.sin(a) * b.size * 0.06)
    c.lineTo(x1, y1)
    c.stroke()
    c.fillStyle = INK.needle
    c.beginPath()
    c.arc(x1, y1, Math.max(1.8, b.size / 150), 0, Math.PI * 2)
    c.fill()
  }
  c.restore()
  sideMarker(c, b, s)
  // the sweep: the part of the slice not yet reconstructed is dark, a teal line at the front
  if (SCAN_STEPS.has(s.step) && s.scan > 0 && s.scan < 1) {
    const y = b.y + b.size * s.scan
    c.fillStyle = 'rgba(0,0,0,0.62)'
    c.fillRect(b.x, y, b.size, b.y + b.size - y)
    c.fillStyle = INK.teal
    c.fillRect(b.x, y - 1, b.size, 2)
  }
  const p = CRYO_SUITE_COPY.panel
  const tx = b.colW > 0 ? b.colX : b.x + 8
  text(c, p.live, tx, b.y + 18, 14, INK.text, 650)
  text(c, cryoStepLabel(s.step, s.target), tx, b.y + 36, 11, INK.dim, 500)
  if (s.ice > 0.005) {
    const iceLine = `${p.ice} ${s.iceMm.long} × ${s.iceMm.short} mm`
    if (b.colW > 0) text(c, iceLine, tx, b.y + 58, 11, INK.teal, 600)
    else text(c, iceLine, tx, b.y + b.size - 12, 12, INK.teal, 600)
  }
  simulatedTag(c, w)
}

// ---------------------------------------------------------------------------------------------
// The argon console
// ---------------------------------------------------------------------------------------------

export function paintConsole(c: Ctx2D, w: number, h: number, s: CryoSuiteState): void {
  clear(c, w, h)
  const p = CRYO_SUITE_COPY.panel
  const freezing = FREEZE_STEPS.has(s.step)
  const thawing = THAW_STEPS.has(s.step)
  text(c, cryoStepLabel(s.step, s.target), 10, 20, 13, freezing ? INK.teal : thawing ? INK.amber : INK.text, 650)
  // argon and heater lamps
  const lamp = (label: string, on: boolean, x: number, color: string): void => {
    c.fillStyle = on ? color : '#26323a'
    c.beginPath()
    c.arc(x, 36, 4.5, 0, Math.PI * 2)
    c.fill()
    text(c, label, x + 9, 40, 11, on ? INK.text : INK.dim, 600)
  }
  lamp(p.argon, s.argon, 14, INK.teal)
  lamp(p.heater, s.heater, 86, INK.amber)
  // the needles' tip temperatures, as numbers and bars (37 C down to -150 C)
  const rows = Math.max(1, s.needles.length)
  const top = 54
  const rowH = Math.min(26, (h - top - 50) / rows)
  const barW = w * 0.42
  for (const n of s.needles) {
    const y = top + n.index * rowH
    text(c, `${p.tip} ${n.index + 1}`, 10, y + rowH * 0.7, 11, INK.dim, 600)
    const k = Math.min(1, Math.max(0, (37 - n.tempC) / 187))
    c.fillStyle = '#16232a'
    c.fillRect(58, y + rowH * 0.25, barW, rowH * 0.5)
    c.fillStyle = n.active ? INK.teal : INK.dim
    c.fillRect(58, y + rowH * 0.25, barW * k, rowH * 0.5)
    text(c, `${Math.round(n.tempC)} °C`, 64 + barW, y + rowH * 0.7, 12, n.active ? INK.text : INK.dim, 650)
  }
  // the timer and the margin sensor
  const by = h - 14
  text(c, p.timer, 10, by - 18, 10, INK.dim, 600)
  text(c, freezing || thawing ? clockOf(s.timer) : '--:--', 10, by, 20, INK.text, 700)
  const mx = w * 0.5
  text(c, p.margin, mx, by - 18, 10, INK.dim, 600)
  text(c, `${Math.round(s.marginC)} °C`, mx, by, 20, s.marginC <= -20 ? INK.teal : INK.text, 700)
  simulatedTag(c, w)
}

// ---------------------------------------------------------------------------------------------
// The robot's planning station
// ---------------------------------------------------------------------------------------------

const PHASE_LABEL: Readonly<Record<string, string>> = CRYO_SUITE_COPY.robotPhases

export function paintRobotStation(c: Ctx2D, w: number, h: number, s: CryoSuiteState): void {
  clear(c, w, h)
  const p = CRYO_SUITE_COPY.panel
  const cur = currentNeedle(s)
  text(c, `Robot · ${PHASE_LABEL[s.robot.phase] ?? s.robot.phase}`, 10, 20, 13, s.robot.phase === 'aligned' ? INK.green : s.robot.phase === 'stowed' ? INK.dim : INK.amber, 650)
  if (cur >= 0 && s.needles.length > 0) text(c, fillCryo(p.needle, { k: cur + 1, n: s.needles.length }), 10, 38, 12, INK.text, 600)
  // the path list: done (in, with its error), being worked on, to come
  const rows = Math.max(1, s.needles.length)
  const top = 50
  const rowH = Math.min(24, (h - top - 34) / rows)
  for (const n of s.needles) {
    const y = top + (n.index + 1) * rowH
    const isCur = n.index === cur
    const done = n.inserted > 0.999
    const color = isCur ? INK.amber : done ? INK.green : INK.dim
    text(c, `${n.index + 1}`, 12, y, 12, color, 700)
    const right = done || (isCur && s.robot.phase === 'aligned') ? fillCryo(p.aligned, { err: n.errorMm.toFixed(1) }) : isCur && s.robot.phase === 'aiming' ? p.aiming : '—'
    text(c, right, 30, y, 12, color, 600)
  }
  if (s.needles.length === 0) text(c, cryoStepLabel(s.step, s.target), 10, top + 20, 12, INK.dim, 500)
  text(c, cryoStepLabel(s.step, s.target), 10, h - 10, 10, INK.dim, 500)
  simulatedTag(c, w)
}
