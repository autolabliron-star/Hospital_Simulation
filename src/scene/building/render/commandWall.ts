/**
 * The command center's video wall texture. The nine curved panels each show one ninth of the width, and the canvas keeps the
 * panels' own shape (2.04 m x 1.59 m is 256 x 206 pixels), so text drawn here is not stretched on the wall.
 *
 * Layout (L1): the four northern panels (the right-hand 1024 px) are the BEDS panel, painted from `bedsPanelModel` and redrawn
 * by `tickBedsWall` only when something it shows changed (at most twice a second, driven by CommandWallLive.tsx). The five
 * southern panels keep the standby picture (a faint plan of the hospital) until M4 draws the live map there: it may use the
 * region `[0, BEDS_REGION.x)` of the SAME canvas (`commandWallScreen.canvas`) and set `texture.needsUpdate = true`.
 */
import { CanvasTexture, LinearFilter, MeshBasicMaterial, SRGBColorSpace } from 'three'
import { BUILDING, CORE, ROOMS } from '@/sim/places'
import { STATUS } from '@/scene/materials'
import { dayStatsTracker, type DayStatsSource } from '@/ui/dayStats'
import { L1_COPY } from '@/ui/l1Copy'
import { bedsPanelModel, bedsSignature, type BedsPanelModel } from './bedsPanelModel'

const PANELS = 9
export const COMMAND_WALL_SIZE = { width: 2304, height: 206 } as const
const PANEL_W = COMMAND_WALL_SIZE.width / PANELS

/** The Beds panel's part of the canvas: the four northern panels. */
export const BEDS_REGION = { x: COMMAND_WALL_SIZE.width - 4 * PANEL_W, y: 0, w: 4 * PANEL_W, h: COMMAND_WALL_SIZE.height } as const

export interface CommandWallScreen {
  canvas: HTMLCanvasElement
  texture: CanvasTexture
  material: MeshBasicMaterial
}

