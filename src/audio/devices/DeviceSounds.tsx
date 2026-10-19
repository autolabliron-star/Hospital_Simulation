import { useEffect } from 'react'
import { usePower } from '@/app/power'
import { useFocus } from '@/scene/camera/focus.store'
import { loop, sim } from '@/sim'
import type { Vec3 } from '@/sim/types'
import { useAudio } from '../audio.store'
import { registerAreaSource } from './areaSource'
import { registerDrawSounds, soundViewOf } from './drawPatterns'
import { DeviceEngine } from './engine'
import { createLabPattern } from './labPatterns'
import { listenerAt } from './listener'
import { registerDevicePattern, registerPatternModules } from './registry'

/**
 * Starts the device sounds (the lab's pneumatic tube, centrifuges, conveyor and analysers, and whatever the kiosks and the draw centre register)
 * while mounted. Renders nothing. Mount it once, in App, beside ScannerSounds and Ambience: it plays only while you walk (or an overview room is
 * focused), is muted by M, and stops when the tab is hidden or the demo paused.
 *
 * The draw centre's sounds (drawPatterns.ts) are registered by name through the area-source adapter; the other W4 features are picked up by glob: every
 * `src/audio/devices/*Patterns.ts` (kioskPatterns, ...) that exports `devicePatterns` is registered here, and one that calls `registerDevicePattern` at
 * module level registers itself when it is loaded (see registry.ts). The lab's own patterns are created here (labPatterns.ts).
 */
const PATTERN_MODULES = import.meta.glob(['./*Patterns.ts', '!./labPatterns.ts'], { eager: true })

const listener: Vec3 = { x: 0, y: 0, z: 0 }
const simInfo = { t: 0, speed: 1 }

export function DeviceSounds(): null {
  useEffect(() => {
    const offLab = registerDevicePattern(createLabPattern(() => sim.lab))
    // the draw centre registers through the area-source adapter (its tracker is stepped with the time since its last look)
    const offDraw = registerDrawSounds(registerAreaSource, () => soundViewOf(sim.blood))
    const offOthers = registerPatternModules(PATTERN_MODULES)
    const engine = new DeviceEngine({
      audio: () => {
        const { muted, unlocked } = useAudio.getState()
        return { muted, unlocked }
      },
      // the engine reads `hidden` as "stay silent": a hidden tab, or a paused demo (PowerLoop: hidden tab, or a blurred window outside presentation mode)
      hidden: () => (typeof document !== 'undefined' && document.hidden) || usePower.getState().paused,
      listener: () => listenerAt(sim.player, useFocus.getState().area, listener),
      sim: () => {
        simInfo.t = sim.t
        simInfo.speed = loop.paused ? 0 : loop.speed
        return simInfo
      },
    })
    engine.start()
    return () => {
      engine.stop()
      offLab()
      offDraw()
      offOthers()
    }
  }, [])
  return null
}
