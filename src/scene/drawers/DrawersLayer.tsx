/**
 * MedDrawers: 16 cabinets set into the corridor walls, and (W2) the glass chute and the fold-out funnel that feed them
 * from the ceiling rail.
 *
 * Static (merged per material, shadows baked once): the white shell with the closed hatches, the section-cut cap, the dark
 * slots, and per room the glass chute tube and its white hardware (back plate, clamps, hinge arms; see chute.ts).
 * Instanced and animated every frame:
 *   - funnel tray (chute top): folds out from the wall to under the pod while a pod with `state === 'delivering'` has an
 *     order for that room (`sim.meds.jobOf(pod.id)?.roomId`) and folds back when the pod drives on (after `undockSeconds`);
 *     eased in sim time (`FUNNEL.seconds`), so it freezes when paused;
 *   - packs in flight: one pool slot per pod (the tail of the pack mesh). Pack k of the order leaves the pod's bottom hatch,
 *     drops onto the funnel, slides into the tube and falls down it into the cabinet, one pack per
 *     `drawers.transferSecondsPerItem`, in the colour of its medicine (packFlight.ts). The pool is driven by the time since
 *     the pod docked, counted in sim time here, and it catches up when the sim has loaded the drawer;
 *   - glow strip on the chute's back plate: teal while a delivery runs (extra instances of the status-light mesh);
 *   - drawer (room side): slides out while a nurse entity in that room has `anim === 'give'`, with the packs of the
 *     drawer's items lying on its tray (medicine colours);
 *   - status lights (both faces): off when empty, teal when loaded, pulsing when `lightOn` (dose due), and a green
 *     flash for 2 s right after a loaded drawer empties (detected as a loaded to empty transition).
 * The corridor hatch no longer opens: the pods no longer dock on the floor.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, Object3D, type InstancedMesh } from 'three'
import { MEDICINES } from '@/content/catalogue'
import { invalidateShadows } from '@/scene/Lighting'
import { MAT, STATUS } from '@/scene/materials'
import { hideInstances, prime } from '@/scene/robots/instancing'
import { ensureTintedGlow } from '@/scene/robots/tintGlow'
import { loop, sim } from '@/sim'
import type { Driver } from '@/sim/meds/pods'
import { ROOMS } from '@/sim/places'
import type { Drawer, Entity, Order } from '@/sim/types'
import {
  buildCabinets,
  CAB,
  cabinetFlip,
  cabinetYaw,
  DRAWER_CLOSED_Z,
  DRAWER_MID_Y,
  drawerGeometry,
  SLOTS_PER_DRAWER,
  shellWithClosedHatches,
  TRAY_PACK_SIZE,
  TRAY_PACKS,
} from './cabinet'
import { buildChuteGlass, buildChuteHardware, CHUTE_LAYOUTS, chuteStrip, CHUTE, FUNNEL, funnelGeometry, funnelRotation } from './chute'
import { flightGeom, makePose, PACK, PACK_POOL, packPose, simDeliverySeconds } from './packFlight'

ensureTintedGlow()

const N = ROOMS.length
const ROOM_INDEX = new Map<string, number>(ROOMS.map((r, i) => [r.id, i]))
/** What the frame reads from the running sim. A Jump swaps the sim object, so this is re-read when `sim` or its roster changes. */
const view = { owner: null as object | null, roster: -1, drawers: [] as Drawer[], nurses: [] as Entity[], pods: [] as Driver[] }
function refreshView(): void {
  if (view.owner === sim && view.roster === sim.rosterVersion) return
  view.owner = sim
  view.roster = sim.rosterVersion
  view.drawers = ROOMS.map((r) => sim.meds.drawers.get(r.id)!)
  view.nurses = sim.people.filter((p) => p.entity.role === 'nurse').map((p) => p.entity)
  view.pods = sim.meds.fleet.drivers
}

const MED_COLOR = new Map<string, Color>(MEDICINES.map((m) => [m.id, new Color(m.color)]))
const PANEL = new Color('#f0f6f4')
const FUNNEL_TINT = new Color('#e9f4f1')
const PACK_NONE = new Color('#ffffff')
const LIGHT_OFF = new Color('#1d2527').multiplyScalar(0.8)
const LIGHT_TEAL = new Color(STATUS.teal).multiplyScalar(1.1)
const LIGHT_DUE = new Color(STATUS.teal).multiplyScalar(2.2)
const LIGHT_GREEN = new Color(STATUS.green).multiplyScalar(2.0)
const STRIP_ON = new Color(STATUS.teal).multiplyScalar(1.5)
const tmp = new Color()
const dummy = new Object3D()
dummy.rotation.order = 'YXZ'

