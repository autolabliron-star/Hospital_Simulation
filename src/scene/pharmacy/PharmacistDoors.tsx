/**
 * The two sliding glass doors for the pharmacists (one per ward), each two leaves. The MedPods do not use doors any
 * more: they ride the ceiling rail through small portals near the top of the glass (see RailPortals).
 *
 * How they are driven (useFrame, no allocation): a door opens while any person is within 1.4 m of its centre and stays
 * open for 1 s after the last one leaves, then closes. The opening is a 0..1 value moved at a fixed rate in sim time
 * (frozen when paused, quicker at 2x and 4x) and shown through a smoothstep, so the leaves ease in and out. Glass leaves
 * and their four frame bars per leaf are two InstancedMeshes (`MAT.glass`, `MAT.frame`).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, Object3D, PlaneGeometry, type InstancedMesh } from 'three'
import { MAT } from '@/scene/materials'
import { hideInstances } from '@/scene/robots/instancing'
import { loop, sim } from '@/sim'
import { BARS_PER_LEAF as BARS, DOOR, OPENINGS } from './layout'

const N = OPENINGS.length
const LEAF_H = DOOR.height - 0.02

const dummy = new Object3D()
const raw = new Float32Array(N)
const sinceNear = new Float32Array(N).fill(99)

const smooth = (k: number): number => k * k * (3 - 2 * k)

function anyPersonNear(x: number, z: number, r2: number): boolean {
  const PEOPLE = sim.people
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i].entity.position
    const dx = p.x - x
    const dz = p.z - z
    if (dx * dx + dz * dz < r2) return true
  }
  return false
}

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
  useEffect(
    () => () => {
      geo.leaf.dispose()
      geo.bar.dispose()
    },
    [geo],
  )

  useLayoutEffect(() => {
    hideInstances(glass.current)
    hideInstances(bars.current)
  }, [])

  useFrame((_, dt) => {
    const gm = glass.current
    const bm = bars.current
    if (!gm || !bm) return
    const simDt = loop.paused ? 0 : Math.min(dt, 0.1) * loop.speed

    for (let i = 0; i < N; i++) {
      const o = OPENINGS[i]
      const near = anyPersonNear(o.x, o.z, DOOR.triggerPeople * DOOR.triggerPeople)
      sinceNear[i] = near ? 0 : sinceNear[i] + simDt
      const want = near || sinceNear[i] < DOOR.closeAfter ? 1 : 0
      // move toward `want` and rest there (a fully open door that should stay open must not start closing every other frame)
      if (want > raw[i]) raw[i] = Math.min(1, raw[i] + simDt * DOOR.speed)
      else if (want < raw[i]) raw[i] = Math.max(0, raw[i] - simDt * DOOR.speed)
      const e = smooth(raw[i])

      // two leaves, each half the opening; they slide outwards, in front of the fixed glass on the core side
      const leafW = o.width / 2
      const travel = leafW - 0.04
      const inward = o.side === 'N' ? 1 : -1
      const z = o.z + inward * DOOR.inset
      for (let side = 0; side < 2; side++) {
        const dir = side === 0 ? -1 : 1
        const cx = o.x + dir * (leafW / 2 + e * travel)
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
  })

  return (
    <group name="pharmacist-doors">
      <instancedMesh ref={glass} args={[geo.leaf, MAT.glass, N * 2]} frustumCulled={false} renderOrder={3} />
      <instancedMesh ref={bars} args={[geo.bar, MAT.frame, N * 2 * BARS]} frustumCulled={false} />
    </group>
  )
}
