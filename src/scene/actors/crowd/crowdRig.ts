/**
 * The three.js side of the crowd, with no React in it: the meshes, geometries and materials of the seven draws, and the per-frame update
 * that points them at this frame's instances. CrowdRenderer.tsx mounts it; the budget tests build it in node and count.
 */
import {
  Color,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  RingGeometry,
  type InstancedBufferGeometry,
  type MeshBasicMaterial,
  type Object3D,
} from 'three'
import type { Entity } from '@/sim/types'
import { walkBody } from '@/scene/player/state'
import { MAX_PEOPLE, RING_COLORS, TEX } from './constants'
import { buildPropGeometry, buildVehicleGeometry } from './gear'
import { buildBodyGeometries } from './geometry'
import { CrowdModel, MAX_BLOBS, MAX_PROPS, type FrameInput } from './model'
import { highlight } from './runtime'
import { createCrowdMaterials } from './shaders'

export interface CrowdRig {
  model: CrowdModel
  texture: DataTexture
  frame: FrameInput
  bodies: Mesh[]
  bodyGeometries: InstancedBufferGeometry[]
  props: Mesh
  propGeometry: InstancedBufferGeometry
  vehicles: Mesh
  vehicleGeometry: InstancedBufferGeometry
  blobs: InstancedMesh
  blobFade: InstancedBufferAttribute
  ring: Mesh
  ringMaterial: MeshBasicMaterial
  ringColors: [Color, Color]
  objects: Object3D[]
  dispose: () => void
}

function instancedAttr(array: Float32Array, itemSize: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(array, itemSize)
  a.setUsage(DynamicDrawUsage)
  return a
}

