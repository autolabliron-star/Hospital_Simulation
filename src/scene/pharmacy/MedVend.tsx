/**
 * The MedVend dispensing island's moving and stocked parts: 144 bin trays (minus the two at each top dock port), the
 * packs standing in the stocked bins, one picker gantry per face (mast, carriage, telescoping arm, palm, two fingers and
 * the pack it holds) and one transfer-tray plate per dock port.
 *
 * How the gantry is driven (all in useFrame, no allocation):
 *   - the mast follows `dispensers[w].renderX` and the carriage follows `renderY` (interpolated by Simulation.sync);
 *     at the top dock port the carriage stands at the sim's drop height (`PHARMACY.dockPortY`);
 *   - the hand is a pure function of the sim's gantry state and timer (`handTargets`): the arm reaches into the bin
 *     while `picking` and pushes the pack onto the dock's transfer tray while `dropping`, the fingers close on the pack
 *     and open to release it; those targets are low-pass filtered in sim time, so nothing teleports and everything
 *     freezes when paused;
 *   - each dock's transfer tray (one plate per port, in the same instanced mesh) slides out through the port across the
 *     gap to the docked pod's side hatch carrying the pack, and back (`followTray`, speed-limited);
 *   - the held pack is coloured like the current item (`orders.get(gantry.orderId).items[gantry.itemIndex]`); on the
 *     tray it slides off into the pod's hatch (`trayPackPose`), just as the sim adds it to the pod.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Color, Object3D, type InstancedMesh } from 'three'
import { MEDICINES } from '@/content/catalogue'
import { MAT, STATUS } from '@/scene/materials'
import { hideInstances } from '@/scene/robots/instancing'
import { ensureTintedGlow } from '@/scene/robots/tintGlow'
import { loop, sim } from '@/sim'
import { followTray, handTargets, trayPackPose, type HandTargets, type PackPose } from './gantryMotion'
import { dockIndex, DOCKS, FACE_SIGN, MV, PACK, TRAY, TRAY_TRAVEL, WARDS } from './layout'
import { binGeometry, binInstances, binTint, GANTRY_INSTANCES, GANTRY_PARTS, packGeometry, packInstances, TRAY_BASE } from './medvendParts'

ensureTintedGlow()

const PARTS_PER_FACE = GANTRY_PARTS.length
const MED_COLOR = new Map<string, Color>(MEDICINES.map((m) => [m.id, new Color(m.color)]))

const dummy = new Object3D()
dummy.rotation.order = 'YXZ'
const targets: HandTargets = { reach: 0, grip: 0, holding: false, onTray: false, tray: 0, enter: 0 }
const slide: PackPose = { out: 0, y: 0, scale: 1 }
const tint = new Color()
const LIGHT_IDLE = new Color('#2a3436').multiplyScalar(0.8)
const LIGHT_BUSY = new Color(STATUS.teal).multiplyScalar(1.8)

/** Filter rate (per second of sim time) for reach and grip: quick enough to track the timer, slow enough to hide 60 Hz stepping. */
const RATE = 22
const MAST_Y0 = MV.kick + 0.08
const MAST_Y1 = MV.headerY - 0.08
const PART_COLOR = ['#7b898c', '#f2f6f6', '#a9b6b8', '#4b575a', '#2f383a', '#2f383a', '#ffffff'].map((c) => new Color(c))
const TRAY_COLOR = new Color('#eef3f3')
/** Index into DOCKS of each face's ports: DOCK_INDEX[face][port]. */
const DOCK_INDEX: number[][] = WARDS.map((w) => DOCKS.filter((d) => d.ward === w).map((d) => dockIndex(w, d.port)))
/** The dock a face's port belongs to, and which face a dock is on. */
const FACE_OF_DOCK: number[] = DOCKS.map((d) => WARDS.indexOf(d.ward))

interface FaceAnim {
  reach: number
  grip: number
  orderId: string | undefined
  itemIndex: number
  busy: number
  /** The port being fed (state `dropping`), or -1, and the wanted tray extension and pack slide for it this frame. */
  feeding: number
  tray: number
  enter: number
}
const FACES: FaceAnim[] = WARDS.map(() => ({ reach: 0, grip: 0, orderId: undefined, itemIndex: -1, busy: -1, feeding: -1, tray: 0, enter: 0 }))
/** Displayed extension of every dock's transfer tray (0 = stowed behind the glass, 1 = in the pod's hatch). */
const TRAY_EXT = new Float64Array(DOCKS.length)

