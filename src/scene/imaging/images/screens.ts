/** The shared live screens, one per modality, and the shared painter (grain tiles are made once). Browser only: created lazily on first use. */
import type { ImagingExam, ImagingModality } from '@/sim/types'
import { domEnv } from './ctx'
import { createPainter, type Painter } from './paint'
import { LiveScreen, renderThumbnailOn } from './screen'
import { imagingBackend } from '../worker/client'

let painter: Painter | null = null
const screens = new Map<ImagingModality, LiveScreen>()

function sharedPainter(): Painter {
  painter ??= createPainter(domEnv)
  return painter
}

export function getScreen(m: ImagingModality): LiveScreen {
  let s = screens.get(m)
  if (!s) {
    // R3: the screens draw from the imaging worker when the page has one
    s = new LiveScreen(m, domEnv, sharedPainter(), imagingBackend())
    screens.set(m, s)
  }
  return s
}

/** The screen if somebody has asked for it already (the driver updates only those; an unused screen costs nothing). */
export function peekScreen(m: ImagingModality): LiveScreen | undefined {
  return screens.get(m)
}

export function thumbnail(exam: ImagingExam, si: number, size: number): HTMLCanvasElement {
  // R3: the worker's own picture of the step when the screen kept one
  const kept = screens.get(exam.modality)?.thumbOf(exam, si)
  if (kept) {
    const s = domEnv.createSurface(size, size)
    s.ctx.drawImage(kept.canvas, 0, 0, kept.canvas.width, kept.canvas.height, 0, 0, size, size)
    return s.canvas as HTMLCanvasElement
  }
  return renderThumbnailOn(domEnv, sharedPainter(), exam, si, size) as HTMLCanvasElement
}
