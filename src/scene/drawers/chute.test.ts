import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { BANDS, DRAWER_CHUTES, ROBOT, ROOMS, WALL, wardSign } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import { totalOf } from '@/scene/robots/budget'
import { CAB, cabinetFlip } from './cabinet'
import {
  buildChuteGlass,
  buildChuteHardware,
  CHUTE,
  CHUTE_LAYOUTS,
  chuteHardwareLocal,
  chuteLayout,
  chuteStrip,
  FUNNEL,
  funnelGeometry,
  funnelRotation,
  funnelTipOutward,
} from './chute'
import { chutesBudget, drawersBudget } from './manifest'
import { flightGeom, flightTimes, landTime, makePose, PACK, PACK_POOL, packPose, packsLanded, simDeliverySeconds } from './packFlight'

const T = CONFIG.drawers.transferSecondsPerItem
const WALL_FACE = BANDS.roomWall - WALL.thickness / 2

function bbox(g: BufferGeometry) {
  g.computeBoundingBox()
  return g.boundingBox!
}

/** Every vertex of a geometry, as [x, y, z]. */
function vertices(g: BufferGeometry): [number, number, number][] {
  const p = g.getAttribute('position')
  const out: [number, number, number][] = []
  for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)])
  return out
}

describe('the chute contract (src/sim/places.ts DRAWER_CHUTES), room by room', () => {
  it('has one chute per room, in the same order', () => {
    expect(DRAWER_CHUTES).toHaveLength(ROOMS.length)
    DRAWER_CHUTES.forEach((c, i) => expect(c.roomId).toBe(ROOMS[i].id))
    CHUTE_LAYOUTS.forEach((l, i) => expect(l.roomId).toBe(ROOMS[i].id))
  })

  it('every chute top is under the pod, its bottom is the cabinet top, and it hugs the wall face', () => {
    for (const [i, c] of DRAWER_CHUTES.entries()) {
      const room = ROOMS[i]
      expect(c.topY, `${c.roomId} top`).toBeLessThan(ROBOT.podBottomY)
      expect(c.topY, `${c.roomId} top is just under the pod`).toBeGreaterThan(ROBOT.podBottomY - 0.15)
      expect(c.bottomY, `${c.roomId} bottom`).toBe(WALL.cutHeight)
      // within 0.2 m of the corridor face of the room wall, on the corridor side of it
      expect(Math.abs(Math.abs(c.z) - WALL_FACE), `${c.roomId} wall distance`).toBeLessThanOrEqual(0.2)
      expect(Math.abs(c.z), `${c.roomId} corridor side`).toBeLessThan(WALL_FACE)
      expect(Math.sign(c.z)).toBe(wardSign(room.ward))
      // above the drawer, inside the cabinet's 0.8 m gap
      expect(Math.abs(c.x - room.drawer.x)).toBeLessThanOrEqual(0.2)
    }
  })

  it('every funnel reaches funnelTo (under the docked pod) within 0.1 m, 0.4 to 0.6 m out from the wall', () => {
    const g = funnelGeometry()
    const maxZ = bbox(g).max.z
    for (const [i, c] of DRAWER_CHUTES.entries()) {
      const l = CHUTE_LAYOUTS[i]
      expect(c.funnelTo).toEqual(ROOMS[i].podDock)
      // the deployed tray's far end in the world (plan view): from the tube axis, `reach` m out into the corridor
      const reach = maxZ * l.funnelScale * Math.cos(FUNNEL.deployTilt)
      const tip = { x: c.x, z: c.z + l.flip * reach }
      expect(Math.hypot(tip.x - c.funnelTo.x, tip.z - c.funnelTo.z), `${c.roomId} funnel tip to funnelTo`).toBeLessThan(0.1)
      expect(reach).toBeCloseTo(funnelTipOutward(l), 6)
      // the pod's hatch (funnelTo) is wholly over the tray, 0.4 to 0.6 m from the wall's tube
      expect(l.dropZ, `${c.roomId} drop`).toBeGreaterThanOrEqual(0.4)
      expect(l.dropZ, `${c.roomId} drop`).toBeLessThanOrEqual(0.6)
      expect(Math.abs(l.dropX), `${c.roomId} lateral`).toBeLessThan(0.05)
      expect(reach).toBeGreaterThan(l.dropZ + 0.05)
    }
    g.dispose()
  })

  it('the tube stands on the cabinet top, wholly inside it', () => {
    for (const [i, c] of DRAWER_CHUTES.entries()) {
      const room = ROOMS[i]
      const flip = cabinetFlip(room)
      const zs = [room.drawer.z + flip * CAB.zRoom, room.drawer.z + flip * CAB.zCorr]
      const cap = { x0: room.drawer.x - CAB.w / 2, x1: room.drawer.x + CAB.w / 2, z0: Math.min(...zs), z1: Math.max(...zs) }
      expect(c.x - CHUTE.radius, `${c.roomId}`).toBeGreaterThanOrEqual(cap.x0 - 1e-9)
      expect(c.x + CHUTE.radius).toBeLessThanOrEqual(cap.x1 + 1e-9)
      expect(c.z - CHUTE.radius).toBeGreaterThanOrEqual(cap.z0 - 1e-9)
      expect(c.z + CHUTE.radius).toBeLessThanOrEqual(cap.z1 + 1e-9)
      // and the wall face leaves room for the plate behind the tube
      expect(CHUTE_LAYOUTS[i].back).toBeGreaterThan(CHUTE.radius)
    }
  })
})

