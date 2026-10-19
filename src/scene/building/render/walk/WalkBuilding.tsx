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
 * Two frame callbacks, both allocation-free, both reading `sim` where they use it (a Jump swaps the running hospital):
 *   FRAME_PRIORITY.doors (-11, walk mode only)  the doors sense (people, and YOU along the way you are going: W3), step their openings
 *                         and publish their leaves as solid boxes (src/scene/blockers.ts), before the player moves against them. The
 *                         swing doors are double-acting: a shut one swings away from whoever sets it off (`DoorBank.swing`), and
 *                         the drawn leaf and the solid box are both written from that one direction;
 *   -0.1                  the visibility, the one-off warm-up, and the leaf matrices (only when an opening changed).
 *
 * R2: one `WalkBuilding` per level. `<WalkBuilding />` is level 1, at the scene root, shown while walking on level 1; `<WalkBuilding level={2} />` is
 * level 2's upper walls, lintels, ceilings, signs and door leaves, in sim coordinates, mounted inside the level-2 group (`Level2Building`, translated
 * by (-150, +4.2, 0)), shown while walking on level 2. The two share one set of materials and one sign atlas (the first to mount makes them, the last to
 * unmount disposes them) and each has its own door bank: only the bank of the level you are on steps, senses and publishes blockers (the people and you
 * are sensed in sim coordinates, which is where level 2's doors are too; nothing is ever mapped here).
 */
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Mesh, PlaneGeometry, type BufferGeometry, type Material } from 'three'
import { registerBlockers, type BlockerSource } from '@/scene/blockers'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { levelView } from '@/scene/levels/levelView'
import { MAT } from '@/scene/materials'
import { registerDimmable } from '@/scene/daylight/dim'
import { walkBody } from '@/scene/player/state'
import { loop, sim } from '@/sim'
import { CONFIG } from '@/sim/config'
import { levelOf, type LevelId } from '@/sim/levels'
import { getLayout } from '../../layout'
import { buildWalkLayout, walkLayoutOfLevel, type WalkLayout } from '../../layout/walk'
import { BUILDING_VISIBILITY_PRIORITY, level1WalkVisible, level2WalkVisible } from '../levelVisibility'
import { BARS_PER_AUTO_LEAF, compileWalk, disposeWalk } from './walkGeometry'
import { DoorBank, newLead, setLead } from './doorBank'
import { leafBlockerCount, writeAutoDoor, writeLeafBlockers, writeSwingDoor } from './doorMatrices'
import { isWalkMode, modeSwitch } from './modeSwitch'
import { packAtlas, type PackedAtlas } from './signAtlas'
import { warmWalk, WARM_AFTER_FRAMES } from './warm'
import { CEILING_EMISSIVE, createWalkMaterials, type WalkMaterials } from './walkMaterials'

/** After the camera and the sim (and the levels frame), before the labels (0) and the draw: nothing here depends on either, it only reads them. */
const WALK_PRIORITY = BUILDING_VISIBILITY_PRIORITY

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

/** What both levels share: the whole walk layout, the sign atlas and the two materials (ceiling and signs), made once. */
interface WalkShared {
  layout: WalkLayout
  packed: PackedAtlas
  mats: WalkMaterials
  warm: { frames: number; done: boolean }
  users: number
}

let shared: WalkShared | null = null

function acquireShared(): WalkShared {
  if (!shared) {
    const layout = buildWalkLayout(getLayout())
    const packed = packAtlas(layout.tiles)
    shared = { layout, packed, mats: createWalkMaterials(packed, layout.tiles), warm: { frames: 0, done: false }, users: 0 }
  }
  shared.users++
  return shared
}

function releaseShared(): void {
  if (!shared) return
  shared.users = Math.max(0, shared.users - 1)
  if (shared.users === 0) {
    shared.mats.dispose()
    shared = null
  }
}

function buildWalkScene(level: LevelId) {
  const sh = acquireShared()
  const layout = walkLayoutOfLevel(sh.layout, level)
  const compiled = compileWalk(layout, sh.packed)
  const mats = sh.mats

  const group = new Group()
  group.name = level === 1 ? 'walk-building' : 'walk-building-l2'
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
    for (let slot = 0; slot < swingDoors.length; slot++) writeSwingDoor(leafArr, slot, doors[swingDoors[slot]], bank.shown[swingDoors[slot]], bank.swing[swingDoors[slot]])
    glassLeaves.instanceMatrix.needsUpdate = true
    bars.instanceMatrix.needsUpdate = true
    leaves.instanceMatrix.needsUpdate = true
  }
  writeDoors()

  const dispose = (): void => {
    disposeWalk(compiled)
    glassLeaves.dispose()
    bars.dispose()
    leaves.dispose()
    releaseShared()
  }
  // the leaves as solid boxes for your body (rewritten every frame in walk mode, count 0 in the overview)
  const blockers: BlockerSource = { name: level === 1 ? 'walk doors' : 'walk doors (level 2)', count: 0, data: new Float64Array(leafBlockerCount(doors) * 6) }
  return { level, group, bank, doors, blockers, lead: newLead(), writeDoors, shared: sh, mats, dispose, pendingWrite: false, wasWalking: false }
}

