/**
 * The contact-shadow layer (realism step 2): ONE instanced draw for every soft floor shadow a feature registered (./registry.ts: the imaging
 * machines, the authored building's movable kit, ...). Mounted once by <Lighting />, at load, with no instance drawn, so the warm-up compiles its
 * program (shared with the crowd's and the meal bots' shadows: ./material.ts) before Enter. Every frame the sources write into a preallocated
 * buffer and only the written rows are uploaded; nothing is allocated.
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PlaneGeometry, type BufferAttribute } from 'three'
import { createContactShadowMaterial } from './material'
import { ContactBuffer, MAX_CONTACT, writeContacts } from './registry'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'

/**
 * After every layer that moves something standing on the floor (the imaging machines at -0.25, the kiosks, the lab, ...) and before the draw.
 * Listed in src/scene/camera/frameOrder.ts as `contactShadows`. The crowd and the pods run at 0 and keep their own.
 */
export const CONTACT_SHADOW_PRIORITY = FRAME_PRIORITY.contactShadows

type Range = { start: number; count: number }

/** Upload only the first `count` values of an attribute (reusing one range object: no allocation). */
function uploadFirst(attr: BufferAttribute, range: Range, count: number): void {
  range.start = 0
  range.count = count
  const ranges = attr.updateRanges
  ranges.length = 0
  ranges.push(range)
  attr.needsUpdate = true
}

export interface ContactLayer {
  mesh: InstancedMesh
  buf: ContactBuffer
  /** One frame: ask the sources, upload what they wrote. Returns the count. */
  step: () => number
  dispose: () => void
}

/** The layer without React (node tests drive `step`). */
export function createContactLayer(max = MAX_CONTACT): ContactLayer {
  const buf = new ContactBuffer(max)
  const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const fade = new InstancedBufferAttribute(buf.fade, 1).setUsage(DynamicDrawUsage)
  const shape = new InstancedBufferAttribute(buf.shape, 4).setUsage(DynamicDrawUsage)
  geometry.setAttribute('aFade', fade)
  geometry.setAttribute('aShape', shape)
  const material = createContactShadowMaterial(1)
  const mesh = new InstancedMesh(geometry, material, max)
  mesh.instanceMatrix = new InstancedBufferAttribute(buf.matrix, 16).setUsage(DynamicDrawUsage)
  mesh.name = 'contact-shadows'
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 1
  const ranges = { matrix: { start: 0, count: 0 }, fade: { start: 0, count: 0 }, shape: { start: 0, count: 0 } }
  return {
    mesh,
    buf,
    step() {
      const n = writeContacts(buf)
      mesh.count = n
      if (n > 0) {
        uploadFirst(mesh.instanceMatrix, ranges.matrix, n * 16)
        uploadFirst(fade, ranges.fade, n)
        uploadFirst(shape, ranges.shape, n * 4)
      }
      return n
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

export function ContactShadows() {
  const layer = useMemo(() => createContactLayer(), [])
  useEffect(() => () => layer.dispose(), [layer])
  useFrame(() => {
    layer.step()
  }, CONTACT_SHADOW_PRIORITY)
  return <primitive object={layer.mesh} dispose={null} />
}
