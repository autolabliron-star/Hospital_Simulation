/**
 * The three.js side of the crowd, with no React in it: the meshes, geometries and materials of the seven draws, and the per-frame update
 * that points them at this frame's instances. CrowdRenderer.tsx mounts it; the budget tests build it in node and count.
 *
 * W3 wave B: the realistic people. `attachPeople` builds, inside the `people` group, one instanced mesh per avatar and LOD (near, mid, far) that
 * reads the same pose texture through the per-avatar instance lists of the model; every mesh is hidden while its list is empty, so the draws are
 * at most one per avatar and band on screen (a person in a dithered cross-fade is in two). `detachPeople` goes back to the procedural bodies.
 */
import {
  Color,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  RingGeometry,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
} from 'three'
import type { Entity } from '@/sim/types'
import { walkBody } from '@/scene/player/state'
import { BADGE_KIND, MAX_PEOPLE, RING_COLORS, TEX } from './constants'
import { buildBadgeGeometry, buildBlanketGeometry, buildPropGeometry, buildVehicleGeometry } from './gear'
import { buildBodyGeometries } from './geometry'
import { CrowdModel, MAX_BADGES, MAX_BLANKETS, MAX_BLOBS, MAX_PROPS, type FrameInput } from './model'
import { highlight } from './runtime'
import { createAvatarMaterials, createCrowdMaterials } from './shaders'
import type { LoadedPeople } from './avatarLoader'

/** The realistic people's draws: meshes[avatar][lod], in the order of the model's avatars. */
export interface PeopleMeshes {
  meshes: [Mesh, Mesh, Mesh][]
  /** The player's "You" badge on the realistic coat: the props material, its own one-kind geometry, hidden while nobody wears it. */
  badge: Mesh
  geometries: InstancedBufferGeometry[]
  materials: MeshStandardMaterial[]
  /** Bytes the avatars took to download (for the probe). */
  bytes: number
}

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
  /** The blankets of the patients lying in a bed or on a stretcher: the props material, its own one-kind geometry, hidden while nobody is covered. */
  blankets: Mesh
  blanketGeometry: InstancedBufferGeometry
  blobs: InstancedMesh
  blobFade: InstancedBufferAttribute
  ring: Mesh
  ringMaterial: MeshBasicMaterial
  ringColors: [Color, Color]
  objects: Object3D[]
  /** W3 wave B: the realistic people's meshes live in this group (mounted with the crowd, empty until attachPeople). */
  people: Group
  avatars: PeopleMeshes | null
  /** The material of the held items, which the realistic people's badge mesh shares (same program). */
  propsMaterial: MeshStandardMaterial
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
  const propsMaterial = mats.props

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

  // the blankets of the patients in beds: the props material (the same program), a geometry of the one kind, a row per covered patient
  const bg = buildBlanketGeometry().geometry
  bg.setAttribute('aRow', instancedAttr(model.blanketRows, 1))
  bg.setAttribute('aKind', instancedAttr(model.blanketKinds, 1))
  bg.setAttribute('aOff', instancedAttr(new Float32Array(MAX_BLANKETS), 1))
  const blankets = new Mesh(bg, mats.props)
  blankets.name = 'crowd-blankets'
  blankets.frustumCulled = false
  blankets.castShadow = false
  blankets.receiveShadow = true
  blankets.visible = false

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

  const people = new Group()
  people.name = 'crowd-people'

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
    blankets,
    blanketGeometry: bg,
    blobs,
    blobFade,
    ring,
    ringMaterial: mats.ring,
    ringColors: [new Color(RING_COLORS.selected), new Color(RING_COLORS.followed)],
    objects: [...bodies, props, vehicles, blankets, blobs, ring],
    people,
    avatars: null,
    propsMaterial,
    dispose() {
      detachPeople(this)
      mats.dispose()
      texture.dispose()
      for (const geo of bodyGeometries) geo.dispose()
      pg.dispose()
      vg.dispose()
      bg.dispose()
      quad.dispose()
      ringGeometry.dispose()
    },
  }
}

