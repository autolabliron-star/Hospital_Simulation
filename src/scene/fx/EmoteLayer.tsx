/**
 * Emote icons over people's heads: ONE draw call for all of them.
 *
 * A single instanced quad. Per instance it carries the world position and size of the icon, its atlas rect and its
 * opacity (all filled by `EmoteTracker`, typed arrays only). The vertex shader billboards the quad toward the camera,
 * so no matrix or quaternion is built on the CPU. In the overview icons draw on top of walls (no depth test) so a patient
 * behind a 1.3 m wall still shows their icon, in the last transparent slot of the frame. In walk mode the walls are full height
 * and the depth test is on: a person in the next room is hidden and so is their icon (glass writes no depth, so people seen
 * through glass keep theirs). Switching it is GL state only: nothing recompiles.
 *
 * The frame callback runs at `FRAME_PRIORITY.labelAnchors`: after every camera write and before the draw, so icons do
 * not trail the camera.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { sim } from '@/sim'
import { isWalking, realismActive } from '@/ui/walk/realism.store'
import type { Entity } from '@/sim/types'
import { createEmoteAtlas } from './emoteAtlas'
import { EmoteTracker } from './emoteState'

const VERTEX = /* glsl */ `
attribute vec4 aPosSize;
attribute vec4 aUvRect;
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = aUvRect.xy + uv * aUvRect.zw;
  vAlpha = aAlpha;
  vec4 mv = viewMatrix * vec4(aPosSize.xyz, 1.0);
  mv.xy += position.xy * aPosSize.w;
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 texel = texture2D(map, vUv);
  float a = texel.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(texel.rgb, a);
  #include <colorspace_fragment>
}
`

/** Everything the layer owns: the tracker, the geometry, the material, the atlas and the single mesh. */
export class EmoteRig {
  readonly tracker: EmoteTracker
  readonly mesh: Mesh
  private readonly geometry = new InstancedBufferGeometry()
  private readonly material: ShaderMaterial
  private readonly atlas = createEmoteAtlas()
  private readonly attributes: InstancedBufferAttribute[]

  constructor(entities: ReadonlyMap<string, Entity>) {
    const tracker = (this.tracker = new EmoteTracker(entities))
    const quad = new PlaneGeometry(1, 1)
    this.geometry.index = quad.index
    this.geometry.setAttribute('position', quad.getAttribute('position'))
    this.geometry.setAttribute('uv', quad.getAttribute('uv'))
    const posSize = new InstancedBufferAttribute(tracker.posSize, 4).setUsage(DynamicDrawUsage)
    const uvRect = new InstancedBufferAttribute(tracker.uvRect, 4).setUsage(DynamicDrawUsage)
    const alpha = new InstancedBufferAttribute(tracker.alphaOut, 1).setUsage(DynamicDrawUsage)
    this.attributes = [posSize, uvRect, alpha]
    this.geometry.setAttribute('aPosSize', posSize)
    this.geometry.setAttribute('aUvRect', uvRect)
    this.geometry.setAttribute('aAlpha', alpha)
    this.geometry.instanceCount = 0

    this.material = new ShaderMaterial({
      uniforms: { map: { value: this.atlas } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })

    const mesh = (this.mesh = new Mesh(this.geometry, this.material))
    mesh.name = 'emote-icons'
    mesh.frustumCulled = false
    mesh.renderOrder = 10
    mesh.visible = false
    mesh.matrixAutoUpdate = false
    mesh.raycast = () => {} // never picked
  }

  /** One frame: advance the icons and upload what changed. With nobody emoting the mesh is hidden: no draw call. */
  frame(dt: number, cx: number, cy: number, cz: number, walking: boolean, hidden = false): void {
    // realism mode: no icons at all, and no tracker work either
    if (hidden) {
      this.mesh.visible = false
      return
    }
    this.material.depthTest = walking
    const n = this.tracker.update(dt, cx, cy, cz)
    this.geometry.instanceCount = n
    this.mesh.visible = n > 0
    if (n === 0) return
    for (const a of this.attributes) a.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.atlas.dispose()
  }
}

/** Mount once inside the canvas. `entities` defaults to the running hospital's people. */
export function EmoteLayer({ entities }: { entities?: ReadonlyMap<string, Entity> }) {
  const source = entities ?? sim.entities
  const rig = useMemo(() => new EmoteRig(source), [source])
  useEffect(() => () => rig.dispose(), [rig])

  useFrame((state, dt) => {
    const p = state.camera.position
    // (walk mode as the building sees it, walk/modeSwitch.ts: any mode but the overview, the flights between the two included)
    const mode = sim.player?.mode
    rig.frame(dt, p.x, p.y, p.z, isWalking(mode), realismActive(mode))
  }, FRAME_PRIORITY.labelAnchors)

  return <primitive object={rig.mesh} />
}
