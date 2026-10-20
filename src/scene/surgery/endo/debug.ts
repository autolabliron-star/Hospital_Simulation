/**
 * R3 (endoscope): the probe's handle on the endoscope picture, installed by SurgeryLayer only with `?probe=1` (browser only: it makes DOM canvases).
 *
 *   window.__hospitalEndo.stats()                  the plates baked, the bake's slices and its longest slice, the live texture's paints
 *   window.__hospitalEndo.bloodStats()             the no-blood measures (noBlood.ts) of the live picture as it is now, and of each plate
 *   window.__hospitalEndo.endoPreview(p, t?)       a 768 x 432 picture of procedure p ('cholecystectomy' | 'hysterectomy' | 'prostatectomy' or 0..2) at
 *                                                  sim second t, docked with that procedure's own instruments, as a JPEG data URL
 *   window.__hospitalEndo.showEndoPreview(p, t?)   the same picture laid over the page (top left) for a screenshot; hideEndoPreview() takes it away
 */
import type { Env } from '@/scene/imaging/images/ctx'
import { procIndex } from './anatomy'
import { bloodStats, type BloodStats } from './noBlood'
import { EndoPainter } from './paint'
import { bakeEndoPlatesNow, endoPlates } from './plates'
import { newEndoView, setProcedureLooks, type EndoView } from './view'
import type { SurgeryProcedure } from '@/sim/types'

const PREVIEW_W = 768
const PREVIEW_H = 432

interface Readable {
  width: number
  height: number
  getContext(id: '2d'): CanvasRenderingContext2D | null
}

function measure(canvas: unknown): BloodStats | null {
  const c = canvas as Readable
  const ctx = c.getContext?.('2d')
  if (!ctx) return null
  return bloodStats(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)
}

/** A docked view of procedure `p` at sim second `t`, with its own instruments and the first energy tool's pedal down. */
export function previewView(p: number, t: number): EndoView {
  const v = setProcedureLooks(newEndoView({ seed: 7, t, gain: 1 }), p)
  v.energy[0] = 1
  return v
}

/** Install `window.__hospitalEndo`. Returns the uninstall. */
export function installEndoDebug(env: Env, live: { canvas: unknown; paints: number }): () => void {
  const w = window as unknown as Record<string, unknown>
  let overlay: HTMLCanvasElement | null = null
  const painter = new EndoPainter(PREVIEW_W, PREVIEW_H)
  const toIndex = (p: SurgeryProcedure | number): number => (typeof p === 'number' ? p : procIndex(p))
  const paint = (p: SurgeryProcedure | number, t: number): HTMLCanvasElement => {
    bakeEndoPlatesNow(env)
    const canvas = document.createElement('canvas')
    canvas.width = PREVIEW_W
    canvas.height = PREVIEW_H
    const ctx = canvas.getContext('2d')
    if (ctx) painter.paint(ctx, previewView(toIndex(p), t))
    return canvas
  }
  w.__hospitalEndo = {
    stats: () => ({ plates: endoPlates.plates.map((p) => p !== null), failed: endoPlates.failed, slices: endoPlates.slices, longestMs: endoPlates.longestMs, livePaints: live.paints }),
    bloodStats: () => ({ live: measure(live.canvas), plates: endoPlates.plates.map((p) => (p ? measure(p.plate.canvas) : null)) }),
    endoPreview: (p: SurgeryProcedure | number, t = 60) => paint(p, t).toDataURL('image/jpeg', 0.9),
    showEndoPreview: (p: SurgeryProcedure | number, t = 60) => {
      overlay?.remove()
      overlay = paint(p, t)
      overlay.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;width:768px;height:432px;box-shadow:0 4px 24px rgba(0,0,0,0.5)'
      document.body.appendChild(overlay)
      return true
    },
    hideEndoPreview: () => {
      overlay?.remove()
      overlay = null
      return true
    },
  }
  return () => {
    overlay?.remove()
    delete w.__hospitalEndo
  }
}
