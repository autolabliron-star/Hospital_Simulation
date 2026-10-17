/**
 * The walk-mode building (W1): what closes around you at eye level. Everything is built ONCE at mount, hidden, and shown by flipping
 * `visible` whenever the player's mode is not 'overview' (the flights between the two included): no rebuild, no recompile.
 *
 *   per chunk   upper walls and lintels (`wall`), door frames, handrails, guards and sign rods (`frame`), ceilings (tiles + light panels);
 *   once        the upper glazing (`glass`) and the hanging signs and door plates (one atlas, one mesh);
 *   doors       three instanced meshes (glass leaves, their frame bars, swing leaves), moved here every frame from the live `sim`.
 *
 * Nothing here casts into the baked sun shadow (castShadow stays false on every mesh), so `Lighting`'s bake stays valid, and nothing
 * receives it either (the map holds only the cut-height building). The overview-only meshes of BuildingMeshes (the parked sliding
 * leaves) swap with this group through `modeSwitch`.
 *
 * Frame callback: allocation-free, reads `sim` where it uses it (a Jump swaps the running hospital).
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Mesh, PlaneGeometry, type BufferGeometry, type Material, type Texture } from 'three'
import { MAT } from '@/scene/materials'
import { registerDimmable } from '@/scene/daylight/dim'
import { loop, sim } from '@/sim'
import { getLayout } from '../../layout'
import { buildWalkLayout } from '../../layout/walk'
import { BARS_PER_AUTO_LEAF, compileWalk, disposeWalk } from './walkGeometry'
import { DoorBank } from './doorBank'
import { writeAutoDoor, writeSwingDoor } from './doorMatrices'
import { isWalkMode, modeSwitch } from './modeSwitch'
import { packAtlas } from './signAtlas'
import { warmWalk, WARM_AFTER_FRAMES } from './warm'
import { CEILING_EMISSIVE, createWalkMaterials } from './walkMaterials'

/** After the camera and the sim, before the labels (0) and the draw: nothing here depends on either, it only reads them. */
const WALK_PRIORITY = -0.1

const unitPlane = new PlaneGeometry(1, 1)
const unitBox = new BoxGeometry(1, 1, 1)

function mesh(geometry: BufferGeometry, material: Material, name: string): Mesh {
  const m = new Mesh(geometry, material)
  m.name = name
  m.castShadow = false
  m.receiveShadow = false
  m.matrixAutoUpdate = false
  m.updateMatrix()
  return m
}

function instanced(geometry: BufferGeometry, material: Material, count: number, name: string): InstancedMesh {
  const m = new InstancedMesh(geometry, material, count)
  m.name = name
  m.castShadow = false
  m.receiveShadow = false
  // the leaves move: their bounds are the whole building, and there are only a few dozen of them
  m.frustumCulled = false
  m.instanceMatrix.setUsage(DynamicDrawUsage)
  return m
}

