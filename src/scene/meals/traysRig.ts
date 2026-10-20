/**
 * Meal trays (L1), with no React: two InstancedMeshes sharing one vertex-coloured material.
 *   base    the tray with plate, cup and napkin: instances 0..15 on the over-bed tables ('served' and 'eaten'), then, on the MealBots'
 *           shelves, one per loaded shelf (`MealBot.trays`);
 *   cloche  the silver cover over the plate: on a table only while the room's meal is 'served'.
 * A tray grows in over a third of a second when it is set down (never a pop) and shrinks away when it is cleared. Shelf trays stay
 * hidden until the bot has fully faded in, so they never show through the dithered body.
 * Nothing is allocated in `step`: scratch objects live at module level, the per-bot callback is built once.
 */
import { Group, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { BED_ANCHORS } from '@/scene/rooms/bedParts'
import { ROOMS } from '@/sim/places'
import type { LivingDayView, MealBot } from '@/sim/types'
import { SHELF, SHELF_COUNT, shelfY } from './botParts'
import { hideAll } from './instancing'
import { MAX_BOTS } from './life'
import { trayBaseGeometry, trayClocheGeometry } from './trayParts'
import { patchMaterialLook } from '@/scene/lighting/palettePatch'

export const TABLES = ROOMS.length
export const SHELF_CAP = MAX_BOTS * SHELF_COUNT
const CAP = TABLES + SHELF_CAP

/** Seconds a tray takes to appear or go. */
export const GROW_SECONDS = 0.33

const dummy = new Object3D()
const botMatrix = new Matrix4()
const local = new Matrix4()
const world = new Matrix4()
const ZERO = new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
const QUARTER_TURN = new Matrix4().makeRotationY(Math.PI / 2)
const shelfScale = new Vector3(SHELF.trayScale, SHELF.trayScale, SHELF.trayScale)

const smooth = (t: number): number => t * t * (3 - 2 * t)

export interface TraysRig {
  group: Group
  base: InstancedMesh
  cloche: InstancedMesh
  /** How grown each table's tray and cover are (0..1), for tests. */
  tray: Float32Array
  cover: Float32Array
  /** Shelf trays drawn this frame. */
  shelfTrays(): number
  step(life: LivingDayView | null, dt: number): void
  dispose(): void
}

export function createTraysRig(): TraysRig {
  const baseGeo = trayBaseGeometry()
  const clocheGeo = trayClocheGeometry()
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 })
  // W3: the baked light volume, like the palette around it
  patchMaterialLook(mat, 'plain')
  const base = new InstancedMesh(baseGeo, mat, CAP)
  const cloche = new InstancedMesh(clocheGeo, mat, TABLES)
  const group = new Group()
  group.name = 'trays'
  for (const m of [base, cloche]) {
    m.frustumCulled = false
    group.add(m)
    hideAll(m)
  }
  base.count = TABLES

  const tray = new Float32Array(TABLES)
  const cover = new Float32Array(TABLES)
  const st = { used: 0, lastUsed: 0, first: true }

  const visit = (bot: MealBot): void => {
    if (bot.state === 'offsite' || bot.fade < 0.99 || bot.trays <= 0) return
    dummy.position.set(bot.position.x, bot.position.y, bot.position.z)
    dummy.rotation.set(0, bot.heading, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    botMatrix.copy(dummy.matrix)
    const n = Math.min(bot.trays, SHELF_COUNT)
    for (let k = 0; k < n && st.used < SHELF_CAP; k++) {
      // the long axis of a shelf tray runs along the bot
      local.copy(QUARTER_TURN).scale(shelfScale)
      local.setPosition(0, shelfY(k), SHELF.z)
      world.multiplyMatrices(botMatrix, local)
      base.setMatrixAt(TABLES + st.used++, world)
    }
  }

  const place = (mesh: InstancedMesh, i: number, a: { x: number; y: number; z: number; ry: number }, grown: number): void => {
    if (grown <= 0) {
      mesh.setMatrixAt(i, ZERO)
      return
    }
    dummy.position.set(a.x, a.y, a.z)
    dummy.rotation.set(0, a.ry, 0)
    dummy.scale.setScalar(smooth(grown))
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }

  return {
    group,
    base,
    cloche,
    tray,
    cover,
    shelfTrays: () => st.used,
    step(life, dt) {
      const grow = Math.min(dt, 0.25) / GROW_SECONDS
      let moving = false
      for (let i = 0; i < TABLES; i++) {
        const meal = life?.rooms.get(ROOMS[i].id)?.meal ?? 'none'
        const wantTray = meal === 'none' ? 0 : 1
        const wantCover = meal === 'served' ? 1 : 0
        if (tray[i] !== wantTray) {
          tray[i] = tray[i] < wantTray ? Math.min(wantTray, tray[i] + grow) : Math.max(wantTray, tray[i] - grow)
          moving = true
        }
        if (cover[i] !== wantCover) {
          cover[i] = cover[i] < wantCover ? Math.min(wantCover, cover[i] + grow) : Math.max(wantCover, cover[i] - grow)
          moving = true
        }
        const anchor = BED_ANCHORS[i].tray
        place(base, i, anchor, tray[i])
        place(cloche, i, anchor, cover[i])
      }
      st.used = 0
      if (life) life.mealBots.forEach(visit)
      base.count = TABLES + st.used
      const changed = moving || st.used > 0 || st.lastUsed > 0
      st.lastUsed = st.used
      if (changed || st.first) {
        st.first = false
        base.instanceMatrix.needsUpdate = true
        cloche.instanceMatrix.needsUpdate = true
      }
    },
    dispose() {
      baseGeo.dispose()
      clocheGeo.dispose()
      mat.dispose()
    },
  }
}
