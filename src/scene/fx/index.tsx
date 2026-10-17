/**
 * The readability layer: emote icons over heads and speech bubbles.
 *
 * Mount both inside the canvas, after the people and before <Effects />:
 *
 *   <EmoteLayer />      one instanced quad layer, one draw call
 *   <SpeechBubbles />   drei <Html> cards, at most 12; driven by useBubbles().say(entityId, text, seconds)
 *
 * or mount `<ReadabilityFx />`, which is both.
 */
import { EmoteLayer } from './EmoteLayer'
import { SpeechBubbles } from './SpeechBubbles'

export { EmoteLayer, SpeechBubbles }
export { MAX_BUBBLES, REPEAT_WINDOW_SECONDS, createBubbleStore, say, useBubbles } from './bubbleStore'
export type { Bubble, BubbleState } from './bubbleStore'
export { HEAD_Y, headAnchor, headPose } from './headAnchor'
export type { HeadPose } from './headAnchor'
export { ICON_EMOTES } from './emoteAtlas'
export type { IconEmote } from './emoteAtlas'

export function ReadabilityFx() {
  return (
    <>
      <EmoteLayer />
      <SpeechBubbles />
    </>
  )
}
