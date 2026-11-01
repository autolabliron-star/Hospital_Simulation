/**
 * The machines and the images of the imaging suite (R1).
 *
 *   `getScanCanvas`, `renderThumbnail`, `scanCaption`   the three functions the Scan viewer uses (see `src/ui/imagingApi.ts`)
 *   `<ImagingMachines />`                               mount once inside the Canvas: the animated scanners and the image driver
 *
 * One live canvas per modality. The viewer mounts that very element while it is open and the monitors in 3D use it as a texture, so a
 * picture is drawn once and shown twice. The driver redraws at 4 Hz (F-42: CLAUDE.md allows 2 Hz for canvas screens, and only the focused one goes above it) for the scanner of the focused room and about 1 Hz for the rest.
 * R5: the ultrasound screen is also the watch overlay's picture-in-picture (registered as the 'us' inset source, usInset.ts) and goes to the focused rate
 * while the overlay shows it or the watch camera is on that room.
 */
import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { useFocus, modalityOfArea } from '@/scene/camera/focus.store'
import { watchLive } from '@/scene/watch/watch.store'
import { sim } from '@/sim'
import { MODALITIES, type ImagingExam, type ImagingModality, type ScannerState } from '@/sim/types'
import { captionOf } from './images/captions'
import { getScreen, peekScreen, thumbnail } from './images/screens'
import { getLiveCanvas } from './live'
import { Machines } from './machines'
import { BACKGROUND_INTERVAL_MS, FOCUSED_INTERVAL_MS, registerUsInset, screenInterval } from './usInset'

export { BACKGROUND_INTERVAL_MS, FOCUSED_INTERVAL_MS }

/** Negative on purpose: positive priorities take over rendering in R3F. Runs just before the machines (see machines/index.tsx). */
export const IMAGES_FRAME_PRIORITY = FRAME_PRIORITY.imagingImages

/** The live image canvas of a scanner; also the 3D monitors' texture. */
export function getScanCanvas(m: ImagingModality): HTMLCanvasElement {
  return getLiveCanvas(m)
}

/** A small picture of one finished step of an exam (a fresh canvas the caller may read). */
export function renderThumbnail(exam: ImagingExam, sequenceIndex: number, size: number): HTMLCanvasElement {
  return thumbnail(exam, sequenceIndex, size)
}

/** The title and one line under it for the viewer's header. */
export function scanCaption(state: ScannerState): { title: string; line: string } {
  return captionOf(state)
}

/** Redraws the screens that exist. Called every frame: it allocates nothing and a screen decides for itself whether it must draw. */
function ImageDriver() {
  useFrame(() => {
    const scanners = sim.imaging.scanners
    const focused = modalityOfArea(useFocus.getState().area)
    const now = performance.now()
    const t = sim.t
    for (let i = 0; i < MODALITIES.length; i++) {
      const m = MODALITIES[i]
      const screen = peekScreen(m)
      if (screen) screen.update(scanners[m], t, now, screenInterval(m, focused, watchLive.room))
    }
  }, IMAGES_FRAME_PRIORITY)
  return null
}

/** R5: the ultrasound screen as the watch overlay's picture-in-picture, for as long as the imaging layer is mounted. */
function UsInsetSource() {
  useEffect(() => registerUsInset(getScreen('us')), [])
  return null
}

/** Mount once inside the Canvas (World.tsx): the animated machines, their live monitors, and the driver that redraws the scan images. */
export function ImagingMachines() {
  return (
    <>
      <Machines />
      <ImageDriver />
      <UsInsetSource />
    </>
  )
}
