/**
 * The minimap's floor plan (browser only): the real plan of the building, drawn once into an offscreen canvas that the minimap
 * copies each tick. The picture is `planSvg` (src/scene/building/layout/planSvg.ts: every floor, wall and piece of furniture of the
 * layout in its own colour, so it can never disagree with the building), decoded from an in-memory blob (no network), with a
 * short name on the main areas. Until it has decoded, and wherever it fails, a flat plan from the area rectangles stands in.
 * The plan code is loaded on first use, so the overview never pays for it.
 *
 * R2: there is one plan per level. Level 2 lies in its own strip of the sim (x 88..110), so its plan is `planSvg`'s `level: 2` over `MAP_BOUNDS_L2`; the
 * map shows the plan of the level you stand on (`minimapLevel`), and each level keeps its own layer.
 */
import type { LevelId } from '@/sim/levels'
import { AREA_FILL, MAP_INK, fallbackAreas, labelBox, labelLayout, labelsFor, mapBounds, mapFrame, toMapX, toMapY, type MapFrame } from './minimapModel'

export interface PlanLayer {
  canvas: HTMLCanvasElement
  frame: MapFrame
  /** Map pixels per CSS pixel. */
  dpr: number
  /** The level this plan is of. */
  level: LevelId
}

/** Plan pixels per metre of the picture planSvg draws, by level (the portrait plan of level 2 is drawn for a narrower card, so it needs the finer picture). */
const PLAN_SCALE: Record<LevelId, number> = { 1: 6, 2: 10 }

/** The base colour behind the plan (the same as planSvg's background). */
const BASE = '#e9eeed'
const LABEL_FONT_CSS_PX = 9

const layers: Partial<Record<LevelId, PlanLayer>> = {}
const images: Partial<Record<LevelId, Promise<HTMLImageElement | null>>> = {}

function loadPlanImage(level: LevelId): Promise<HTMLImageElement | null> {
  images[level] ??= (async () => {
    try {
      const { planSvg } = await import('@/scene/building/layout/planSvg')
      const b = mapBounds(level)
      // no layout given: planSvg uses the building's own (`getLayout()`)
      const svg = planSvg(undefined, { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, scale: PLAN_SCALE[level], level })
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      try {
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('the floor plan did not decode'))
          img.src = url
        })
        return img
      } finally {
        URL.revokeObjectURL(url)
      }
    } catch {
      return null
    }
  })()
  return images[level] as Promise<HTMLImageElement | null>
}

/** The flat plan: with `level`, only that level's areas (the plan of one level never draws the other's); without, every area. */
export function paintFallback(ctx: CanvasRenderingContext2D, f: MapFrame, level?: LevelId): void {
  ctx.fillStyle = BASE
  ctx.fillRect(0, 0, f.width, f.height)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(28,43,42,0.28)'
  for (const a of fallbackAreas(level)) {
    const x = toMapX(f, a.rect.x0)
    const y = toMapY(f, a.rect.z0)
    const w = (a.rect.x1 - a.rect.x0) * f.scale
    const h = (a.rect.z1 - a.rect.z0) * f.scale
    ctx.fillStyle = AREA_FILL[a.kind] ?? BASE
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  }
}

/** The short names on the plan of `level` (the ground floor's by default): a plan never names a room of the other level. */
export function paintLabels(ctx: CanvasRenderingContext2D, f: MapFrame, dpr: number, level: LevelId = 1): void {
  const font = LABEL_FONT_CSS_PX * dpr
  ctx.font = `600 ${font}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2.4 * dpr
  for (const l of labelsFor(level)) {
    const box = labelBox(f, l.area)
    const layout = labelLayout(box, ctx.measureText(l.text).width, font)
    if (layout === null) continue
    ctx.save()
    ctx.translate(box.x, box.y)
    if (layout === 'v') ctx.rotate(-Math.PI / 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.strokeText(l.text, 0, 0)
    ctx.fillStyle = MAP_INK
    ctx.fillText(l.text, 0, 0)
    ctx.restore()
  }
}

/**
 * The plan layer of `level` for a minimap `cssWidth` CSS pixels wide on a screen of density `dpr`. The same layer comes back until the size
 * changes (each level keeps its own). It starts as the flat plan and turns into the real one when the picture has decoded.
 */
export function planLayer(cssWidth: number, dpr: number, level: LevelId = 1): PlanLayer {
  const width = Math.max(64, Math.round(cssWidth * dpr))
  const have = layers[level]
  if (have && have.canvas.width === width && have.dpr === dpr) return have
  const frame = mapFrame(width, mapBounds(level))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.round(frame.height)
  const ctx = canvas.getContext('2d')
  const next: PlanLayer = { canvas, frame, dpr, level }
  layers[level] = next
  if (!ctx) return next
  paintFallback(ctx, frame, level)
  paintLabels(ctx, frame, dpr, level)
  void loadPlanImage(level).then((img) => {
    if (!img || layers[level] !== next) return
    ctx.fillStyle = BASE
    ctx.fillRect(0, 0, frame.width, frame.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    paintLabels(ctx, frame, dpr, level)
  })
  return next
}
