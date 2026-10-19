/**
 * Where one speech bubble goes this frame and how visible it is: the pure part of `SpeechBubbles.tsx`, so the node tests can run it (no React, no
 * three.js, no allocation). The component owns the DOM and the <Html>; this owns the geometry and the fades.
 *
 * R2 levels (docs/R2-SURGERY.md). The speaker's head anchor (headAnchor.ts) is a SIM point, and level 2 lives in its own strip of the flat sim (sim x =
 * drawn x + 150, y floor-relative). So the line-of-sight test (sight.ts) runs in SIM space, against the sim's walls, from the camera's sim position
 * (`walkCam.camera`, written by the player system every frame), and only then is the anchor mapped to drawn coordinates (`toDisplayInto`) for the card's group and
 * the distance from the three.js camera. A speaker the screen does not show (the other level: `shownAt`) gets no card at all.
 */
import { shownAt } from '@/scene/levels/levelView'
import { toDisplayInto } from '@/sim/levels'
import type { Entity, Vec3 } from '@/sim/types'
import { emoteStackHeight, MAX_RANGE } from './emoteMath'
import { headAnchor } from './headAnchor'
import { sightBlocked } from './sight'

/** Seconds the card takes to fade in, and to fade out before it expires. */
export const FADE_IN_SECONDS = 0.18
export const FADE_OUT_SECONDS = 0.3
/** Gap between the anchor and the tail tip (metres). */
export const GAP = 0.04
/** Seconds a bubble takes to fade when a wall comes between you and the speaker, or goes. */
export const SIGHT_FADE_SECONDS = 0.15

/** The per-bubble state the fades keep: 1 while you can see the speaker, 0 behind a wall, fading between. */
export interface SightState {
  seen: number
}

/** The result: where the card's group goes (DRAWN coordinates) and the card's opacity (0 hides it). */
export interface BubblePlacement {
  x: number
  y: number
  z: number
  opacity: number
  /** False when the group was not moved this frame (nobody to anchor to: the speaker is gone or on the other level). */
  moved: boolean
}

const anchor: Vec3 = { x: 0, y: 0, z: 0 }
const drawn: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * Place one bubble. `cam` is the three.js camera (drawn), `camSim` the same camera in sim coordinates; `walking` is walk mode as the building sees it (any mode but
 * the overview), the only time walls hide a bubble. `now` is the bubble clock.
 */
export function placeBubble(
  e: Entity | undefined,
  born: number,
  until: number,
  now: number,
  cam: Readonly<Vec3>,
  camSim: Readonly<Vec3>,
  walking: boolean,
  dt: number,
  sight: SightState,
  out: BubblePlacement,
): void {
  out.opacity = 0
  out.moved = false
  if (e === undefined || !shownAt(e.position.x, e.position.z)) return
  // the anchor is a SIM point; the camera and the card's group are drawn coordinates
  headAnchor(e, anchor)
  toDisplayInto(anchor, drawn)
  const dx = drawn.x - cam.x
  const dy = drawn.y - cam.y
  const dz = drawn.z - cam.z
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const lift = e.emote === 'none' ? GAP : GAP + emoteStackHeight(d)
  out.x = drawn.x
  out.y = drawn.y + lift
  out.z = drawn.z
  out.moved = true
  if (d >= MAX_RANGE) return
  const fadeIn = (now - born) / FADE_IN_SECONDS
  const fadeOut = (until - now) / FADE_OUT_SECONDS
  const person = e.fade === undefined ? 1 : e.fade * 2
  // the line of sight is tested in SIM space: your camera's sim position against the speaker's head (both sim)
  const hidden = walking && sightBlocked(camSim.x, camSim.y, camSim.z, anchor.x, anchor.y, anchor.z)
  const step = dt / SIGHT_FADE_SECONDS
  sight.seen = hidden ? Math.max(0, sight.seen - step) : Math.min(1, sight.seen + step)
  out.opacity = Math.min(1, fadeIn, fadeOut, person, sight.seen)
}
