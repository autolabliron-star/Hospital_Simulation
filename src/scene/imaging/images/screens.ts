/** The shared live screens, one per modality, and the shared painter (grain tiles are made once). Browser only: created lazily on first use. */
import type { ImagingExam, ImagingModality } from '@/sim/types'
import { domEnv } from './ctx'
import { createPainter, type Painter } from './paint'
import { LiveScreen, renderThumbnailOn } from './screen'

let painter: Painter | null = null
const screens = new Map<ImagingModality, LiveScreen>()

function sharedPainter(): Painter {
  painter ??= createPainter(domEnv)
  return painter
}

export function getScreen(m: ImagingModality): LiveScreen {
  let s = screens.get(m)
  if (!s) {
    s = new LiveScreen(m, domEnv, sharedPainter())
    screens.set(m, s)
  }
  return s
}

/** The screen if somebody has asked for it already (the driver updates only those; an unused screen costs nothing). */
export function peekScreen(m: ImagingModality): LiveScreen | undefined {
  return screens.get(m)
}

export function thumbnail(exam: ImagingExam, si: number, size: number): HTMLCanvasElement {
  return renderThumbnailOn(domEnv, sharedPainter(), exam, si, size) as HTMLCanvasElement
}
