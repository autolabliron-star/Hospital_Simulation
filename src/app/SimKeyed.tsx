import { Fragment, type ReactNode } from 'react'
import { useJump } from '@/ui/jump.store'

/**
 * Rebuilds its children whenever a Jump swaps the running hospital (`simGeneration`): the old copies unmount and fresh ones
 * mount against the new `sim`. Wrap the scene layers that capture per-sim data when they mount: the emote tracker holds the
 * old `sim.entities` map, and the speech-bubble anchors hold it too.
 *
 *   <SimKeyed><EmoteLayer /><SpeechBubbles /></SimKeyed>
 *
 * Do NOT wrap the static building, `Lighting` (a remount re-bakes the shadow) or the crowd: the crowd model keeps one slot per
 * person id, treats a long step as a teleport, and fades out the people the new hospital does not have, so it follows a swap by
 * itself and keeps its GPU buffers.
 */
export function SimKeyed({ children }: { children: ReactNode }) {
  const generation = useJump((s) => s.generation)
  return <Fragment key={generation}>{children}</Fragment>
}