export function WalkBuilding({ level = 1 }: { level?: LevelId }) {
  const built = useMemo(() => buildWalkScene(level), [level])

  useEffect(() => {
    if (level === 1) modeSwitch.walk = built.group
    // the ceiling panels and the lit signs ease down with the rest of the room lights at night (src/scene/daylight/dim.ts); they are shared, so level 1 registers them
    const offs: (() => void)[] = []
    if (level === 1) {
      const ceiling = built.mats.ceiling
      offs.push(
        registerDimmable(
          {
            setScalar: (s: number) => {
              ceiling.emissiveIntensity = CEILING_EMISSIVE * s
            },
          },
          1,
          1,
        ),
        registerDimmable(built.mats.signs.color, 1, 0.7),
      )
    }
    const offBlockers = registerBlockers(built.blockers)
    return () => {
      if (modeSwitch.walk === built.group) modeSwitch.walk = null
      for (const off of offs) off()
      offBlockers()
      built.blockers.count = 0
      built.dispose()
    }
  }, [built, level])

  // Before you move (after the sim, which moves the people the doors sense): the doors open for whoever is coming, step, and publish
  // their leaves. Walk mode only: the overview publishes no blockers.
  useFrame((_, dt) => {
    // sim time, so the doors keep up with the crowd at 2x and 4x; real time while paused, so the doors still open for YOU
    // (you are the `player` entity of the sim, or its view: the entrance slides open as you come up from the plaza)
    const step = Math.min(dt, 0.1) * (loop.paused ? 1 : Math.max(1, loop.speed))
    const you = sim.entities.get('player')?.position ?? sim.player ?? null
    // R2: only the doors of the level you are walking on step (and publish blockers): your level is the one your sim position is in
    if (!isWalkMode(sim.player?.mode) || levelOf(you?.x ?? 0) !== built.level) {
      built.blockers.count = 0
      built.wasWalking = false
      return
    }
    // you sense the doors along the way your body is going (CONFIG.player.doorLeadSeconds ahead): an auto door opens about 5 m out at a
    // run, so its leaves, which are solid, are open when you get there. Until the player has written `walkBody` there is no lead.
    const lead = walkBody.live ? setLead(built.lead, walkBody.vx, walkBody.vz, walkBody.wishX, walkBody.wishZ, CONFIG.player.doorLeadSeconds) : null
    // Tab into a doorway: the doors around you open at once, so you are never inside a leaf that was shut while the overview ran
    if (!built.wasWalking && you && built.bank.snapOpenNear(you, lead)) built.pendingWrite = true
    built.wasWalking = true
    if (built.bank.update(step, sim.people, you, lead)) built.pendingWrite = true
    built.blockers.count = writeLeafBlockers(built.doors, built.bank.shown, built.blockers.data, built.bank.swing)
  }, FRAME_PRIORITY.doors)

  useFrame((state) => {
    const walking = isWalkMode(sim.player?.mode)
    const visible = built.level === 1 ? level1WalkVisible(walking, levelView.shown) : level2WalkVisible(walking, levelView.shown)
    built.group.visible = visible
    if (built.level === 1 && modeSwitch.overview) modeSwitch.overview.visible = !walking
    // a few frames in (level 1 counts them), compile every walk-only program and upload the textures (once, for both levels: level 2's group is in the
    // scene too, hidden, and the warm-up walks the whole tree)
    const warm = built.shared.warm
    if (built.level === 1 && !warm.done && ++warm.frames >= WARM_AFTER_FRAMES) {
      warm.done = true
      warmWalk(state.gl, state.scene, state.camera, built.mats.textures)
    }
    // the leaves move only when an opening did (the doors stepped at FRAME_PRIORITY.doors, a few callbacks earlier)
    if (visible && built.pendingWrite) {
      built.pendingWrite = false
      built.writeDoors()
    }
  }, WALK_PRIORITY)

  return <primitive object={built.group} />
}
