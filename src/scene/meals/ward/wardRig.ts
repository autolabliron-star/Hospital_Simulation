/**
 * The live parts of the 16 ward rooms (L1), with no React: three InstancedMeshes (3 draw calls), all driven from
 * `LivingDayView.rooms` by `step`. The layer (WardLayer.tsx) only mounts the group and calls `step` once a frame, so the node tests
 * run the same code.
 *
 *   backrests      the head section of each bed with its pillow, tilted about the waist hinge with `RoomStatus.recline`. The sim's number
 *                  is followed at the speed of `CONFIG.meals.reclineSeconds` in SIM time (so it freezes with the pause and goes faster
 *                  at 2x and 4x), and the drawn value is published to src/scene/rooms/bedPose.ts so a reclined patient's torso, and the
 *                  emote anchors, follow the very same angle. A Jump snaps.
 *   door tiles     a thin plate in each doorway, lit by the bed's state (white, soft blue, soft blue pulsing, amber, amber pulsing,
 *                  green, teal). The colour and the pulse flag are rewritten only when the state changes; the pulse itself is a
 *                  shader term of one uniform (`uTime`), never a redraw.
 *   bedside        one quad per room showing its tile of a 4 x 4 canvas atlas. A tile is repainted only when `RoomStatus.version`
 *   screens        changes (looked for at 4 Hz, uploaded at most 2 Hz).
 * Without `life` it draws the default look: flat backrests, white tiles, the static bedside tile. Nothing is allocated in `step`.
 */
import { Group, InstancedMesh, Object3D, type InstancedBufferAttribute, type MeshBasicMaterial } from 'three'
import { PATIENTS } from '@/content/catalogue'
import { registerDimmable } from '@/scene/daylight/dim'
import { MAT } from '@/scene/materials'
import { BED_ANCHORS, DOOR_TILE } from '@/scene/rooms/bedParts'
import { clearReclineShown, RECLINE_MAX, setReclineShown } from '@/scene/rooms/bedPose'
import { CONFIG } from '@/sim/config'
import { ROOMS } from '@/sim/places'
import type { LivingDayView } from '@/sim/types'
import { hideAll, primeColors } from '../instancing'
import { createBedsideAtlas, type BedsideAtlas } from './bedsideAtlas'
import { bedStateIndex, DOOR_COLORS, DOOR_PULSE } from './doorStyle'
import { backrestGeometry, bedsideQuadGeometry, createBedsideMaterial, createDoorTileMaterial, doorTileGeometry } from './wardParts'

const N = ROOMS.length
const OCCUPIED = bedStateIndex('occupied')
const DAY_OF_STAY = new Map<string, number>(PATIENTS.map((p) => [p.id, p.dayOfStay]))

/** The screens look for a changed `version` this often (seconds), and upload the canvas at most this often. */
export const SCREEN_CHECK = 0.25
export const SCREEN_UPLOAD = 0.5

const dummy = new Object3D()
dummy.rotation.order = 'YXZ'

export interface WardStep {
  life: LivingDayView | null
  /** Changes when the hospital is rebuilt (a Jump): everything snaps. */
  generation: number
  /** Sim seconds since the last frame (0 while paused). */
  simDt: number
  /** Real clock seconds (for the pulse and the screen throttles). */
  now: number
}

export interface WardRig {
  group: Group
  backrests: InstancedMesh
  tiles: InstancedMesh
  screens: InstancedMesh
  tileMaterial: MeshBasicMaterial
  /** The recline drawn for each room (0..1). */
  shown: Float32Array
  step(s: WardStep): void
  /** Register with the daylight dimming (idempotent); `dispose` unregisters, so a remount calls it again. */
  attach(): void
  dispose(): void
}

