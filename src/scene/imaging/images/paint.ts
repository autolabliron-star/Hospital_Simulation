/**
 * Paints a `SliceModel` through a `Look` onto a 2D surface: shapes in painter's order, then soft blur, grain and (for MRI surface coils)
 * a falling-off sensitivity. The model's normalised square (-1..1) is mapped with ONE transform, so shapes are drawn in their own units.
 * This is the heavy step (about a millisecond); the live painters run it only when the slice changes, not on every redraw.
 */
import { isAdditive } from './tones'
import { grey, type Ctx2D, type Env, type Surface } from './ctx'
import { toneOf, type Look } from './looks'
import { makeTile, TILE, type TileKind } from './noise'
import type { Prim, SliceModel } from './shapes'

/** Edge of the working surface the shapes are drawn on; it is scaled up when blitted, which is also what softens the picture. */
export const WORK = 256

/** Blit a wrapping noise tile over the whole surface, shifted by (ox, oy) pixels; `scale` > 1 makes the grains bigger. */
export function blitTile(dst: Ctx2D, tile: Surface, size: number, ox: number, oy: number, scale = 1): void {
  const step = Math.round(TILE * scale)
  const x0 = -(((Math.floor(ox) % step) + step) % step)
  const y0 = -(((Math.floor(oy) % step) + step) % step)
  for (let y = y0; y < size; y += step) {
    for (let x = x0; x < size; x += step) {
      if (step === TILE) dst.drawImage(tile.canvas, x, y)
      else dst.drawImage(tile.canvas, x, y, step, step)
    }
  }
}

function pathPoly(c: Ctx2D, pts: number[]): void {
  const n = pts.length / 2
  if (n < 3) return
  // a closed curve through the midpoints, with the points as controls: smooth wherever the model is smooth
  c.beginPath()
  c.moveTo((pts[(n - 1) * 2] + pts[0]) / 2, (pts[(n - 1) * 2 + 1] + pts[1]) / 2)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    c.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], (pts[i * 2] + pts[j * 2]) / 2, (pts[i * 2 + 1] + pts[j * 2 + 1]) / 2)
  }
  c.closePath()
}

function drawPrim(c: Ctx2D, p: Prim, look: Look): void {
  const a = p.a ?? 1
  if (a <= 0.004) return
  const tone = toneOf(look, p.t)
  const add = look.additive && isAdditive(p.t)
  c.globalAlpha = a > 1 ? 1 : a
  const style = grey(add ? Math.min(1, tone) : tone)
  c.globalCompositeOperation = add ? 'lighter' : 'source-over'
  if (p.k === 'l') {
    if (p.w <= 0.0005 || p.pts.length < 4) return
    c.strokeStyle = style
    c.lineWidth = p.w
    c.beginPath()
    c.moveTo(p.pts[0], p.pts[1])
    for (let i = 2; i < p.pts.length; i += 2) c.lineTo(p.pts[i], p.pts[i + 1])
    c.stroke()
    return
  }
  c.fillStyle = style
  if (p.k === 'e') {
    if (p.rx <= 0.0005 || p.ry <= 0.0005) return
    c.beginPath()
    c.ellipse(p.cx, p.cy, p.rx, p.ry, p.rot ?? 0, 0, Math.PI * 2)
    c.fill()
    return
  }
  pathPoly(c, p.pts)
  c.fill()
}

/** Draw the shapes into `c` (already transformed to the -1..1 square). */
export function drawShapes(c: Ctx2D, model: SliceModel, look: Look): void {
  c.lineCap = 'round'
  c.lineJoin = 'round'
  for (const p of model.prims) drawPrim(c, p, look)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
}

export interface Painter {
  /** The shared grain tiles (also used by the ultrasound painter). */
  tiles: Record<TileKind, Surface>
  /** Paint a model, with grain and softening, over the whole of `target` (a square surface of `size` pixels). */
  paint(target: Surface, size: number, model: SliceModel, look: Look, grainOffset: number, coil?: boolean): void
}

/** The grain tiles, made once per painter (and so once per page). */
export function createPainter(env: Env): Painter {
  const work = env.createSurface(WORK, WORK)
  const fine = makeTile(env, 'fine')
  const speckle = makeTile(env, 'speckle')
  const tiles: Record<TileKind, Surface> = { fine, speckle }


  return {
    tiles,
    paint(target, size, model, look, grainOffset, coil = false) {
      const w = work.ctx
      w.setTransform(1, 0, 0, 1, 0, 0)
      w.globalCompositeOperation = 'source-over'
      w.globalAlpha = 1
      w.fillStyle = grey(look.background)
      w.fillRect(0, 0, WORK, WORK)
      w.setTransform(WORK / 2, 0, 0, WORK / 2, WORK / 2, WORK / 2)
      drawShapes(w, model, look)
      w.setTransform(1, 0, 0, 1, 0, 0)

      const t = target.ctx
      t.setTransform(1, 0, 0, 1, 0, 0)
      t.globalCompositeOperation = 'source-over'
      t.globalAlpha = 1
      t.imageSmoothingEnabled = true
      t.imageSmoothingQuality = 'high'
      if (env.supportsFilter) t.filter = 'blur(0.8px)'
      t.drawImage(work.canvas, 0, 0, size, size)
      if (env.supportsFilter) t.filter = 'none'

      // MRI surface coils see the near tissue best: a soft vignette
      if (coil && look.kind === 'mri') {
        const g = t.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.78)
        g.addColorStop(0, 'rgba(255,255,255,1)')
        g.addColorStop(1, 'rgba(150,150,150,1)')
        t.globalCompositeOperation = 'multiply'
        t.fillStyle = g
        t.fillRect(0, 0, size, size)
      }

      // grain: soft-light noise is a multiplicative-looking grain; MRI also gets a noise floor (the background is never quite black)
      const ox = Math.floor(grainOffset * 977)
      const oy = Math.floor(grainOffset * 613)
      t.globalCompositeOperation = 'soft-light'
      t.globalAlpha = Math.min(1, look.noise * (look.kind === 'xray' ? 0.8 : 0.9))
      blitTile(t, tiles.fine, size, ox, oy)
      if (look.kind === 'mri') {
        t.globalCompositeOperation = 'lighter'
        t.globalAlpha = 0.045
        blitTile(t, tiles.speckle, size, oy, ox)
      }
      t.globalCompositeOperation = 'source-over'
      t.globalAlpha = 1
    },
  }
}