describe('the chute geometry', () => {
  it('the glass tube runs from the cabinet top to just under the pod', () => {
    const l = CHUTE_LAYOUTS[0]
    const b = bbox(buildChuteGlass([l]))
    expect(b.min.y).toBeCloseTo(l.bottomY, 6)
    expect(b.max.y).toBeCloseTo(l.topY, 6)
    expect(b.max.x - b.min.x).toBeCloseTo(CHUTE.radius * 2, 2)
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(l.x, 6)
    expect((b.max.z + b.min.z) / 2).toBeCloseTo(l.z, 6)
  })

  it('the white hardware sits on the cabinet top, stays under the pod, and does not reach through the wall', () => {
    for (const l of CHUTE_LAYOUTS) {
      for (const part of chuteHardwareLocal(l)) {
        const b = bbox(part)
        expect(b.min.y, `${l.roomId} lowest`).toBeGreaterThanOrEqual(l.bottomY - 1e-5)
        expect(b.max.y, `${l.roomId} highest`).toBeLessThan(ROBOT.podBottomY)
        // chute-local z: the wall face is at -back; nothing goes more than the plate's sunk depth into it
        expect(b.min.z, `${l.roomId} back`).toBeGreaterThanOrEqual(-l.back - CHUTE.plate.sunk - 1e-9)
        part.dispose()
      }
    }
    const merged = buildChuteHardware()
    expect(merged.getAttribute('position').count).toBeGreaterThan(0)
    merged.dispose()
  })

  it('the glow strip lies on the back plate, inside the tube length', () => {
    for (const l of CHUTE_LAYOUTS) {
      const s = chuteStrip(l)
      expect(s.y - s.h / 2).toBeGreaterThan(l.bottomY)
      expect(s.y + s.h / 2).toBeLessThan(l.topY)
      // on the plate's front face: behind the tube axis, in front of the wall face
      expect(s.z).toBeLessThan(0)
      expect(s.z).toBeGreaterThan(-l.back)
    }
  })

  it('the funnel folds from against the wall (clear of it and of the ceiling) to under the pod (clear of its body)', () => {
    const g = funnelGeometry()
    const verts = vertices(g)
    for (const l of CHUTE_LAYOUTS.slice(0, 2)) {
      const at = (open: number) => {
        const a = funnelRotation(open)
        const c = Math.cos(a)
        const s = Math.sin(a)
        // rotation about x, instance z-scale first, then up to the hinge height (chute-local y, z)
        return verts.map(([, y, z]) => {
          const zs = z * l.funnelScale
          return { y: l.pivotY + y * c - zs * s, z: y * s + zs * c }
        })
      }
      const folded = at(0)
      expect(Math.max(...folded.map((p) => p.y)), `${l.roomId} folded top`).toBeLessThan(WALL.height - 0.1)
      // clear of the back plate's front face (so it does not clip the wall hardware) ...
      expect(Math.min(...folded.map((p) => p.z)), `${l.roomId} folded against the wall`).toBeGreaterThan(-l.back - CHUTE.plate.sunk + CHUTE.plate.t)
      // ... and never below the hinge
      expect(Math.min(...folded.map((p) => p.y)), `${l.roomId} folded bottom`).toBeGreaterThan(l.pivotY - 0.03)
      const out = at(1)
      expect(Math.max(...out.map((p) => p.y)), `${l.roomId} deployed top under the pod`).toBeLessThan(ROBOT.podBottomY)
      expect(Math.min(...out.map((p) => p.y)), `${l.roomId} deployed bottom at the tube rim`).toBeGreaterThan(l.topY - 0.03)
    }
    g.dispose()
  })

  it('the funnel eases from folded to deployed', () => {
    expect(funnelRotation(0)).toBeCloseTo(FUNNEL.foldAngle, 9)
    expect(funnelRotation(1)).toBeCloseTo(-FUNNEL.deployTilt, 9)
    let prev = funnelRotation(0)
    for (let k = 1; k <= 20; k++) {
      const a = funnelRotation(k / 20)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
    // clamps outside 0..1
    expect(funnelRotation(-1)).toBe(funnelRotation(0))
    expect(funnelRotation(2)).toBe(funnelRotation(1))
  })

  it('a layout can be rebuilt from the contract and is deterministic', () => {
    expect(chuteLayout(DRAWER_CHUTES[3])).toEqual(CHUTE_LAYOUTS[3])
  })
})

describe('chute and funnel budget (W2: at most 3 draw calls and 12 k triangles)', () => {
  const lines = chutesBudget()
  const total = totalOf(lines)

  it('prints the breakdown (for the report)', () => {
    const d = drawersBudget()
    console.log(
      [
        ...lines.map((l) => `${l.name.padEnd(18)} ${l.drawCalls} call  ${String(Math.round(l.triangles)).padStart(6)} tris`),
        `chutes + funnels   ${total.drawCalls} calls / ${Math.round(total.triangles)} tris`,
        `drawers (all)      ${totalOf(d).drawCalls} calls / ${Math.round(totalOf(d).triangles)} tris`,
      ].join('\n'),
    )
    expect(lines).toHaveLength(3)
  })

  it('stays within 3 draw calls', () => {
    expect(total.drawCalls).toBeLessThanOrEqual(3)
  })

  it('stays within 12 k triangles', () => {
    expect(total.triangles).toBeLessThanOrEqual(12_000)
  })

  it('the packs in flight and the glow strips add instances to existing meshes, never a draw call', () => {
    const d = drawersBudget()
    expect(d.every((l) => l.drawCalls === 1 && l.triangles > 0)).toBe(true)
    // shell+hatches, cap, slots, 3 chute meshes, drawers, packs, lights
    expect(d).toHaveLength(9)
    expect(PACK_POOL).toBeLessThanOrEqual(16)
    expect(PACK_POOL).toBeGreaterThanOrEqual(ROBOT.podsPerWard * 2)
  })
})

describe('the pack timeline of a delivery (pure)', () => {
  const geom = flightGeom(CHUTE_LAYOUTS[2])

  it('ends with N packs in the drawer, at the sim pace: one pack per drawers.transferSecondsPerItem', () => {
    for (const n of [1, 2, 3, 4]) {
      for (const secondsPerItem of [T, 0.5, 2.5]) {
        const sim = simDeliverySeconds(n, secondsPerItem)
        expect(packsLanded(n, 0, secondsPerItem)).toBe(0)
        // the last pack is in before the sim loads the drawer, and not long before
        expect(landTime(n - 1, secondsPerItem), `n=${n} T=${secondsPerItem}`).toBeLessThanOrEqual(sim)
        expect(landTime(n - 1, secondsPerItem)).toBeGreaterThan(sim - secondsPerItem)
        expect(packsLanded(n, sim, secondsPerItem)).toBe(n)
        expect(packsLanded(n, sim * 3, secondsPerItem)).toBe(n)
        // one more pack every slot
        for (let k = 0; k < n; k++) {
          expect(packsLanded(n, landTime(k, secondsPerItem) - 1e-6, secondsPerItem)).toBe(k)
          expect(packsLanded(n, landTime(k, secondsPerItem) + 1e-6, secondsPerItem)).toBe(k + 1)
        }
      }
    }
  })

  it('one pack is in flight at a time (a journey is shorter than a slot), so one pool slot per pod is enough', () => {
    const f = flightTimes()
    expect(f.journey).toBeLessThan(f.slot)
    expect(f.lead + f.journey).toBeLessThanOrEqual(f.slot)
    const pose = makePose()
    const n = 4
    let seen = -1
    for (let t = 0; t <= simDeliverySeconds(n) + 1; t += 0.005) {
      packPose(n, t, geom, pose)
      if (!pose.visible) continue
      // visible packs come in order 0, 1, 2 ... never back, never two at once
      expect(pose.index).toBeGreaterThanOrEqual(seen)
      expect(pose.index).toBeLessThan(n)
      seen = pose.index
    }
    expect(seen).toBe(n - 1)
  })

  it('leaves the pod hatch at the pod, ends inside the cabinet, and always stays in the funnel then the tube', () => {
    const pose = makePose()
    const f = flightTimes()
    // the moment it leaves the hatch: under the pod body, over the hatch point
    packPose(1, f.lead + 1e-6, geom, pose)
    expect(pose.visible).toBe(true)
    expect(pose.y - PACK.y / 2).toBeGreaterThan(ROBOT.podBottomY)
    expect(pose.z).toBeCloseTo(geom.dropZ, 6)
    expect(pose.x).toBeCloseTo(geom.dropX, 6)
    // a hair before it lands in the cabinet: below the cabinet top
    packPose(1, landTime(0) - 1e-6, geom, pose)
    expect(pose.visible).toBe(true)
    expect(pose.y).toBeLessThan(geom.bottomY)
    expect(pose.y + PACK.y / 2).toBeLessThan(geom.bottomY)
    packPose(1, landTime(0) + 1e-6, geom, pose)
    expect(pose.visible).toBe(false)

    let lowest = Infinity
    let reachedTube = false
    for (let t = f.lead; t < landTime(0); t += 0.002) {
      packPose(1, t, geom, pose)
      expect(pose.visible).toBe(true)
      lowest = Math.min(lowest, pose.y)
      // always at or under the pod's bottom face once it is out of the hatch, never higher than where it started
      expect(pose.y).toBeLessThanOrEqual(ROBOT.podBottomY + PACK.y / 2 + 0.02 + 1e-9)
      // over the funnel's width on its way to the mouth ...
      expect(Math.abs(pose.x) + PACK.x / 2).toBeLessThanOrEqual(FUNNEL.w / 2)
      // ... and once it is below the funnel's rim it is on the tube axis, with its corners inside the tube
      if (pose.y < geom.pivotY - 0.03) {
        reachedTube = true
        expect(Math.hypot(Math.abs(pose.x) + PACK.x / 2, Math.abs(pose.z) + PACK.z / 2)).toBeLessThan(CHUTE.radius)
      }
    }
    expect(reachedTube).toBe(true)
    expect(lowest).toBeLessThan(geom.bottomY)
  })

  it('is hidden before the funnel has had time to fold out', () => {
    const pose = makePose()
    packPose(2, 0, geom, pose)
    expect(pose.visible).toBe(false)
    packPose(2, flightTimes().lead - 1e-3, geom, pose)
    expect(pose.visible).toBe(false)
    // the funnel is nearly open by the time the pack leaves the pod's hatch: its 0.6 s ease is mostly done
    expect(flightTimes().lead + flightTimes().journey * 0.16).toBeGreaterThan(FUNNEL.seconds * 0.8)
  })
})

describe('the real simulation: a delivery of N packs', () => {
  it('the drawer is loaded N slots after the pod docks, with the packs in the order of the pod compartments, and the pack timeline lands them first', () => {
    const sim = new Simulation(11)
    const items = [
      { medId: 'paracetamol', qty: 1 },
      { medId: 'furosemide', qty: 2 },
      { medId: 'omeprazole', qty: 1 },
    ]
    expect(sim.prescribe('A3', items).ok).toBe(true)
    const dt = CONFIG.sim.step
    const drawer = sim.meds.drawers.get('A3')!
    const chute = CHUTE_LAYOUTS[ROOMS.findIndex((r) => r.id === 'A3')]
    let startStep = -1
    let loadStep = -1
    let carried: (string | null)[] = []
    let podAt: { x: number; z: number } | null = null
    for (let step = 1; step <= 60 * 600 && loadStep < 0; step++) {
      sim.step(dt)
      for (const d of sim.meds.fleet.drivers) {
        // the exact signal DrawersLayer uses for the funnel and the packs
        if (d.pod.state === 'delivering' && sim.meds.jobOf(d.pod.id)?.roomId === 'A3' && startStep < 0) {
          startStep = step
          carried = d.pod.compartments.slice()
          // the renderer's interpolated pose (the loop calls sync every frame)
          sim.sync(1)
          podAt = { x: d.pod.position.x, z: d.pod.position.z }
        }
      }
      if (startStep >= 0 && drawer.state === 'loaded') loadStep = step
    }
    expect(startStep).toBeGreaterThan(0)
    expect(loadStep).toBeGreaterThan(startStep)

    // the sim's own pace: N items x transferSecondsPerItem between docking and loading the drawer
    const seconds = (loadStep - startStep) * dt
    expect(Math.abs(seconds - simDeliverySeconds(items.length))).toBeLessThanOrEqual(2 * dt)

    // N packs in the drawer by then; the packs of the layer are the drawer's items in order
    expect(drawer.items.map((i) => i.medId)).toEqual(items.map((i) => i.medId))
    expect(carried.filter((m) => m !== null)).toEqual(items.map((i) => i.medId))
    expect(packsLanded(items.length, seconds)).toBe(items.length)
    expect(packsLanded(items.length, simDeliverySeconds(items.length) - T)).toBe(items.length - 1)

    // the pod docked right under the funnel's drop point
    expect(podAt).not.toBeNull()
    const funnelTo = DRAWER_CHUTES[ROOMS.findIndex((r) => r.id === 'A3')].funnelTo
    expect(Math.hypot(podAt!.x - funnelTo.x, podAt!.z - funnelTo.z)).toBeLessThan(0.1)

    // replay what the layer does frame by frame (it counts sim time from the first 'delivering' frame): every pack is seen once, in order
    const pose = makePose()
    const geom = flightGeom(chute)
    const seen: number[] = []
    for (let t = 0; t <= seconds; t += dt) {
      packPose(items.length, t, geom, pose)
      if (pose.visible && seen[seen.length - 1] !== pose.index) seen.push(pose.index)
    }
    expect(seen).toEqual([0, 1, 2])
    packPose(items.length, seconds, geom, pose)
    expect(pose.visible).toBe(false)
  })
})

describe('the corridor hatch no longer opens (the pods deliver from the ceiling rail)', () => {
  it('DrawersLayer keeps no floor-level hatch animation', () => {
    const src = readFileSync(join(process.cwd(), 'src/scene/drawers/DrawersLayer.tsx'), 'utf8')
    expect(src).not.toMatch(/hatchWant|hatchOpen|HATCH_SECONDS|hatchAngle|hatchGeometry/)
  })
})
