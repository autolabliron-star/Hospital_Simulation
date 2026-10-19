/**
 * The minimap (walk mode, top right): the floor plan with your arrow, the MedPods as dots, and a marker for your order: a ring round
 * the pod that carries it and an orange diamond at the room it is going to. North is up. Drawn on a canvas at 10 Hz; no React per
 * frame. The plan is minimapPlan.ts, the drawing minimapDraw.ts, the maths minimapModel.ts. `sim` is the live binding, so a Jump
 * needs nothing here.
 *
 * R2: the map shows the plan of the level you stand on (`minimapLevel`): the whole building on level 1, the surgery suite's strip on level 2, in a
 * narrower card (the level-2 plan is portrait). The level is React state, but it changes only when you ride a lift.
 */
import { useEffect, useRef, useState } from 'react'
import { SURGERY_UI } from '@/content/surgeryUi'
import { WALK } from '@/content/walk'
import { useYourOrder } from '@/scene/interact/yourOrder.store'
import { sim } from '@/sim'
import type { LevelId } from '@/sim/levels'
import { drawMinimap } from './minimapDraw'
import { MAP_REDRAW_MS, minimapLevel } from './minimapModel'
import { planLayer } from './minimapPlan'
import './minimapLevel.css'

/** The card's padding on each side (walk.css), which the canvas does not get. */
const CARD_PADDING_PX = 6

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [level, setLevel] = useState<LevelId>(() => minimapLevel(sim.player))

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let shown = level
    const draw = (): void => {
      if (document.hidden) return
      // the plan of the level you stand on; the card changes width with it (CSS), so the next tick measures and draws
      const now = minimapLevel(sim.player)
      if (now !== shown) {
        shown = now
        setLevel(now)
        return
      }
      const w = (canvas.parentElement?.clientWidth ?? 0) - 2 * CARD_PADDING_PX
      if (w <= 0) return
      const plan = planLayer(w, dpr, now)
      if (canvas.width !== plan.canvas.width || canvas.height !== plan.canvas.height) {
        canvas.width = plan.canvas.width
        canvas.height = plan.canvas.height
      }
      drawMinimap(ctx, plan, sim, useYourOrder.getState().view, dpr, performance.now())
    }
    draw()
    const id = window.setInterval(draw, MAP_REDRAW_MS)
    return () => window.clearInterval(id)
    // (`level` only seeds `shown` once: the interval follows the sim itself)
  }, [])

  return (
    <section className="hud-card walk-map" data-level={level} aria-label={level === 2 ? `${WALK.hud.minimap}: ${SURGERY_UI.level.two}` : WALK.hud.minimap}>
      <canvas ref={ref} className="walk-map__canvas" role="img" aria-label={WALK.hud.minimapAlt} />
      <span className="walk-map__north" aria-hidden="true">
        N
      </span>
    </section>
  )
}