export function createCrowdRig(): CrowdRig {
  const model = new CrowdModel()
  const texture = new DataTexture(model.data, TEX.width, MAX_PEOPLE, RGBAFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  const mats = createCrowdMaterials(texture)

  // the three bodies
  const g = buildBodyGeometries()
  const bodyGeometries = [g.high, g.mid, g.far]
  const lists = [model.rowsHigh, model.rowsMid, model.rowsFar]
  const bodies = bodyGeometries.map((geo, i) => {
    geo.setAttribute('aRow', instancedAttr(lists[i], 1))
    const m = new Mesh(geo, mats.body[i])
    m.name = `crowd-${['high', 'mid', 'far'][i]}`
    m.frustumCulled = false // nobody may ever be dropped because bounds were computed from a bind pose
    m.castShadow = false // people get blob shadows; the building's shadow map is baked once
    m.receiveShadow = true
    return m
  })

  // props and vehicles: one merged mesh each, every instance picks its kind
  const zeros = new Float32Array(MAX_PROPS)
  const pg = buildPropGeometry().geometry
  pg.setAttribute('aRow', instancedAttr(model.propRows, 1))
  pg.setAttribute('aKind', instancedAttr(model.propKinds, 1))
  pg.setAttribute('aOff', instancedAttr(zeros, 1))
  const props = new Mesh(pg, mats.props)
  props.name = 'crowd-props'
  props.frustumCulled = false
  props.castShadow = false
  props.receiveShadow = true

  const vg = buildVehicleGeometry().geometry
  vg.setAttribute('aRow', instancedAttr(model.vehRows, 1))
  vg.setAttribute('aKind', instancedAttr(model.vehKinds, 1))
  vg.setAttribute('aOff', instancedAttr(model.vehOffs, 1))
  const vehicles = new Mesh(vg, mats.vehicles)
  vehicles.name = 'crowd-vehicles'
  vehicles.frustumCulled = false
  vehicles.castShadow = false
  vehicles.receiveShadow = true

  // blob shadows: a unit quad on the floor, a matrix and a fade per instance written by the model
  const quad = new PlaneGeometry(1, 1)
  quad.rotateX(-Math.PI / 2)
  const blobFade = instancedAttr(model.blobFade, 1)
  quad.setAttribute('aFade', blobFade)
  const blobs = new InstancedMesh(quad, mats.blob, MAX_BLOBS)
  blobs.instanceMatrix = instancedAttr(model.blobMatrix, 16)
  blobs.name = 'crowd-blobs'
  blobs.count = 0
  blobs.frustumCulled = false
  blobs.castShadow = false
  blobs.receiveShadow = false
  blobs.renderOrder = 1

  // the selection ring
  const ringGeometry = new RingGeometry(0.5, 0.6, 48)
  ringGeometry.rotateX(-Math.PI / 2)
  const ring = new Mesh(ringGeometry, mats.ring)
  ring.name = 'crowd-ring'
  ring.visible = false
  ring.frustumCulled = false
  ring.renderOrder = 2

  const frame: FrameInput = { dt: 0, time: 0, camX: 0, camY: 0, camZ: 0, entities: new Map<string, Entity>(), followId: null, selectedId: null, hoverId: null, driven: null }

  return {
    model,
    texture,
    frame,
    bodies,
    bodyGeometries,
    props,
    propGeometry: pg,
    vehicles,
    vehicleGeometry: vg,
    blobs,
    blobFade,
    ring,
    ringMaterial: mats.ring,
    ringColors: [new Color(RING_COLORS.selected), new Color(RING_COLORS.followed)],
    objects: [...bodies, props, vehicles, blobs, ring],
    dispose() {
      mats.dispose()
      texture.dispose()
      for (const geo of bodyGeometries) geo.dispose()
      pg.dispose()
      vg.dispose()
      quad.dispose()
      ringGeometry.dispose()
    },
  }
}

/** Point a draw at the first `n` instances and re-upload its (small) per-instance lists. */
function setInstances(geo: InstancedBufferGeometry, n: number, a: string, b?: string, c?: string): void {
  geo.instanceCount = n
  ;(geo.getAttribute(a) as InstancedBufferAttribute).needsUpdate = true
  if (b) (geo.getAttribute(b) as InstancedBufferAttribute).needsUpdate = true
  if (c) (geo.getAttribute(c) as InstancedBufferAttribute).needsUpdate = true
}

/** One frame of the crowd. Everything it touches is preallocated. */
export function driveCrowd(r: CrowdRig, entities: ReadonlyMap<string, Entity>, camX: number, camY: number, camZ: number, delta: number, time: number): void {
  const f = r.frame
  f.dt = delta
  f.time = time
  f.camX = camX
  f.camY = camY
  f.camZ = camZ
  f.entities = entities
  f.followId = highlight.followId
  f.selectedId = highlight.selectedId
  f.hoverId = highlight.hoverId
  // W3: your legs are planned from your true body (the player system writes it at priority -10, before this runs at 0 in the same frame); until the
  // player system is live `walkBody.live` is false and the model measures you like everybody else
  f.driven = walkBody
  const model = r.model
  model.update(f)
  const st = model.stats

  setInstances(r.bodyGeometries[0], st.high, 'aRow')
  setInstances(r.bodyGeometries[1], st.mid, 'aRow')
  setInstances(r.bodyGeometries[2], st.far, 'aRow')
  setInstances(r.propGeometry, st.props, 'aRow', 'aKind')
  setInstances(r.vehicleGeometry, st.vehicles, 'aRow', 'aKind', 'aOff')
  r.blobs.count = st.blobs
  r.blobs.instanceMatrix.needsUpdate = true
  r.blobFade.needsUpdate = true
  r.texture.needsUpdate = true

  // the ground ring: under the followed person, else the selected one
  const id = highlight.followId ?? highlight.selectedId
  const p = id ? model.get(id) : undefined
  const ring = r.ring
  if (p && !p.ghost && p.presence > 0.01) {
    ring.visible = true
    const followed = id === highlight.followId
    r.ringMaterial.color.copy(r.ringColors[followed ? 1 : 0])
    const pulse = 1 + 0.05 * Math.sin(time * 3)
    ring.position.set(p.x, p.y + 0.045, p.z)
    ring.scale.setScalar((followed ? 1.12 : 1) * pulse * Math.max(1, p.dist / 90))
  } else ring.visible = false
}