/**
 * W3 wave B: dress the crowd in the loaded realistic people. The model chooses everybody's avatar again; one mesh per avatar and LOD goes into
 * `r.people`, wrapping the loaded vertex buffers (shared with any other rig) with an instanced list of its own. Replaces an earlier attach.
 */
export function attachPeople(r: CrowdRig, loaded: LoadedPeople): PeopleMeshes {
  detachPeople(r)
  r.model.setAvatars(loaded.avatars.map((a) => a.entry))
  const L = r.model.avatarLists
  const geometries: InstancedBufferGeometry[] = []
  const materials: MeshStandardMaterial[] = []
  const meshes = loaded.avatars.map((a, i) => {
    const mats = createAvatarMaterials(r.texture, a.atlas, a.entry)
    materials.push(...mats)
    return [0, 1, 2].map((lod) => {
      const src = a.lods[lod]
      const geo = new InstancedBufferGeometry()
      geo.index = src.index
      for (const name of ['position', 'normal', 'uv', 'aJoints', 'aWeights']) geo.setAttribute(name, src.getAttribute(name))
      geo.setAttribute('aRow', instancedAttr(L.rows[lod][i], 1))
      geo.instanceCount = 0
      geometries.push(geo)
      const m = new Mesh(geo, mats[lod])
      m.name = `crowd-${a.entry.id}-${['high', 'mid', 'far'][lod]}`
      m.frustumCulled = false // as the procedural bodies: nobody is dropped because bounds were computed from a bind pose
      m.castShadow = false // people get blob shadows
      m.receiveShadow = true
      m.visible = false
      r.people.add(m)
      return m
    }) as unknown as [Mesh, Mesh, Mesh]
  })
  const bg = buildBadgeGeometry().geometry
  bg.setAttribute('aRow', instancedAttr(r.model.badgeRows, 1))
  bg.setAttribute('aKind', instancedAttr(new Float32Array(MAX_BADGES).fill(BADGE_KIND), 1))
  bg.setAttribute('aOff', instancedAttr(new Float32Array(MAX_BADGES), 1))
  geometries.push(bg)
  const badge = new Mesh(bg, r.propsMaterial)
  badge.name = 'crowd-you-badge'
  badge.frustumCulled = false
  badge.castShadow = false
  badge.receiveShadow = true
  badge.visible = false
  r.people.add(badge)
  r.avatars = { meshes, badge, geometries, materials, bytes: loaded.bytes }
  return r.avatars
}

/** Back to the procedural bodies: the people's meshes leave the group and their materials and wrapping geometries are disposed. */
export function detachPeople(r: CrowdRig): void {
  const pm = r.avatars
  if (!pm) return
  for (const row of pm.meshes) for (const m of row) r.people.remove(m)
  r.people.remove(pm.badge)
  for (const m of pm.materials) m.dispose()
  for (const g of pm.geometries) g.dispose()
  r.avatars = null
  r.model.setAvatars([])
}

/** Show the first `n` instances of an avatar mesh and upload just those rows of its list. */
function setAvatarInstances(mesh: Mesh, n: number): void {
  mesh.visible = n > 0
  const geo = mesh.geometry as InstancedBufferGeometry
  geo.instanceCount = n
  if (n === 0) return
  const attr = geo.getAttribute('aRow') as InstancedBufferAttribute
  attr.clearUpdateRanges()
  attr.addUpdateRange(0, n)
  attr.needsUpdate = true
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
  r.blankets.visible = st.blankets > 0
  setInstances(r.blanketGeometry, st.blankets, 'aRow')
  r.blobs.count = st.blobs
  r.blobs.instanceMatrix.needsUpdate = true
  r.blobFade.needsUpdate = true
  const pm = r.avatars
  if (pm) {
    const counts = model.avatarLists.counts
    for (let i = 0; i < pm.meshes.length; i++) {
      const row = pm.meshes[i]
      setAvatarInstances(row[0], counts[0][i])
      setAvatarInstances(row[1], counts[1][i])
      setAvatarInstances(row[2], counts[2][i])
    }
    setAvatarInstances(pm.badge, st.badges)
  }
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