/** Seconds for the drawer to slide out, for the chute's glow to fade in or out, and how long the green flash lasts. */
const SLIDE_SECONDS = 0.7
const GLOW_SECONDS = 0.35
const FLASH_SECONDS = 2

const TRAY_COUNT = N * SLOTS_PER_DRAWER

const smooth = (k: number): number => k * k * (3 - 2 * k)
const approach = (v: number, want: number, step: number): number => (want > v ? Math.min(want, v + step) : Math.max(want, v - step))

/** The medicine id of the j-th pack lying in a drawer (one pack per unit of quantity), or undefined. */
function packMed(d: Drawer, j: number): string | undefined {
  let n = 0
  for (let i = 0; i < d.items.length; i++) {
    n += d.items[i].qty
    if (j < n) return d.items[i].medId
  }
  return undefined
}

export function DrawersLayer() {
  const funnels = useRef<InstancedMesh>(null)
  const drawers = useRef<InstancedMesh>(null)
  const lights = useRef<InstancedMesh>(null)
  const packs = useRef<InstancedMesh>(null)

  const assets = useMemo(() => {
    const cabinets = buildCabinets()
    return {
      cabinets,
      shell: shellWithClosedHatches(cabinets.shell),
      glass: buildChuteGlass(),
      hardware: buildChuteHardware(),
      funnelGeo: funnelGeometry(),
      drawerGeo: drawerGeometry(),
      unit: new BoxGeometry(1, 1, 1),
      geoms: CHUTE_LAYOUTS.map(flightGeom),
      pose: makePose(),
      funnelWant: new Uint8Array(N),
      funnelOpen: new Float32Array(N),
      glow: new Float32Array(N),
      drawerWant: new Uint8Array(N),
      drawerOut: new Float32Array(N),
      flash: new Float32Array(N),
      wasLoaded: new Uint8Array(N),
      packKey: new Array<string>(TRAY_COUNT + PACK_POOL).fill('?'),
      /** Per pod: the order it is delivering and the sim seconds since it docked. */
      podOrder: new Array<Order | null>(PACK_POOL).fill(null),
      podT: new Float32Array(PACK_POOL),
    }
  }, [])

  useEffect(() => {
    invalidateShadows()
    return () => {
      assets.shell.dispose()
      assets.cabinets.cap.dispose()
      assets.cabinets.slots.dispose()
      assets.glass.dispose()
      assets.hardware.dispose()
      assets.funnelGeo.dispose()
      assets.drawerGeo.dispose()
      assets.unit.dispose()
    }
  }, [assets])

  // static light pills and chute glow strips, the folded funnels, and every instance colour in place before the first draw, so no shader recompiles later
  useLayoutEffect(() => {
    const m = lights.current
    const fm = funnels.current
    if (!m || !fm) return
    const { light, zCorr, zRoom, drawer } = CAB
    ROOMS.forEach((r, i) => {
      const flip = cabinetFlip(r)
      dummy.rotation.set(0, cabinetYaw(r), 0)
      dummy.scale.set(light.w, light.h, light.t)
      dummy.position.set(r.drawer.x, light.yCorr, r.drawer.z + flip * (zCorr + light.t / 2))
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      dummy.position.set(r.drawer.x, light.yRoom, r.drawer.z + flip * (zRoom - drawer.t - light.t / 2))
      dummy.updateMatrix()
      m.setMatrixAt(N + i, dummy.matrix)

      // the chute's glow strip lies on the back plate, behind the tube
      const l = CHUTE_LAYOUTS[i]
      const strip = chuteStrip(l)
      dummy.rotation.set(0, l.yaw, 0)
      dummy.scale.set(CHUTE.strip.w, strip.h, CHUTE.strip.t)
      dummy.position.set(l.x, strip.y, l.z + l.flip * strip.z)
      dummy.updateMatrix()
      m.setMatrixAt(2 * N + i, dummy.matrix)

      // the funnel starts folded up against the wall
      dummy.rotation.set(funnelRotation(0), l.yaw, 0)
      dummy.scale.set(1, 1, l.funnelScale)
      dummy.position.set(l.x, l.pivotY, l.z)
      dummy.updateMatrix()
      fm.setMatrixAt(i, dummy.matrix)
    })
    dummy.scale.set(1, 1, 1)
    m.instanceMatrix.needsUpdate = true
    fm.instanceMatrix.needsUpdate = true
    prime(m, LIGHT_OFF)
    prime(fm, FUNNEL_TINT)
    prime(drawers.current, PANEL)
    prime(packs.current, PACK_NONE)
    for (const mesh of [drawers, packs]) hideInstances(mesh.current)
  }, [])

  useFrame((state, dt) => {
    refreshView()
    const fm = funnels.current
    const dm = drawers.current
    const lm = lights.current
    const pm = packs.current
    if (!fm || !dm || !lm || !pm) return

    const simDt = loop.paused ? 0 : Math.min(dt, 0.1) * loop.speed
    const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 5)
    let packColourChanged = false
    let lightColourChanged = false

    // 1. what the sim wants: a pod delivering to a room folds that funnel out (and runs its packs); a nurse giving in a room pulls its drawer out
    assets.funnelWant.fill(0)
    assets.drawerWant.fill(0)
    for (let p = 0; p < PACK_POOL; p++) {
      const k = TRAY_COUNT + p
      let shown = false
      if (p < view.pods.length) {
        const pod = view.pods[p].pod
        if (pod.state === 'delivering') {
          const order = sim.meds.jobOf(pod.id)
          const idx = order === undefined ? undefined : ROOM_INDEX.get(order.roomId)
          if (order !== undefined && idx !== undefined) {
            assets.funnelWant[idx] = 1
            if (assets.podOrder[p] !== order) {
              assets.podOrder[p] = order
              assets.podT[p] = 0
            } else {
              assets.podT[p] += simDt
            }
            const n = order.items.length
            // the sim has already loaded the drawer: every pack is in it (a pod seen mid-delivery, or a long frame, catches up)
            if (view.drawers[idx].orderIds.includes(order.id)) assets.podT[p] = Math.max(assets.podT[p], simDeliverySeconds(n))
            const pose = packPose(n, assets.podT[p], assets.geoms[idx], assets.pose)
            if (pose.visible) {
              const l = CHUTE_LAYOUTS[idx]
              dummy.rotation.set(0, l.yaw, 0)
              dummy.scale.set(PACK.x, PACK.y, PACK.z)
              dummy.position.set(l.x + l.flip * pose.x, pose.y, l.z + l.flip * pose.z)
              dummy.updateMatrix()
              pm.setMatrixAt(k, dummy.matrix)
              const key = order.items[pose.index].medId
              if (assets.packKey[k] !== key) {
                assets.packKey[k] = key
                pm.setColorAt(k, MED_COLOR.get(key) ?? PACK_NONE)
                packColourChanged = true
              }
              shown = true
            }
          }
        } else {
          assets.podOrder[p] = null
        }
      }
      if (!shown) {
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()
        pm.setMatrixAt(k, dummy.matrix)
      }
    }
    for (let n = 0; n < view.nurses.length; n++) {
      const e = view.nurses[n]
      if (e.anim !== 'give' || e.roomId === undefined) continue
      const idx = ROOM_INDEX.get(e.roomId)
      if (idx !== undefined) assets.drawerWant[idx] = 1
    }

    let funnelMoved = false
    for (let i = 0; i < N; i++) {
      const room = ROOMS[i]
      const d = view.drawers[i]
      const flip = cabinetFlip(room)
      const yaw = cabinetYaw(room)

      // 2. ease the funnel, the chute's glow and the drawer
      const open = approach(assets.funnelOpen[i], assets.funnelWant[i], simDt / FUNNEL.seconds)
      if (open !== assets.funnelOpen[i]) {
        assets.funnelOpen[i] = open
        const l = CHUTE_LAYOUTS[i]
        dummy.rotation.set(funnelRotation(open), l.yaw, 0)
        dummy.scale.set(1, 1, l.funnelScale)
        dummy.position.set(l.x, l.pivotY, l.z)
        dummy.updateMatrix()
        fm.setMatrixAt(i, dummy.matrix)
        funnelMoved = true
      }
      assets.glow[i] = approach(assets.glow[i], assets.funnelWant[i], simDt / GLOW_SECONDS)
      tmp.copy(LIGHT_OFF).lerp(STRIP_ON, smooth(assets.glow[i]))
      lm.setColorAt(2 * N + i, tmp)
      assets.drawerOut[i] = approach(assets.drawerOut[i], assets.drawerWant[i], simDt / SLIDE_SECONDS)
      const slide = smooth(assets.drawerOut[i]) * CAB.slideMax

      // drawer: the front panel moves out into the room (local -z)
      const drawerZ = DRAWER_CLOSED_Z - slide
      dummy.position.set(room.drawer.x, DRAWER_MID_Y, room.drawer.z + flip * drawerZ)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      dm.setMatrixAt(i, dummy.matrix)

      // packs on the tray ride with the drawer; slots without a pack shrink to nothing
      for (let j = 0; j < SLOTS_PER_DRAWER; j++) {
        const medId = d.state === 'loaded' ? packMed(d, j) : undefined
        const slot = TRAY_PACKS[j]
        const k = i * SLOTS_PER_DRAWER + j
        dummy.rotation.set(0, yaw, 0)
        if (medId === undefined) dummy.scale.set(0, 0, 0)
        else dummy.scale.set(TRAY_PACK_SIZE.x, TRAY_PACK_SIZE.y, TRAY_PACK_SIZE.z)
        dummy.position.set(room.drawer.x + flip * slot.x, DRAWER_MID_Y + slot.y, room.drawer.z + flip * (drawerZ + slot.z))
        dummy.updateMatrix()
        pm.setMatrixAt(k, dummy.matrix)
        const key = medId ?? ''
        if (assets.packKey[k] !== key) {
          assets.packKey[k] = key
          pm.setColorAt(k, MED_COLOR.get(key) ?? PACK_NONE)
          packColourChanged = true
        }
      }

      // 3. status lights: off / teal / pulsing when the dose is due / green flash after the drawer empties
      const loaded = d.state === 'loaded'
      if (assets.wasLoaded[i] === 1 && !loaded) assets.flash[i] = FLASH_SECONDS
      assets.wasLoaded[i] = loaded ? 1 : 0
      assets.flash[i] = Math.max(0, assets.flash[i] - simDt)
      if (assets.flash[i] > 0) {
        tmp.copy(LIGHT_GREEN).multiplyScalar(0.55 + 0.45 * Math.min(1, assets.flash[i] / 0.6))
      } else if (d.lightOn) {
        tmp.copy(LIGHT_TEAL).lerp(LIGHT_DUE, pulse)
      } else if (loaded) {
        tmp.copy(LIGHT_TEAL)
      } else {
        tmp.copy(LIGHT_OFF)
      }
      lm.setColorAt(i, tmp)
      lm.setColorAt(N + i, tmp)
      lightColourChanged = true
    }

    if (funnelMoved) fm.instanceMatrix.needsUpdate = true
    dm.instanceMatrix.needsUpdate = true
    pm.instanceMatrix.needsUpdate = true
    if (packColourChanged && pm.instanceColor) pm.instanceColor.needsUpdate = true
    if (lightColourChanged && lm.instanceColor) lm.instanceColor.needsUpdate = true
  })

  return (
    <group name="drawers">
      <mesh geometry={assets.shell} material={MAT.whitePlastic} castShadow receiveShadow />
      <mesh geometry={assets.cabinets.cap} material={MAT.wallCap} castShadow receiveShadow />
      <mesh geometry={assets.cabinets.slots} material={MAT.screen} />
      <mesh name="chute-glass" geometry={assets.glass} material={MAT.glass} />
      <mesh name="chute-hardware" geometry={assets.hardware} material={MAT.whitePlastic} receiveShadow />
      <instancedMesh name="funnels" ref={funnels} args={[assets.funnelGeo, MAT.tinted, N]} frustumCulled={false} />
      <instancedMesh ref={drawers} args={[assets.drawerGeo, MAT.tinted, N]} frustumCulled={false} />
      <instancedMesh ref={packs} args={[assets.unit, MAT.tinted, TRAY_COUNT + PACK_POOL]} frustumCulled={false} />
      <instancedMesh ref={lights} args={[assets.unit, MAT.tintedGlow, N * 3]} frustumCulled={false} />
    </group>
  )
}
