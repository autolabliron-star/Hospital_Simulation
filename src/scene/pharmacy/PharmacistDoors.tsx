/**
 * The two sliding glass doors for the pharmacists (one per ward), each two leaves. The MedPods do not use doors any
 * more: they ride the ceiling rail through small portals near the top of the glass (see RailPortals).
 *
 * How they are driven (useFrame, no allocation): the logic is in coreDoors.ts (pure, tested). A door opens while any person is within
 * 1.4 m of its centre, or YOU are (W3: along the way you are going, `CONFIG.player.doorLeadSeconds` ahead, so it is open when your body
 * gets there), and stays open for 1 s after the last one leaves, then closes. The opening is a 0..1 value moved at a fixed rate in sim
 * time (quicker at 2x and 4x, REAL time while the sim is paused so the doors still work for you) and shown through a smoothstep, so the
 * leaves ease in and out. The leaves are solid: they are published as blockers (src/scene/blockers.ts) before you move. Glass leaves and
 * their four frame bars per leaf are two InstancedMeshes (`MAT.glass`, `MAT.frame`).
 *
 * Priority: FRAME_PRIORITY.doors (-11, after the sim, before the player), so the leaves are where the player's body will find them.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Object3D, PlaneGeometry, type InstancedMesh } from 'three'
import { registerBlockers, type BlockerSource } from '@/scene/blockers'
import { FRAME_PRIORITY } from '@/scene/camera/frameOrder'
import { MAT } from '@/scene/materials'
import { walkBody } from '@/scene/player/state'
import { hideInstances } from '@/scene/robots/instancing'
import { loop, sim } from '@/sim'
import { CONFIG } from '@/sim/config'
import { CoreDoors, CORE_BLOCKERS_PER_DOOR, coreLeafWidth, coreLeafX, coreLeafZ, doorStepSeconds, writeCoreBlockers, type CoreLead } from './coreDoors'
import { BARS_PER_LEAF as BARS, DOOR, OPENINGS } from './layout'

const N = OPENINGS.length
const LEAF_H = DOOR.height - 0.02

const dummy = new Object3D()

function setBar(mesh: InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
  dummy.position.set(x, y, z)
  dummy.scale.set(sx, sy, sz)
  dummy.updateMatrix()
  mesh.setMatrixAt(i, dummy.matrix)
}

export function PharmacistDoors() {
  const glass = useRef<InstancedMesh>(null)
  const bars = useRef<InstancedMesh>(null)
  const geo = useMemo(() => ({ leaf: new PlaneGeometry(1, 1), bar: new BoxGeometry(1, 1, 1) }), [])
  const state = useMemo(() => {
    const blockers: BlockerSource = { name: 'pharmacist doors', count: 0, data: new Float64Array(N * CORE_BLOCKERS_PER_DOOR * 6) }
    const lead: CoreLead = { vx: 0, vz: 0, seconds: 0 }
    return { doors: new CoreDoors(OPENINGS), blockers, lead, wasWalking: false, written: false }
  }, [])
  useEffect(
    () => () => {
      geo.leaf.dispose()
      geo.bar.dispose()
    },
    [geo],
  )
  // the leaves are solid for as long as this component is mounted
  useEffect(() => registerBlockers(state.blockers), [state])

  useLayoutEffect(() => {
    hideInstances(glass.current)
    hideInstances(bars.current)
  }, [])

  useFrame((_, dt) => {
    const gm = glass.current
    const bm = bars.current
    if (!gm || !bm) return
    // sim time while the sim runs (so the doors keep up with the crowd at 2x and 4x); REAL time while it is paused, so the doors
    // still open for you
    const step = doorStepSeconds(dt, loop.paused, loop.speed)

    // you: where you are, and (walking) the way you are going
    const mode = sim.player?.mode
    const walking = mode !== undefined && mode !== 'overview'
    const you = sim.entities.get('player')?.position ?? sim.player ?? null
    const lead: CoreLead | null = walking && walkBody.live ? state.lead : null
    if (lead) {
      // the velocity you have, or the one your keys ask for when that is faster (the door starts opening as you press the key)
      const useWish = walkBody.wishX * walkBody.wishX + walkBody.wishZ * walkBody.wishZ > walkBody.vx * walkBody.vx + walkBody.vz * walkBody.vz
      lead.vx = useWish ? walkBody.wishX : walkBody.vx
      lead.vz = useWish ? walkBody.wishZ : walkBody.vz
      lead.seconds = CONFIG.player.doorLeadSeconds
    }
    let changed = !state.written
    // Tab into a doorway: the leaves around you open at once, they are never solid around you
    if (walking && !state.wasWalking && you && state.doors.snapOpenNear(you, lead)) changed = true
    state.wasWalking = walking
    if (state.doors.update(step, sim.people, you, lead)) changed = true
    state.blockers.count = writeCoreBlockers(OPENINGS, state.doors.shown, state.blockers.data)
    if (!changed) return
    state.written = true

    for (let i = 0; i < N; i++) {
      const o = OPENINGS[i]
      const e = state.doors.shown[i]
      // two leaves, each half the opening; they slide outwards, in front of the fixed glass on the core side
      const leafW = coreLeafWidth(o)
      const z = coreLeafZ(o)
      for (let side = 0; side < 2; side++) {
        const cx = coreLeafX(o, side, e)
        const leaf = i * 2 + side
        setBar(gm, leaf, cx, 0.02 + LEAF_H / 2, z, leafW - 0.02, LEAF_H, 1)
        const b = leaf * BARS
        setBar(bm, b, cx, 0.045, z, leafW, 0.05, DOOR.leafT)
        setBar(bm, b + 1, cx, 0.02 + LEAF_H - 0.025, z, leafW, 0.05, DOOR.leafT)
        setBar(bm, b + 2, cx - (leafW / 2 - 0.02), 0.02 + LEAF_H / 2, z, 0.04, LEAF_H, DOOR.leafT)
        setBar(bm, b + 3, cx + (leafW / 2 - 0.02), 0.02 + LEAF_H / 2, z, 0.04, LEAF_H, DOOR.leafT)
      }
    }
    gm.instanceMatrix.needsUpdate = true
    bm.instanceMatrix.needsUpdate = true
  }, FRAME_PRIORITY.doors)

  return (
    <group name="pharmacist-doors">
      <instancedMesh ref={glass} args={[geo.leaf, MAT.glass, N * 2]} frustumCulled={false} renderOrder={3} />
      <instancedMesh ref={bars} args={[geo.bar, MAT.frame, N * 2 * BARS]} frustumCulled={false} />
    </group>
  )
}
