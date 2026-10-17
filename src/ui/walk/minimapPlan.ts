/**
 * The minimap's floor plan (browser only): the real plan of the building, drawn once into an offscreen canvas that the minimap
 * copies each tick. The picture is `planSvg` (src/scene/building/layout/planSvg.ts: every floor, wall and piece of furniture of the
 * layout in its own colour, so it can never disagree with the building), decoded from an in-memory blob (no network), with a
 * short name on the main areas. Until it has decoded, and wherever it fails, a flat plan from the area rectangles stands in.
 * The plan code is loaded on first use, so the overview never pays for it.
 */
import { AREA_FILL, MAP_BOUNDS, MAP_INK, MAP_LABELS, fallbackAreas, labelBox, labelLayout, mapFrame, toMapX, toMapY, type MapFrame } from './minimapModel'

export interface PlanLayer {
  canvas: HTMLCanvasElement
  frame: MapFrame
  /** Map pixels per CSS pixel. */
  dpr: number
}

/** The base colour behind the plan (the same as planSvg's background). */
const BASE = '#e9eeed'
const LABEL_FONT_CSS_PX = 9

let layer: PlanLayer | null = null
let image: Promise<HTMLImageElement | null> | null = null

function loadPlanImage(): Promise<HTMLImageElement | null> {
  image ??= (async () => {
    try {
      const { planSvg } = await import('@/scene/building/layout/planSvg')
      const b = MAP_BOUNDS
      // no layout given: planSvg uses the building's own (`getLayout()`)
      const svg = planSvg(undefined, { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, scale: 6 })
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
  return image
}

export function paintFallback(ctx: CanvasRenderingContext2D, f: MapFrame): void {
  ctx.fillStyle = BASE
  ctx.fillRect(0, 0, f.width, f.height)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(28,43,42,0.28)'
  for (const a of fallbackAreas()) {
    const x = toMapX(f, a.rect.x0)
    const y = toMapY(f, a.rect.z0)
    const w = (a.rect.x1 - a.rect.x0) * f.scale
    const h = (a.rect.z1 - a.rect.z0) * f.scale
    ctx.fillStyle = AREA_FILL[a.kind] ?? BASE
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  }
}

export function paintLabels(ctx: CanvasRenderingContext2D, f: MapFrame, dpr: number): void {
  const font = LABEL_FONT_CSS_PX * dpr
  ctx.font = `600 ${font}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2.4 * dpr
  for (const l of MAP_LABELS) {
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
 * The plan layer for a minimap `cssWidth` CSS pixels wide on a screen of density `dpr`. The same layer comes back until the size
 * changes. It starts as the flat plan and turns into the real one when the picture has decoded.
 */
export function planLayer(cssWidth: number, dpr: number): PlanLayer {
  const width = Math.max(64, Math.round(cssWidth * dpr))
  if (layer && layer.canvas.width === width && layer.dpr === dpr) return layer
  const frame = mapFrame(width)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.round(frame.height)
  const ctx = canvas.getContext('2d')
  const next: PlanLayer = { canvas, frame, dpr }
  layer = next
  if (!ctx) return next
  paintFallback(ctx, frame)
  paintLabels(ctx, frame, dpr)
  void loadPlanImage().then((img) => {
    if (!img || layer !== next) return
    ctx.fillStyle = BASE
    ctx.fillRect(0, 0, frame.width, frame.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    paintLabels(ctx, frame, dpr)
  })
  return next
}
