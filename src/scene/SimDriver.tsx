import { useFrame } from '@react-three/fiber'
import { loop } from '@/sim'
import { FRAME_PRIORITY } from './camera/frameOrder'

/**
 * The only thing that advances the simulation. It runs first in every frame (before cameras, labels and the
 * layers that read poses), so everything drawn in the frame sees the same, freshly interpolated state.
 */
export function SimDriver() {
  useFrame((_, dt) => loop.frame(dt), FRAME_PRIORITY.sim)
  return null
}