let screen: CommandWallScreen | null = null

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** Paint the standby picture over `usableWidth` of the wall (also a handy base for M4 to start from). */
export function paintStandby(ctx: CanvasRenderingContext2D, w: number, h: number, usableWidth: number = w): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#0b171c')
  g.addColorStop(1, '#10242b')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // faint panel seams
  ctx.strokeStyle = 'rgba(120, 220, 210, 0.10)'
  ctx.lineWidth = 2
  for (let i = 1; i < PANELS; i++) {
    ctx.beginPath()
    ctx.moveTo((i * w) / PANELS, 0)
    ctx.lineTo((i * w) / PANELS, h)
    ctx.stroke()
  }
  // the building plan, drawn across the usable part of the wall
  const px = 18
  const sx = (usableWidth - px * 2) / (BUILDING.x1 - BUILDING.x0)
  const sz = (h - px * 2) / (BUILDING.z1 - BUILDING.z0)
  const X = (x: number) => px + (x - BUILDING.x0) * sx
  const Z = (z: number) => px + (z - BUILDING.z0) * sz
  ctx.strokeStyle = 'rgba(120, 220, 210, 0.55)'
  ctx.lineWidth = 3
  ctx.strokeRect(X(BUILDING.x0), Z(BUILDING.z0), (BUILDING.x1 - BUILDING.x0) * sx, (BUILDING.z1 - BUILDING.z0) * sz)
  ctx.strokeStyle = 'rgba(120, 220, 210, 0.9)'
  ctx.strokeRect(X(CORE.x0), Z(CORE.z0), (CORE.x1 - CORE.x0) * sx, (CORE.z1 - CORE.z0) * sz)
  ctx.fillStyle = 'rgba(120, 220, 210, 0.22)'
  for (const r of ROOMS) ctx.fillRect(X(r.rect.x0) + 1, Z(r.rect.z0) + 1, (r.rect.x1 - r.rect.x0) * sx - 2, (r.rect.z1 - r.rect.z0) * sz - 2)
  ctx.fillStyle = STATUS.teal
  ctx.font = `600 26px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText('MEDICINE FLOW  ·  STANDBY', usableWidth / 2, h / 2)
}

// ---------------------------------------------------------------------------------------------
// The Beds panel
// ---------------------------------------------------------------------------------------------

const TILE = { w: 72, h: 54, gap: 6, x: 40, y: 46 } as const
const STATS = { x: 700, y: 38, pitch: 38, w: 300 } as const
const INK = { title: '#7fe0d4', ward: '#9fe3dc', label: '#8fb5b1', value: '#e8fffb', detail: '#a9d6d1', legend: '#a9c9c5', seam: 'rgba(120, 220, 210, 0.10)' } as const

function setFont(ctx: CanvasRenderingContext2D, weight: number, px: number): void {
  ctx.font = `${weight} ${px}px ${FONT}`
}

/** Set a font that makes `text` fit `maxW`, shrinking from `px` (never below 8 px). Returns the width used. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, weight: number, px: number): number {
  setFont(ctx, weight, px)
  const w = ctx.measureText(text).width
  if (w <= maxW) return w
  const shrunk = Math.max(8, Math.floor((px * maxW) / w))
  setFont(ctx, weight, shrunk)
  return ctx.measureText(text).width
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** A small outlined tag whose right edge is at `rightX`. */
function chip(ctx: CanvasRenderingContext2D, text: string, rightX: number, y: number, color: string): void {
  setFont(ctx, 650, 11)
  const w = ctx.measureText(text.toUpperCase()).width + 16
  roundRect(ctx, rightX - w, y, w, 18, 9)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text.toUpperCase(), rightX - w / 2, y + 9.5)
}

/**
 * Paint the Beds panel into `region` of the wall canvas, replacing what was there. `model` null paints only the frame (before
 * the first figures arrive). Square pixels: nothing here needs to compensate for the screen's shape.
 */
export function paintBedsPanel(ctx: CanvasRenderingContext2D, region: { x: number; y: number; w: number; h: number }, model: BedsPanelModel | null): void {
  const ox = region.x
  const g = ctx.createLinearGradient(0, region.y, 0, region.y + region.h)
  g.addColorStop(0, '#0b171c')
  g.addColorStop(1, '#10242b')
  ctx.fillStyle = g
  ctx.fillRect(region.x, region.y, region.w, region.h)

  ctx.strokeStyle = INK.seam
  ctx.lineWidth = 2
  for (let k = 0; k < 4; k++) {
    ctx.beginPath()
    ctx.moveTo(ox + k * PANEL_W, region.y)
    ctx.lineTo(ox + k * PANEL_W, region.y + region.h)
    ctx.stroke()
  }

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  setFont(ctx, 700, 20)
  ctx.fillStyle = INK.title
  ctx.fillText(L1_COPY.beds.title.toUpperCase(), ox + TILE.x, 26)
  chip(ctx, L1_COPY.simulated, ox + region.w - 24, 16, INK.label)
  if (!model) return

  // ward labels and the 16 tiles
  ctx.textAlign = 'center'
  setFont(ctx, 700, 20)
  ctx.fillStyle = INK.ward
  ctx.fillText(L1_COPY.beds.wardA, ox + 22, TILE.y + TILE.h / 2)
  ctx.fillText(L1_COPY.beds.wardB, ox + 22, TILE.y + TILE.h + TILE.gap + TILE.h / 2)
  ctx.textAlign = 'left'
  for (const t of model.tiles) {
    const x = ox + TILE.x + t.col * (TILE.w + TILE.gap)
    const y = TILE.y + t.row * (TILE.h + TILE.gap)
    roundRect(ctx, x, y, TILE.w, TILE.h, 8)
    ctx.fillStyle = t.fill
    ctx.fill()
    if (t.stripes) {
      ctx.save()
      roundRect(ctx, x, y, TILE.w, TILE.h, 8)
      ctx.clip()
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)'
      ctx.lineWidth = 4
      for (let k = -TILE.h; k < TILE.w; k += 11) {
        ctx.beginPath()
        ctx.moveTo(x + k, y + TILE.h)
        ctx.lineTo(x + k + TILE.h, y)
        ctx.stroke()
      }
      ctx.restore()
    }
    ctx.fillStyle = t.ink
    const maxW = TILE.w - 12
    fit(ctx, t.roomId, maxW, 700, 19)
    ctx.fillText(t.roomId, x + 8, y + 17)
    fit(ctx, t.word, maxW, 600, 12)
    ctx.fillText(t.word, x + 8, y + 34)
    if (t.note) {
      fit(ctx, t.note, maxW, 650, 11)
      ctx.fillText(t.note, x + 8, y + 47)
    }
  }

  // legend under the tiles
  let lx = ox + TILE.x
  const ly = TILE.y + 2 * TILE.h + TILE.gap + 22
  for (const item of model.legend) {
    roundRect(ctx, lx, ly - 5, 10, 10, 3)
    ctx.fillStyle = item.color
    ctx.fill()
    ctx.fillStyle = INK.legend
    const w = fit(ctx, item.label, 90, 500, 12)
    ctx.fillText(item.label, lx + 15, ly)
    lx += 15 + w + 18
  }
  ctx.fillStyle = INK.label
  fit(ctx, L1_COPY.beds.inProgress, 140, 500, 11)
  ctx.fillText(L1_COPY.beds.inProgress, lx, ly)

  // figures
  ctx.strokeStyle = INK.seam
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(ox + STATS.x - 14, TILE.y)
  ctx.lineTo(ox + STATS.x - 14, TILE.y + 2 * TILE.h + TILE.gap)
  ctx.stroke()
  model.stats.forEach((s, i) => {
    const y = STATS.y + i * STATS.pitch + 8
    const x = ox + STATS.x
    ctx.textAlign = 'left'
    ctx.fillStyle = INK.label
    fit(ctx, s.label, STATS.w - (s.tag ? 80 : 0), 600, 11.5)
    ctx.fillText(s.label, x, y)
    if (s.tag) chip(ctx, s.tag, x + STATS.w, y - 9, INK.label)
    ctx.textAlign = 'left'
    let dx = x
    if (s.value) {
      ctx.fillStyle = INK.value
      const vw = fit(ctx, s.value, 120, 650, 26)
      ctx.fillText(s.value, x, y + 20)
      dx = x + vw + 10
    }
    if (s.detail) {
      ctx.fillStyle = INK.detail
      fit(ctx, s.detail, x + STATS.w - dx, 500, 13)
      ctx.fillText(s.detail, dx, y + 21)
    }
  })
}

/** The wall's canvas, texture and material: created on first use, shared afterwards. */
export function getCommandWallScreen(): CommandWallScreen {
  if (screen) return screen
  const canvas = document.createElement('canvas')
  canvas.width = COMMAND_WALL_SIZE.width
  canvas.height = COMMAND_WALL_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('command wall: no 2d canvas')
  paintStandby(ctx, canvas.width, canvas.height, BEDS_REGION.x)
  paintBedsPanel(ctx, BEDS_REGION, null)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  const material = new MeshBasicMaterial({ map: texture, toneMapped: true })
  material.color.setScalar(1.1)
  screen = { canvas, texture, material }
  return screen
}

/** Repaint the Beds panel with `model` and flag the texture for upload. */
export function updateBedsPanel(model: BedsPanelModel): void {
  const wall = getCommandWallScreen()
  const ctx = wall.canvas.getContext('2d')
  if (!ctx) return
  paintBedsPanel(ctx, BEDS_REGION, model)
  wall.texture.needsUpdate = true
}

let lastOwner: object | null = null
let lastSignature = 0

/**
 * The redraw check, called at most twice a second: refresh the figures, and repaint the Beds panel only if a room's version or
 * state, a boarding minute or a figure changed since the last paint, or the hospital itself was swapped (a Jump). Returns
 * whether it painted.
 */
export function tickBedsWall(sim: DayStatsSource): boolean {
  const stats = dayStatsTracker.read(sim)
  const signature = bedsSignature(sim.life, sim.t, stats)
  if (sim === lastOwner && signature === lastSignature) return false
  lastOwner = sim
  lastSignature = signature
  updateBedsPanel(bedsPanelModel(sim.life, sim.t, stats))
  return true
}
