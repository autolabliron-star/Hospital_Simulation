/**
 * Interaction (W1): "press E" for the doctor walking the hospital. Mount `<Interaction />` once inside the Canvas.
 *
 *   registrations.ts  the bedsides, MedDrawers, consoles, command wall, kiosks and lifts, registered into the interactable registry
 *   picker.ts         the best target in reach, from those, the free seats and the people (pure, tested)
 *   system.ts         once a frame (R3F priority -8, after the player and the chase camera): pick, prompt, objective, seat, bubbles
 *   keys.ts           the one key listener: E, stand up, Esc
 *   yourOrder.ts      the objective line that follows the order you prescribed
 *
 * The HUD side (prompt, objective, minimap, drawer card) is src/ui/walk; it reads `useWalk` and the small stores there.
 */
import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { useInteract } from '@/scene/interact.store'
import { placePlayer } from '@/scene/player/api'
import { sim, simGeneration } from '@/sim'
import { isTyping } from '@/ui/walk/typing'
import { walkActions } from './actions'
import { installKeys } from './keys'
import { closableOverlayOpen, closeOverlays, overlayOpen } from './overlays'
import { registerWalkInteractables } from './registrations'
import { InteractionSystem, type SystemEnv } from './system'

/** After the player (-10) and the tour/camera flight (-9), before everything that reads the camera (see camera/frameOrder.ts). */
export const INTERACT_FRAME_PRIORITY = FRAME_PRIORITY.interact

const env: SystemEnv = {
  sim: () => sim,
  generation: () => simGeneration,
  now: () => performance.now(),
  items: () => useInteract.getState().items,
  overlayOpen,
  closeOverlays,
  placePlayer,
}

/** The running interaction system (the HUD reads your order through `useYourOrder`, not through this). */
export const interaction = new InteractionSystem(env)

export function Interaction(): null {
  useEffect(() => {
    const unregister = registerWalkInteractables({ sim: () => sim, actions: walkActions })
    const unkeys = installKeys({
      walking: () => sim.player?.mode === 'walk',
      seated: () => interaction.seat.active !== null,
      overlayOpen,
      closable: closableOverlayOpen,
      typing: isTyping,
      interact: () => interaction.press(),
      standUp: () => interaction.standUp(),
      closeOverlays,
    })
    return () => {
      unkeys()
      unregister()
      interaction.dispose()
    }
  }, [])

  useFrame((_, dt) => interaction.tick(dt), INTERACT_FRAME_PRIORITY)
  return null
}
