/** The real things behind the intro's ports (see intro.ts). Importing this builds the running hospital (`@/sim`), so tests use fakes instead. */
import { useAudio } from '@/audio/audio.store'
import { useWarmup } from '@/scene/warmup/warmup.store'
import { loop } from '@/sim'
import { useWorld } from '@/sim/world.store'
import type { IntroPorts } from './intro'

export function realPorts(): IntroPorts {
  return {
    sim: loop,
    world: useWorld,
    audio: { unlock: () => useAudio.getState().unlock() },
    gate: { enter: () => useWarmup.getState().enter(), entered: () => useWarmup.getState().entered },
  }
}
