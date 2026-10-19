/**
 * Speech bubbles over people: clean white cards with small system-font text and a tail toward the head.
 *
 * `useBubbles` (bubbleStore.ts) decides WHAT is said, at most 12 at a time. This component draws it: one drei <Html>
 * per bubble, with no React state per frame.
 *  - Each bubble's anchor group is moved in a frame callback at `FRAME_PRIORITY.labelAnchors`, before any <Html>
 *    projects (they project at priority 0), so the card never trails the person by a frame.
 *  - The projected position is snapped to whole device pixels (labelSnap.ts) so the text does not shimmer.
 *  - Fading, hiding and the card's offset are written straight to the DOM, and only when they change.
 *  - The anchor is the same one the emote icons use (headAnchor.ts); with an emote showing, the bubble sits above it.
 *  - In walk mode a bubble you cannot see the speaker's head for (a solid wall in between: sight.ts) fades out, and back in when
 *    you can.
 */
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { Group } from 'three'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { sim } from '@/sim'
import type { Entity, Vec3 } from '@/sim/types'
import { MAX_BUBBLES, bubbleClock, useBubbles, type Bubble } from './bubbleStore'
import { MAX_RANGE, emoteStackHeight } from './emoteMath'
import { headAnchor } from './headAnchor'
import { snappedLabelPosition } from './labelSnap'
import { sightBlocked } from './sight'

/** Seconds the card takes to fade in, and to fade out before it expires. */
const FADE_IN_SECONDS = 0.18
const FADE_OUT_SECONDS = 0.3
/** Gap between the anchor and the tail tip (metres). */
const GAP = 0.04
/** Height of the tail (CSS pixels). */
const TAIL = 6
/** Seconds a bubble takes to fade when a wall comes between you and the speaker, or goes. */
const SIGHT_FADE_SECONDS = 0.15
/** How often expired bubbles are swept out of the store. */
const PRUNE_SECONDS = 0.25

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

const CARD: CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  width: 'max-content',
  maxWidth: 200,
  padding: '6px 10px',
  borderRadius: 12,
  background: '#ffffff',
  color: '#1c2b2a',
  font: `500 13px/1.32 ${FONT}`,
  textAlign: 'center',
  overflowWrap: 'anywhere',
  userSelect: 'none',
  opacity: 0,
  boxShadow: '0 0 0 1px rgba(28, 43, 42, 0.07), 0 1px 2px rgba(28, 43, 42, 0.14), 0 6px 16px rgba(28, 43, 42, 0.13)',
}

const TAIL_STYLE: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: -TAIL,
  marginLeft: -TAIL,
  width: 0,
  height: 0,
  borderLeft: `${TAIL}px solid transparent`,
  borderRight: `${TAIL}px solid transparent`,
  borderTop: `${TAIL}px solid #ffffff`,
  filter: 'drop-shadow(0 2px 1px rgba(28, 43, 42, 0.1))',
}

const anchor: Vec3 = { x: 0, y: 0, z: 0 }

/** Mount once inside the canvas, next to <EmoteLayer />. `entities` defaults to the running hospital's people. */
export function SpeechBubbles({ entities }: { entities?: ReadonlyMap<string, Entity> }) {
  const source = entities ?? sim.entities
  const bubbles = useBubbles((s) => s.bubbles)
  const sincePrune = useRef(0)

  useFrame((_, dt) => {
    sincePrune.current += dt
    if (sincePrune.current < PRUNE_SECONDS) return
    sincePrune.current = 0
    useBubbles.getState().prune()
  })

  const shown = bubbles.length > MAX_BUBBLES ? bubbles.slice(bubbles.length - MAX_BUBBLES) : bubbles
  return (
    <>
      {shown.map((b) => (
        <BubbleAnchor key={b.id} bubble={b} entities={source} />
      ))}
    </>
  )
}

function BubbleAnchor({ bubble, entities }: { bubble: Bubble; entities: ReadonlyMap<string, Entity> }) {
  const group = useRef<Group>(null)
  const card = useRef<HTMLDivElement>(null)
  const lastOpacity = useRef(-1)
  /** 1 while you can see the speaker, 0 behind a wall, fading between. */
  const seen = useRef(1)

  useFrame((state, dt) => {
    const g = group.current
    const el = card.current
    if (!g || !el) return
    const e = entities.get(bubble.entityId)
    let opacity = 0
    if (e !== undefined) {
      headAnchor(e, anchor)
      const cam = state.camera.position
      const dx = anchor.x - cam.x
      const dy = anchor.y - cam.y
      const dz = anchor.z - cam.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const lift = e.emote === 'none' ? GAP : GAP + emoteStackHeight(d)
      g.position.set(anchor.x, anchor.y + lift, anchor.z)
      if (d < MAX_RANGE) {
        const now = bubbleClock()
        const fadeIn = (now - bubble.born) / FADE_IN_SECONDS
        const fadeOut = (bubble.until - now) / FADE_OUT_SECONDS
        const person = e.fade === undefined ? 1 : e.fade * 2
        // (walk mode, as the building sees it: walk/modeSwitch.ts)
        const mode = sim.player?.mode
        const hidden = mode !== undefined && mode !== 'overview' && sightBlocked(cam.x, cam.y, cam.z, anchor.x, anchor.y, anchor.z)
        const step = dt / SIGHT_FADE_SECONDS
        seen.current = hidden ? Math.max(0, seen.current - step) : Math.min(1, seen.current + step)
        opacity = Math.min(1, fadeIn, fadeOut, person, seen.current)
      }
    }
    // 2 % steps: the DOM is written only while the card is actually fading
    const q = opacity <= 0 ? 0 : Math.round(opacity * 50) / 50
    if (q === lastOpacity.current) return
    lastOpacity.current = q
    el.style.opacity = String(q)
    el.style.visibility = q === 0 ? 'hidden' : 'visible'
  }, FRAME_PRIORITY.labelAnchors)

  return (
    <group ref={group}>
      <Html zIndexRange={[0, 0]} calculatePosition={snappedLabelPosition} style={{ pointerEvents: 'none' }}>
        <BubbleCard text={bubble.text} cardRef={card} />
      </Html>
    </group>
  )
}

/** The card. After it is laid out, it is moved so its tail tip lands on the anchor, by whole pixels. */
function BubbleCard({ text, cardRef }: { text: string; cardRef: RefObject<HTMLDivElement | null> }) {
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    el.style.left = `${-Math.round(el.offsetWidth / 2)}px`
    el.style.top = `${-(el.offsetHeight + TAIL)}px`
  }, [text, cardRef])

  return (
    <div ref={cardRef} style={CARD}>
      {text}
      <span aria-hidden style={TAIL_STYLE} />
    </div>
  )
}