export function createWardRig(atlasOverride?: BedsideAtlas | null): WardRig {
  const atlas = atlasOverride === undefined ? createBedsideAtlas() : atlasOverride
  const tile = createDoorTileMaterial()
  const backrestGeo = backrestGeometry()
  const tileGeo = doorTileGeometry()
  const screenGeo = bedsideQuadGeometry()
  const pulse = tileGeo.getAttribute('aPulse') as InstancedBufferAttribute
  const screenMat = createBedsideMaterial(atlas?.texture ?? null)

  const backrests = new InstancedMesh(backrestGeo, MAT.linen, N)
  backrests.receiveShadow = true
  const tiles = new InstancedMesh(tileGeo, tile.material, N)
  tiles.renderOrder = 1
  const screens = new InstancedMesh(screenGeo, screenMat, N)
  const group = new Group()
  group.name = 'ward-live'
  for (const m of [backrests, tiles, screens]) {
    m.frustumCulled = false
    group.add(m)
  }

  // the tiles sit in the doorway and the screens on their arms: fixed places, written once
  primeColors(tiles, DOOR_COLORS[OCCUPIED])
  for (let i = 0; i < N; i++) {
    const t = BED_ANCHORS[i].doorTile
    dummy.position.set(t.x, t.y - DOOR_TILE.h / 2, t.z)
    dummy.rotation.set(0, t.ry, 0)
    dummy.updateMatrix()
    tiles.setMatrixAt(i, dummy.matrix)
    const s = BED_ANCHORS[i].screen
    dummy.position.set(s.x, s.y, s.z)
    dummy.rotation.set(-s.lean, s.ry, 0)
    dummy.updateMatrix()
    screens.setMatrixAt(i, dummy.matrix)
  }
  tiles.instanceMatrix.needsUpdate = true
  screens.instanceMatrix.needsUpdate = true
  hideAll(backrests)

  // the night dimming follows the daylight driver: the screens take all of it, the door tiles a little
  let offs: (() => void)[] = []

  const shown = new Float32Array(N)
  const bed = new Int8Array(N).fill(-1)
  const version = new Int32Array(N).fill(-9)
  const st = { generation: Number.NaN, life: null as LivingDayView | null, snap: true, lastCheck: -9, lastUpload: -9, uploadDue: false }

  return {
    group,
    backrests,
    tiles,
    screens,
    tileMaterial: tile.material,
    shown,
    step({ life, generation, simDt, now }) {
      // a Jump swaps the hospital: snap everything to the new one (hidden behind the fade)
      if (st.generation !== generation || st.life !== life) {
        st.generation = generation
        st.life = life
        st.snap = true
        bed.fill(-1)
        version.fill(-9)
      }
      tile.uTime.value = now

      // --- backrests: follow RoomStatus.recline at the config's raising speed, in sim time
      const step = simDt / CONFIG.meals.reclineSeconds
      let moved = st.snap
      for (let i = 0; i < N; i++) {
        const target = life?.rooms.get(ROOMS[i].id)?.recline ?? 0
        const want = target < 0 ? 0 : target > 1 ? 1 : target
        const cur = shown[i]
        let next = st.snap ? want : cur < want ? Math.min(want, cur + step) : Math.max(want, cur - step)
        if (next < 0.0005) next = 0
        if (next !== cur || st.snap) {
          shown[i] = next
          const a = BED_ANCHORS[i].backrest
          dummy.position.set(a.x, a.y, a.z)
          dummy.rotation.set(next * RECLINE_MAX, a.ry, 0)
          dummy.updateMatrix()
          backrests.setMatrixAt(i, dummy.matrix)
          moved = true
        }
        setReclineShown(i, shown[i])
      }
      if (moved) backrests.instanceMatrix.needsUpdate = true

      // --- door tiles: colour and pulse flag only when the state changes
      let tileChanged = false
      for (let i = 0; i < N; i++) {
        const idx = life ? bedStateIndex(life.rooms.get(ROOMS[i].id)?.bed ?? 'occupied') : OCCUPIED
        if (bed[i] === idx) continue
        bed[i] = idx
        tiles.setColorAt(i, DOOR_COLORS[idx])
        pulse.setX(i, DOOR_PULSE[idx])
        tileChanged = true
      }
      if (tileChanged) {
        if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true
        pulse.needsUpdate = true
      }

      // --- bedside screens: repaint a tile only when its room's version moved
      if (atlas) {
        if (st.snap || now - st.lastCheck >= SCREEN_CHECK) {
          st.lastCheck = now
          for (let i = 0; i < N; i++) {
            const room = life?.rooms.get(ROOMS[i].id)
            const v = room ? room.version : -1
            if (version[i] === v) continue
            version[i] = v
            if (room) atlas.draw(i, { roomId: room.roomId, bed: room.bed, name: room.patientName, day: room.dayOfStay ?? ((room.patientId && DAY_OF_STAY.get(room.patientId)) || 1), meal: room.meal })
            else atlas.draw(i, null)
            st.uploadDue = true
          }
        }
        if (st.uploadDue && now - st.lastUpload >= SCREEN_UPLOAD) {
          st.uploadDue = false
          st.lastUpload = now
          atlas.texture.needsUpdate = true
        }
      }
      st.snap = false
    },
    attach() {
      if (offs.length === 0) offs = [registerDimmable(screenMat.color, 1.1, 1), registerDimmable(tile.material.color, 1, 0.35)]
    },
    dispose() {
      for (const off of offs) off()
      offs = []
      clearReclineShown()
      backrestGeo.dispose()
      tileGeo.dispose()
      screenGeo.dispose()
      tile.material.dispose()
      screenMat.dispose()
      atlas?.texture.dispose()
    },
  }
}
