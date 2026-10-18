/**
 * The MealBot meshes and the per-frame update, with no React: `createMealBotsRig()` builds one InstancedMesh per part (static body
 * with the tray cabinet, shutter, light ring, blob shadow), at most `MAX_BOTS` instances, and `step` poses them from
 * `LivingDayView.mealBots` (pose and `fade` already interpolated by the sim). The layer (MealBotsLayer.tsx) only mounts the group and
 * calls `step` once a frame, so the node tests drive the very same code.
 *
 *   - fade: a per-instance dither fade (`aFade`, see ditherFade.ts) in and out at the service lift, never a pop;
 *   - shutter: `MealBot.door` smoothed a little, drawn by scaling the panel in y about its top edge;
 *   - light ring: `MealBot.light` (white / peach / amber); amber pulses softly while the bot waits, like the pods' ring;
 *   - shadow: a soft blob, because moving things do not cast into the baked sun shadow.
 * Bots in the 'offsite' state (downstairs in the kitchen) are not drawn. The shelf trays belong to the trays rig.
 * With no bot on the ward each mesh keeps ONE zero-size "keeper" instance, so its shader program is compiled with the first frame
 * and the first meal run never hitches on a compile (the draw costs nothing: no pixels).
 * Nothing is allocated in `step`: scratch objects live at module level, the per-bot callback is built once.
 */
import { Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D } from 'three'
import { MAT, STATUS } from '@/scene/materials'
import type { LivingDayView, MealBot, MealBotLight } from '@/sim/types'
import { botDoorGeometry, botRingGeometry, botShadowGeometry, botStaticGeometry, DOOR_ORIGIN } from './botParts'
import { createBlobMaterial } from './blob'
import { patchMaterialLook } from '@/scene/lighting/palettePatch'
import { emissiveFollowsInstanceColor, FADE_ATTRIBUTE, fadeMaterial } from './ditherFade'
import { hideAll, primeColors } from './instancing'
import { MAX_BOTS } from './life'
import { PEACH } from './palette'

const N = MAX_BOTS

/** Status colours pushed above 1 so the ring blooms, like the pods' ring; the empty ring is calmer. */
export const RING_COLORS: Readonly<Record<MealBotLight, Color>> = {
  white: new Color(STATUS.idle).multiplyScalar(0.85),
  peach: new Color(PEACH.light).multiplyScalar(1.6),
  amber: new Color(STATUS.amber).multiplyScalar(1.7),
}
const RING_KIND: Record<MealBotLight, number> = { white: 0, peach: 1, amber: 2 }
const AMBER = RING_KIND.amber

/** The shutter keeps this much of its height when fully open (a lip stays in the header). */
export const DOOR_OPEN_SCALE = 0.04
/** How quickly the drawn shutter follows `MealBot.door` (per second). */
const DOOR_RATE = 14

const dummy = new Object3D()
const ZERO = new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
const botMatrix = new Matrix4()
const doorLocal = new Matrix4()
const doorWorld = new Matrix4()
const ringTmp = new Color()

export interface MealBotsRig {
  group: Group
  statics: InstancedMesh
  door: InstancedMesh
  ring: InstancedMesh
  shadow: InstancedMesh
  /** Bots drawn this frame. */
  drawn(): number
  step(life: LivingDayView | null, dt: number, time: number): void
  dispose(): void
}