function buildWalkScene() {
  const layout = buildWalkLayout(getLayout())
  const packed = packAtlas(layout.tiles)
  const compiled = compileWalk(layout, packed)
  const mats = createWalkMaterials(packed, layout.tiles)

  const group = new Group()
  group.name = 'walk-building'
  group.visible = false

  for (const ch of compiled.chunks) {
    if (ch.wall) group.add(mesh(ch.wall, MAT.wall, `walk-wall-${ch.index}`))
    if (ch.frame) group.add(mesh(ch.frame, MAT.frame, `walk-frame-${ch.index}`))
    if (ch.ceiling) group.add(mesh(ch.ceiling, mats.ceiling, `walk-ceiling-${ch.index}`))
  }
  if (compiled.glass) {
    const glass = mesh(compiled.glass, MAT.glass, 'walk-glazing')
    glass.renderOrder = 3
    group.add(glass)
  }
  if (compiled.signs) group.add(mesh(compiled.signs, mats.signs, 'walk-signs'))

  // doors: bank index -> slot in its instanced mesh
  const autoDoors: number[] = []
  const swingDoors: number[] = []
  layout.doors.forEach((d, i) => (d.kind === 'auto' ? autoDoors : swingDoors).push(i))
  const glassLeaves = instanced(unitPlane, MAT.glass, Math.max(1, autoDoors.length * 2), 'walk-door-glass')
  glassLeaves.renderOrder = 3
  const bars = instanced(unitBox, MAT.frame, Math.max(1, autoDoors.length * 2 * BARS_PER_AUTO_LEAF), 'walk-door-bars')
  const leaves = instanced(unitBox, MAT.tinted, Math.max(1, swingDoors.length), 'walk-door-leaves')
  const tint = new Color()
  swingDoors.forEach((di, slot) => leaves.setColorAt(slot, tint.set(layout.doors[di].color)))
  glassLeaves.count = autoDoors.length * 2
  bars.count = autoDoors.length * 2 * BARS_PER_AUTO_LEAF
  leaves.count = swingDoors.length
  group.add(glassLeaves, bars, leaves)

  const bank = new DoorBank(layout.doors)
  const doors = layout.doors
  const glassArr = glassLeaves.instanceMatrix.array as Float32Array
  const barArr = bars.instanceMatrix.array as Float32Array
  const leafArr = leaves.instanceMatrix.array as Float32Array

  /** Write every leaf for the bank's current openings. */
  const writeDoors = (): void => {
    for (let slot = 0; slot < autoDoors.length; slot++) writeAutoDoor(glassArr, barArr, slot, doors[autoDoors[slot]], bank.shown[autoDoors[slot]])
    for (let slot = 0; slot < swingDoors.length; slot++) writeSwingDoor(leafArr, slot, doors[swingDoors[slot]], bank.shown[swingDoors[slot]])
    glassLeaves.instanceMatrix.needsUpdate = true
    bars.instanceMatrix.needsUpdate = true
    leaves.instanceMatrix.needsUpdate = true
  }
  writeDoors()

  const textures: Texture[] = mats.textures
  const dispose = (): void => {
    disposeWalk(compiled)
    mats.dispose()
    glassLeaves.dispose()
    bars.dispose()
    leaves.dispose()
  }
  return { group, bank, writeDoors, textures, mats, dispose, warm: { frames: 0, done: false } }
}

export function WalkBuilding() {
  const built = useMemo(buildWalkScene, [])

  useEffect(() => {
    modeSwitch.walk = built.group
    // the ceiling panels and the lit signs ease down with the rest of the room lights at night (src/scene/daylight/dim.ts)
    const ceiling = built.mats.ceiling
    const offCeiling = registerDimmable(
      {
        setScalar: (s: number) => {
          ceiling.emissiveIntensity = CEILING_EMISSIVE * s
        },
      },
      1,
      1,
    )
    const offSigns = registerDimmable(built.mats.signs.color, 1, 0.7)
    return () => {
      if (modeSwitch.walk === built.group) modeSwitch.walk = null
      offCeiling()
      offSigns()
      built.dispose()
    }
  }, [built])

  useFrame((state, dt) => {
    const walking = isWalkMode(sim.player?.mode)
    built.group.visible = walking
    if (modeSwitch.overview) modeSwitch.overview.visible = !walking
    // a few frames in, compile every walk-only program and upload the textures (once)
    if (!built.warm.done && ++built.warm.frames >= WARM_AFTER_FRAMES) {
      built.warm.done = true
      warmWalk(state.gl, state.scene, state.camera, built.textures)
    }
    if (!walking) return
    // sim time, so the doors keep up with the crowd at 2x and 4x; real time while paused, so the doors still open for YOU
    // (you are the `player` entity of the sim, or its view: the entrance slides open as you come up from the plaza)
    const step = Math.min(dt, 0.1) * (loop.paused ? 1 : Math.max(1, loop.speed))
    if (built.bank.update(step, sim.people, sim.entities.get('player')?.position ?? sim.player ?? null)) built.writeDoors()
  }, WALK_PRIORITY)

  return <primitive object={built.group} />
}