function setBox(mesh: InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  dummy.position.set(x, y, z)
  dummy.scale.set(sx, sy, sz)
  dummy.updateMatrix()
  mesh.setMatrixAt(i, dummy.matrix)
}

export function MedVend() {
  const bins = useRef<InstancedMesh>(null)
  const packs = useRef<InstancedMesh>(null)
  const gantry = useRef<InstancedMesh>(null)
  const lights = useRef<InstancedMesh>(null)

  const data = useMemo(() => {
    const binList = binInstances()
    const packList = packInstances()
    return { binList, packList, binGeo: binGeometry(), packGeo: packGeometry(), unit: new BoxGeometry(1, 1, 1) }
  }, [])

  useEffect(
    () => () => {
      data.binGeo.dispose()
      data.packGeo.dispose()
      data.unit.dispose()
    },
    [data],
  )

  // the stocked bins and packs never move: write them once
  useLayoutEffect(() => {
    const b = bins.current
    const p = packs.current
    const g = gantry.current
    const l = lights.current
    if (!b || !p || !g || !l) return
    data.binList.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z)
      dummy.rotation.set(0, it.yaw, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      b.setMatrixAt(i, dummy.matrix)
      b.setColorAt(i, binTint(it.medId, tint))
    })
    data.packList.forEach((it, i) => {
      dummy.position.set(it.x, it.y, it.z)
      dummy.rotation.set(0, it.yaw, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      p.setMatrixAt(i, dummy.matrix)
      p.setColorAt(i, MED_COLOR.get(it.medId) ?? tint.set('#ffffff'))
    })
    dummy.rotation.set(0, 0, 0)
    for (let f = 0; f < WARDS.length; f++) for (let k = 0; k < PARTS_PER_FACE; k++) g.setColorAt(f * PARTS_PER_FACE + k, PART_COLOR[k])
    for (let i = 0; i < DOCKS.length; i++) g.setColorAt(TRAY_BASE + i, TRAY_COLOR)
    for (let f = 0; f < WARDS.length; f++) l.setColorAt(f, LIGHT_IDLE)
    hideInstances(g)
    hideInstances(l)
    for (const m of [b, p, g, l]) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }, [data])

  useFrame((_, dt) => {
    const g = gantry.current
    const l = lights.current
    if (!g || !l) return
    const simDt = loop.paused ? 0 : Math.min(dt, 0.1) * loop.speed
    const follow = 1 - Math.exp(-simDt * RATE)
    let packColourChanged = false
    let lightChanged = false

    // 1. the hand of each face, and which port it is feeding
    for (let f = 0; f < WARDS.length; f++) {
      const gs = sim.meds.dispensers[WARDS[f]].gantry
      const a = FACES[f]
      handTargets(gs.state, gs.timer, targets)
      a.reach += (targets.reach - a.reach) * follow
      a.grip += (targets.grip - a.grip) * follow
      a.feeding = gs.state === 'dropping' ? gs.port : -1
      a.tray = targets.tray
      a.enter = targets.enter
    }

    // 2. the transfer trays: each follows its wanted extension (only the port being fed wants any), speed-limited
    for (let i = 0; i < DOCKS.length; i++) {
      const d = DOCKS[i]
      const a = FACES[FACE_OF_DOCK[i]]
      TRAY_EXT[i] = followTray(TRAY_EXT[i], a.feeding === d.port ? a.tray : 0, simDt)
      setBox(g, TRAY_BASE + i, d.x, TRAY.topY - TRAY.t / 2, FACE_SIGN[d.ward] * (TRAY.stowedBack + TRAY.len / 2 + TRAY_EXT[i] * TRAY_TRAVEL), TRAY.w, TRAY.t, TRAY.len)
    }

    // 3. the carriage, arm, hand and pack of each face
    for (let f = 0; f < WARDS.length; f++) {
      const d = sim.meds.dispensers[WARDS[f]]
      const gs = d.gantry
      const s = FACE_SIGN[WARDS[f]]
      const a = FACES[f]
      const base = f * PARTS_PER_FACE
      handTargets(gs.state, gs.timer, targets)

      // the pack is coloured like the item being handled; only look it up when the item changes
      if (gs.orderId !== a.orderId || gs.itemIndex !== a.itemIndex) {
        a.orderId = gs.orderId
        a.itemIndex = gs.itemIndex
        const item = gs.orderId === undefined ? undefined : sim.meds.orders.get(gs.orderId)?.items[gs.itemIndex]
        if (item) {
          g.setColorAt(base + 6, MED_COLOR.get(item.medId) ?? PART_COLOR[6])
          packColourChanged = true
        }
      }

      const x = d.renderX
      const y = d.renderY
      const hand = MV.handBase + a.reach
      const handY = y + MV.handMount
      // mast rides along x between the rails; the carriage rides the mast
      setBox(g, base, x, (MAST_Y0 + MAST_Y1) / 2, s * MV.mastOut, 0.1, MAST_Y1 - MAST_Y0, 0.1)
      setBox(g, base + 1, x, y, s * MV.carriageOut, MV.carriage.w, MV.carriage.h, MV.carriage.d)
      // arm: from inside the carriage to the back of the palm
      const armFrom = MV.carriageOut
      const armTo = hand - 0.03
      setBox(g, base + 2, x, handY, s * ((armFrom + armTo) / 2), 0.06, 0.06, armTo - armFrom)
      setBox(g, base + 3, x, handY, s * hand, MV.palm.w, MV.palm.h, MV.palm.d)
      // fingers close on the pack width and open wider to approach or release
      const fx = MV.finger.open - MV.finger.travel * a.grip
      const fo = hand + MV.finger.d * 0.65
      setBox(g, base + 4, x - fx, handY, s * fo, MV.finger.t, MV.finger.h, MV.finger.d)
      setBox(g, base + 5, x + fx, handY, s * fo, MV.finger.t, MV.finger.h, MV.finger.d)

      // the pack: in the hand, riding the transfer tray into the pod, or not there
      if (targets.onTray && a.feeding >= 0) {
        const di = DOCK_INDEX[f][a.feeding]
        trayPackPose(TRAY_EXT[di], targets.enter, slide)
        setBox(g, base + 6, DOCKS[di].x, slide.y, s * slide.out, PACK.x * slide.scale, PACK.y * slide.scale, PACK.z * slide.scale)
      } else if (targets.holding) {
        setBox(g, base + 6, x, handY, s * (hand + MV.packAhead), PACK.x, PACK.y, PACK.z)
      } else {
        setBox(g, base + 6, x, handY, s * (hand + MV.packAhead), 0, 0, 0)
      }

      // carriage indicator: teal while it works
      const busy = gs.state === 'idle' ? 0 : 1
      setBox(l, f, x, y + 0.11, s * (MV.carriageOut + MV.carriage.d / 2 + 0.004), 0.22, 0.03, 0.012)
      if (a.busy !== busy) {
        a.busy = busy
        l.setColorAt(f, busy ? LIGHT_BUSY : LIGHT_IDLE)
        lightChanged = true
      }
    }

    g.instanceMatrix.needsUpdate = true
    l.instanceMatrix.needsUpdate = true
    if (packColourChanged && g.instanceColor) g.instanceColor.needsUpdate = true
    if (lightChanged && l.instanceColor) l.instanceColor.needsUpdate = true
  })

  return (
    <group name="medvend">
      <instancedMesh ref={bins} args={[data.binGeo, MAT.tinted, data.binList.length]} frustumCulled={false} receiveShadow />
      <instancedMesh ref={packs} args={[data.packGeo, MAT.tinted, data.packList.length]} frustumCulled={false} />
      <instancedMesh ref={gantry} args={[data.unit, MAT.tinted, GANTRY_INSTANCES]} frustumCulled={false} />
      <instancedMesh ref={lights} args={[data.unit, MAT.tintedGlow, WARDS.length]} frustumCulled={false} />
    </group>
  )
}
