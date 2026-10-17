import { useEffect } from 'react'
import { sim } from '@/sim'
import type { ImagingModality, ScannerState } from '@/sim/types'
import { modalityOfArea, useFocus } from '@/scene/camera/focus.store'
import { useAudio } from './audio.store'
import { ScannerEngine } from './scanners'

/**
 * The scanner state for one modality. `sim.imaging` is not wired into the Simulation yet, so until it is every
 * scanner reads as undefined, which the engine treats as idle (MRI chug only, CT and X-ray silent).
 */
function readScanner(m: ImagingModality): ScannerState | undefined {
  const imaging = (sim as unknown as { imaging?: { scanners?: Partial<Record<ImagingModality, ScannerState>> } }).imaging
  return imaging?.scanners?.[m]
}

/** Starts the scanner sound engine while mounted. Renders nothing. Mount it once, in App. */
export function ScannerSounds(): null {
  useEffect(() => {
    const engine = new ScannerEngine({
      focus: () => modalityOfArea(useFocus.getState().area),
      audio: () => {
        const { muted, unlocked } = useAudio.getState()
        return { muted, unlocked }
      },
      hidden: () => typeof document !== 'undefined' && document.hidden,
      scanner: readScanner,
    })
    engine.start()
    return () => engine.stop()
  }, [])
  return null
}