export function createMealBotsRig(): MealBotsRig {
  const fadeAttr = new InstancedBufferAttribute(new Float32Array(N), 1)
  const geos = { statics: botStaticGeometry(), door: botDoorGeometry(), ring: botRingGeometry(), shadow: botShadowGeometry() }
  for (const g of Object.values(geos)) g.setAttribute(FADE_ATTRIBUTE, fadeAttr)
  // clones of the palette materials (never the shared ones, whose programs every other mesh uses), patched to read the fade
  const bodyMat = fadeMaterial(new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0 }), 'dither', 'mealbot-body')
  // the emissive follows the instance colour (three does not multiply them), like MAT.tintedGlow, then the fade patch
  const ringMat = fadeMaterial(emissiveFollowsInstanceColor(MAT.tintedGlow.clone()), 'dither', 'mealbot-ring')
  ringMat.emissiveIntensity = 0.9
  // W3: lit like the palette around them (the baked light volume), composed after the fade patch
  patchMaterialLook(bodyMat, 'plain')
  patchMaterialLook(ringMat, 'plain')
  const shadowMat = fadeMaterial(createBlobMaterial(), 'alpha', 'mealbot-shadow')

  const statics = new InstancedMesh(geos.statics, bodyMat, N)
  const door = new InstancedMesh(geos.door, bodyMat, N)
  const ring = new InstancedMesh(geos.ring, ringMat, N)
  const shadow = new InstancedMesh(geos.shadow, shadowMat, N)
  shadow.renderOrder = 2
  const group = new Group()
  group.name = 'mealbots'
  for (const m of [shadow, statics, door, ring]) {
    m.frustumCulled = false
    group.add(m)
  }
  // instance colours before the first draw, so no shader recompiles later; every instance hidden until a bot arrives
  primeColors(ring, RING_COLORS.white)
  for (const m of [statics, door, ring, shadow]) {
    hideAll(m)
    m.count = 1
  }

  const doorShown = new Float32Array(N)
  const ringKind = new Int8Array(N).fill(-1)
  const f = { n: 0, dt: 0, time: 0 }
  const st = { keeper: true }

  const visit = (bot: MealBot): void => {
    if (f.n >= N || bot.state === 'offsite' || bot.fade <= 0.001) return
    const i = f.n++
    dummy.position.set(bot.position.x, bot.position.y, bot.position.z)
    dummy.rotation.set(0, bot.heading, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    botMatrix.copy(dummy.matrix)
    statics.setMatrixAt(i, botMatrix)
    ring.setMatrixAt(i, botMatrix)
    shadow.setMatrixAt(i, botMatrix)
    // the shutter, hinged at its top edge: scale about it
    const shown = doorShown[i] + (bot.door - doorShown[i]) * (1 - Math.exp(-f.dt * DOOR_RATE))
    doorShown[i] = shown < 0.002 ? 0 : shown > 0.998 ? 1 : shown
    doorLocal.makeScale(1, 1 - (1 - DOOR_OPEN_SCALE) * doorShown[i], 1)
    doorLocal.setPosition(0, DOOR_ORIGIN.y, DOOR_ORIGIN.z)
    doorWorld.multiplyMatrices(botMatrix, doorLocal)
    door.setMatrixAt(i, doorWorld)
    fadeAttr.array[i] = bot.fade
    // the light ring: the colour is written only when it changes (amber pulses while the bot waits)
    const kind = RING_KIND[bot.light]
    if (ringKind[i] !== kind || kind === AMBER) {
      ringKind[i] = kind
      if (kind === AMBER) ring.setColorAt(i, ringTmp.copy(RING_COLORS.amber).multiplyScalar(0.5 + 0.7 * (0.55 + 0.45 * Math.sin(f.time * 5))))
      else ring.setColorAt(i, RING_COLORS[bot.light])
      if (ring.instanceColor) ring.instanceColor.needsUpdate = true
    }
  }

  return {
    group,
    statics,
    door,
    ring,
    shadow,
    drawn: () => f.n,
    step(life, dt, time) {
      f.n = 0
      f.dt = Math.min(dt, 0.1)
      f.time = time
      if (life) life.mealBots.forEach(visit)
      const n = f.n
      if (n === 0) {
        // the keeper: one zero-size instance, written once when the last bot leaves
        if (st.keeper) return
        st.keeper = true
        for (const m of [statics, door, ring, shadow]) {
          m.count = 1
          m.setMatrixAt(0, ZERO)
          m.instanceMatrix.needsUpdate = true
        }
        return
      }
      st.keeper = false
      statics.count = door.count = ring.count = shadow.count = n
      statics.instanceMatrix.needsUpdate = true
      door.instanceMatrix.needsUpdate = true
      ring.instanceMatrix.needsUpdate = true
      shadow.instanceMatrix.needsUpdate = true
      fadeAttr.needsUpdate = true
    },
    dispose() {
      for (const g of Object.values(geos)) g.dispose()
      bodyMat.dispose()
      ringMat.dispose()
      shadowMat.map?.dispose()
      shadowMat.dispose()
    },
  }
}
