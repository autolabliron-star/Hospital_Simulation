/**
 * R5: the watch overlay's picture-in-picture: a DOM <canvas> that copies a machine's live canvas (the endoscope, the ultrasound picture, the CT plan and the
 * live CT) from the `insetSources` registry with `drawImage`, only when the source has repainted (it repaints at 4 Hz at most while it is wanted). While the
 * inset is shown it sets `insetWanted[id]`, so the source repaints at its hot rate. Nothing here runs per frame: a 125 ms timer checks the source's paint count.
 *
 * A source that is not registered (the CT room's pictures arrive with their own layer) shows nothing at all, and shows up as soon as it is registered: never a
 * black box, never a crash. A square picture (the ultrasound's, the CT's) is fitted into the 16:9 box with black bars each side, never stretched.
 */
import { useEffect, useRef, useState } from 'react'
import { WATCH } from '@/content/watch'
import { insetSource, insetWanted, type InsetId, type InsetSource } from '@/scene/registries/insetSources'

/** How often the inset looks for a new picture (ms): twice the fastest source's rate, so no repaint is shown late by more than half a period. */
export const INSET_CHECK_MS = 125

/** The inset's canvas size (the endoscope's 16:9; the browser scales it with CSS). */
export const INSET_W = 384
export const INSET_H = 216

/** Where a source's picture goes in the inset's canvas: the whole canvas for a 16:9 picture, else the biggest fit, centred (bars each side or above and below). */
export function insetFit(sw: number, sh: number): { x: number; y: number; w: number; h: number } {
  if (!(sw > 0 && sh > 0) || Math.abs(sw / sh - INSET_W / INSET_H) < 0.02) return { x: 0, y: 0, w: INSET_W, h: INSET_H }
  const k = Math.min(INSET_W / sw, INSET_H / sh)
  const w = sw * k
  const h = sh * k
  return { x: (INSET_W - w) / 2, y: (INSET_H - h) / 2, w, h }
}

/** Copy the source's canvas into the inset's context, fitted (the bars black). */
export function drawInset(ctx: CanvasRenderingContext2D, src: Pick<InsetSource, 'canvas' | 'width' | 'height'>): void {
  const f = insetFit(src.width, src.height)
  if (f.w < INSET_W || f.h < INSET_H) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, INSET_W, INSET_H)
  }
  ctx.drawImage(src.canvas as CanvasImageSource, 0, 0, src.width, src.height, f.x, f.y, f.w, f.h)
}

export function Inset({ id, big }: { id: InsetId; big: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // is there a picture to show? (read at render, then by the timer: a source registers when its layer mounts)
  const [present, setPresent] = useState(() => insetSource(id) !== null)

  useEffect(() => {
    insetWanted[id] = true
    let last = -1
    const copy = (): void => {
      const src = insetSource(id)
      setPresent(src !== null)
      const canvas = ref.current
      if (!canvas || !src) {
        // (no canvas yet: it is made on the next render, and has to be drawn once it is there)
        last = -1
        return
      }
      const n = src.paints()
      if (n === last) return
      last = n
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      drawInset(ctx, src)
    }
    copy()
    const timer = window.setInterval(copy, INSET_CHECK_MS)
    return () => {
      window.clearInterval(timer)
      insetWanted[id] = false
    }
  }, [id])

  if (!present) return null
  return (
    <figure className="watch-inset" data-big={big ? 'true' : 'false'} aria-label={WATCH.insets[id]}>
      <canvas ref={ref} width={INSET_W} height={INSET_H} className="watch-inset__canvas" />
      <figcaption className="watch-inset__label">{WATCH.insets[id]}</figcaption>
    </figure>
  )
}
