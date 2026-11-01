/**
 * R5: the watch overlay's picture-in-picture: a DOM <canvas> that copies a machine's live canvas (the endoscope today; the ultrasound and the CT later)
 * from the `insetSources` registry with `drawImage`, only when the source has repainted (it repaints at 4 Hz at most while it is wanted). While the inset
 * is shown it sets `insetWanted[id]`, so the source repaints at its hot rate. Nothing here runs per frame: a 125 ms timer checks the source's paint count.
 */
import { useEffect, useRef } from 'react'
import { WATCH } from '@/content/watch'
import { insetSource, insetWanted, type InsetId } from '@/scene/registries/insetSources'

/** How often the inset looks for a new picture (ms): twice the fastest source's rate, so no repaint is shown late by more than half a period. */
export const INSET_CHECK_MS = 125

/** The inset's canvas size (the endoscope's 16:9; the browser scales it with CSS). */
const W = 384
const H = 216

export function Inset({ id, big }: { id: InsetId; big: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    insetWanted[id] = true
    let last = -1
    const copy = (): void => {
      const canvas = ref.current
      const src = insetSource(id)
      if (!canvas || !src) return
      const n = src.paints()
      if (n === last) return
      last = n
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(src.canvas as CanvasImageSource, 0, 0, W, H)
    }
    copy()
    const timer = window.setInterval(copy, INSET_CHECK_MS)
    return () => {
      window.clearInterval(timer)
      insetWanted[id] = false
    }
  }, [id])

  return (
    <figure className="watch-inset" data-big={big ? 'true' : 'false'} aria-label={WATCH.insets[id]}>
      <canvas ref={ref} width={W} height={H} className="watch-inset__canvas" />
      <figcaption className="watch-inset__label">{WATCH.insets[id]}</figcaption>
    </figure>
  )
}
