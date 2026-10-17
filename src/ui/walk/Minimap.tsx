/**
 * The minimap (walk mode, top right): the floor plan with your arrow, the MedPods as dots, and a marker for your order: a ring round
 * the pod that carries it and an orange diamond at the room it is going to. North is up. Drawn on a canvas at 10 Hz; no React per
 * frame. The plan is minimapPlan.ts, the drawing minimapDraw.ts, the maths minimapModel.ts. `sim` is the live binding, so a Jump
 * needs nothing here.
 */
import { useEffect, useRef } from 'react'
import { WALK } from '@/content/walk'
import { useYourOrder } from '@/scene/interact/yourOrder.store'
import { sim } from '@/sim'
import { drawMinimap } from './minimapDraw'
import { MAP_REDRAW_MS } from './minimapModel'
import { planLayer } from './minimapPlan'

/** The card's padding on each side (walk.css), which the canvas does not get. */
const CARD_PADDING_PX = 6

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const draw = (): void => {
      if (document.hidden) return
      const w = (canvas.parentElement?.clientWidth ?? 0) - 2 * CARD_PADDING_PX
      if (w <= 0) return
      const plan = planLayer(w, dpr)
      if (canvas.width !== plan.canvas.width || canvas.height !== plan.canvas.height) {
        canvas.width = plan.canvas.width
        canvas.height = plan.canvas.height
      }
      drawMinimap(ctx, plan, sim, useYourOrder.getState().view, dpr, performance.now())
    }
    draw()
    const id = window.setInterval(draw, MAP_REDRAW_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <section className="hud-card walk-map" aria-label={WALK.hud.minimap}>
      <canvas ref={ref} className="walk-map__canvas" role="img" aria-label={WALK.hud.minimapAlt} />
      <span className="walk-map__north" aria-hidden="true">
        N
      </span>
    </section>
  )
}
