/**
 * The machines & images module (`src/scene/imaging/index.tsx`) is built by another agent. This loader reaches it
 * through a glob import, so this file typechecks and builds whether or not that module exists yet: with it missing,
 * `loadImagingScene()` resolves to null and the viewer shows a placeholder instead of the live image.
 *
 * Once the module is in, a plain `import { getScanCanvas, renderThumbnail, scanCaption } from '@/scene/imaging'` would
 * do the same job.
 */
import type { ImagingExam, ImagingModality, ScannerState } from '@/sim/types'

/** The three functions the Scan viewer uses (pinned in the R1 brief). */
export interface ImagingScene {
  /** The live image canvas; also the 3D monitor's texture. The viewer mounts this same element while it is open. */
  getScanCanvas(m: ImagingModality): HTMLCanvasElement
  /** A small picture of one finished step. */
  renderThumbnail(exam: ImagingExam, sequenceIndex: number, size: number): HTMLCanvasElement
  /** The title and one line under it for the viewer's header. */
  scanCaption(state: ScannerState): { title: string; line: string }
}

const loaders = import.meta.glob<ImagingScene>('../scene/imaging/index.tsx')

let cached: Promise<ImagingScene | null> | null = null

export function loadImagingScene(): Promise<ImagingScene | null> {
  if (!cached) {
    const load = Object.values(loaders)[0]
    cached = load ? load().catch(() => null) : Promise.resolve(null)
  }
  return cached
}
