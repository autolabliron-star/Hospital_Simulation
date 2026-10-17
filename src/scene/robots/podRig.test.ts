/**
 * Node tests of the hanging MedPods (W2): every instance follows `Pod.position` and `heading` with the body bottom at
 * `podBottomY`, the whole pod hangs under the rail and touches nothing below it (not even an open hatch), the pendulum sway is
 * gentle, damped, frozen while paused, swings the right way and is clamped to a centimetre or so at a dock, the hatches open on
 * the right states and on the right side per ward, and the light
 * ring, face and lids follow the pod. They run the real `PodRig` on real InstancedMeshes (three.js works without a browser).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3, type BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { MEDICINES } from '@/content/catalogue'
import { STATUS } from '@/scene/materials'
import { ROBOT } from '@/sim/places'
import type { Pod, PodLight, PodState } from '@/sim/types'
import { ROBOT_LIMITS } from './budget'
import { robotsBudget } from './manifest'
import { PodRig, type FaceDrawer, type PodMeshes } from './podRig'
import { HATCH_SECONDS, SWAY, easeHatch, isDocked, moveHatch, stepSway, swayTarget, wrapPi } from './podMotion'
import { HATCH, LID_CENTERS, POD, podBodyGeometry, podBogieGeometry, podFaceGeometry, podHatchGeometry, podLidGeometry, podRingGeometry, podTopAtMaxLean, podTopAtMaxSway } from './podParts'

const N = ROBOT.podsPerWard * 2
const LIDS = ROBOT.compartments
const EPS = 1e-6
const DIR = join(process.cwd(), 'src/scene/robots')

function makePods(): { pod: Pod }[] {
  return Array.from({ length: N }, (_, i) => ({
    pod: {
      id: `${i < ROBOT.podsPerWard ? 'A' : 'B'}${(i % ROBOT.podsPerWard) + 1}`,
      ward: i < ROBOT.podsPerWard ? 'A' : 'B',
      s: 0,
      position: { x: -20 + i * 3, y: 0, z: i < ROBOT.podsPerWard ? -14 : 14 },
      heading: i * 0.5 - 1,
      speed: 0,
      state: 'charging' as PodState,
      light: 'white' as PodLight,
      compartments: new Array<string | null>(LIDS).fill(null),
      waitingFor: null,
      battery: 1,
    },
  }))
}

interface Harness {
  meshes: PodMeshes
  geos: Record<keyof PodMeshes, BufferGeometry>
  rig: PodRig
  drivers: { pod: Pod }[]
  draws: [number, string][]
  simT: number
  /** One frame of `dt` sim seconds (0 while paused). */
  frame(dt: number, paused?: boolean): void
}

function harness(): Harness {
  const mat = new MeshBasicMaterial()
  const geos = {
    bogie: podBogieGeometry(),
    body: podBodyGeometry(),
    ring: podRingGeometry(),
    face: podFaceGeometry(N),
    lids: podLidGeometry(),
    hatches: podHatchGeometry(),
  }
  const meshes: PodMeshes = {
    bogie: new InstancedMesh(geos.bogie, mat, N),
    body: new InstancedMesh(geos.body, mat, N),
    ring: new InstancedMesh(geos.ring, mat, N),
    face: new InstancedMesh(geos.face, mat, N),
    lids: new InstancedMesh(geos.lids, mat, N * LIDS),
    hatches: new InstancedMesh(geos.hatches, mat, N * 4),
  }
  const draws: [number, string][] = []
  const drawer: FaceDrawer = { draw: (i, label) => draws.push([i, label]) }
  const rig = new PodRig(N, drawer, 0)
  rig.init(meshes)
  const orders = { get: (id: string) => (id === 'o1' ? { roomId: 'A3' } : undefined) }
  const h: Harness = {
    meshes,
    geos,
    rig,
    drivers: makePods(),
    draws,
    simT: 0,
    frame(dt, paused = false) {
      h.simT += dt
      rig.update(h.drivers, meshes, h.simT, paused ? 0 : dt, h.simT, orders)
    },
  }
  return h
}

/** World-space bounds of instance `index` of `mesh` (the geometry's vertices through the instance matrix). */
function bounds(mesh: InstancedMesh, geo: BufferGeometry, index: number): { min: Vector3; max: Vector3; centre: Vector3 } {
  const m = new Matrix4()
  mesh.getMatrixAt(index, m)
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  const p = geo.getAttribute('position')
  const v = new Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m)
    min.min(v)
    max.max(v)
  }
  return { min, max, centre: min.clone().add(max).multiplyScalar(0.5) }
}

function worldPoint(mesh: InstancedMesh, index: number, x: number, y: number, z: number): Vector3 {
  const m = new Matrix4()
  mesh.getMatrixAt(index, m)
  return new Vector3(x, y, z).applyMatrix4(m)
}

describe('hanging pod parts', () => {
  it('uses the contract: a 0.5 x 0.6 x 0.5 body from podBottomY to podTopY, hung from the rail underside', () => {
    expect(ROBOT.podSize).toEqual({ w: 0.5, l: 0.6, h: 0.5 })
    expect(ROBOT.podTopY - ROBOT.podBottomY).toBeCloseTo(ROBOT.podSize.h, 9)
    expect(POD.pivotY).toBe(ROBOT.rail.undersideY)
    expect(POD.bottom).toBeCloseTo(ROBOT.podBottomY - ROBOT.rail.undersideY, 9)
    expect(POD.top).toBeCloseTo(ROBOT.podTopY - ROBOT.rail.undersideY, 9)
    expect(LID_CENTERS.length).toBe(ROBOT.compartments)
  })

  it('has a body that spans the body size and a neck up to the pivot, and a bottom hatch that ends exactly on podBottomY', () => {
    const g = podBodyGeometry()
    const p = g.getAttribute('position')
    let top = -Infinity
    let bottom = Infinity
    let neckTop = -Infinity
    let xMax = 0
    let zMax = 0
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)]
      if (Math.hypot(x, z) > 0.1) {
        top = Math.max(top, y)
        bottom = Math.min(bottom, y)
      }
      neckTop = Math.max(neckTop, y)
      xMax = Math.max(xMax, Math.abs(x))
      zMax = Math.max(zMax, Math.abs(z))
    }
    expect(top).toBeCloseTo(POD.top, 6)
    expect(bottom).toBeCloseTo(POD.bottom + HATCH.proud, 6)
    expect(xMax).toBeCloseTo(ROBOT.podSize.w / 2, 6)
    expect(zMax).toBeCloseTo(ROBOT.podSize.l / 2, 6)
    expect(neckTop).toBeLessThan(0)
    expect(neckTop).toBeGreaterThan(POD.top)
    // the closed bottom hatch's lower face is the pod's lowest point
    expect(HATCH.bottomHinge.y - HATCH.t / 2).toBeCloseTo(POD.bottom, 9)
  })

  it('keeps the bogie under the rail and the lids on top of the body', () => {
    const g = podBogieGeometry()
    const p = g.getAttribute('position')
    let hi = -Infinity
    for (let i = 0; i < p.count; i++) hi = Math.max(hi, p.getY(i))
    expect(hi).toBeLessThanOrEqual(0)
    expect(hi).toBeGreaterThan(-0.01) // the trolley sits right under the rail
    for (const c of LID_CENTERS) {
      expect(c.y).toBeGreaterThan(POD.top)
      expect(Math.abs(c.x)).toBeLessThan(ROBOT.podSize.w / 2)
      expect(Math.abs(c.z)).toBeLessThan(ROBOT.podSize.l / 2)
    }
  })

  it('exposes the highest point of a pod at its largest sway, above the rest height and under the rail', () => {
    const rest = podTopAtMaxSway(0)
    const swung = podTopAtMaxSway(SWAY.peak)
    expect(rest).toBeGreaterThan(ROBOT.podTopY)
    expect(swung).toBeGreaterThan(rest)
    expect(swung).toBeLessThan(ROBOT.rail.undersideY)
    expect(podTopAtMaxLean()).toBe(swung)
  })
})

describe('pod instances follow the sim', () => {
  it('puts every pod at Pod.position, facing Pod.heading, with the body bottom at podBottomY (the pod y is ignored: it hangs from the rail)', () => {
    const h = harness()
    h.drivers.forEach((d, i) => (d.pod.position.y = i % 2 === 0 ? 0 : 7.5))
    h.frame(1 / 60)
    for (let i = 0; i < N; i++) {
      const pod = h.drivers[i].pod
      const body = bounds(h.meshes.body, h.geos.body, i)
      expect(body.centre.x).toBeCloseTo(pod.position.x, 5)
      expect(body.centre.z).toBeCloseTo(pod.position.z, 5)
      // body plus its bottom hatch: the lowest point is podBottomY
      const hatch = bounds(h.meshes.hatches, h.geos.hatches, i)
      expect(Math.min(body.min.y, hatch.min.y)).toBeCloseTo(ROBOT.podBottomY, 5)
      expect(body.max.y).toBeCloseTo(POD.pivotY + POD.neckTop, 5) // the neck reaches up to the bogie
      // the face is on the front: out along the heading
      const face = bounds(h.meshes.face, h.geos.face, i)
      const ahead = (face.centre.x - pod.position.x) * Math.sin(pod.heading) + (face.centre.z - pod.position.z) * Math.cos(pod.heading)
      expect(ahead).toBeCloseTo(ROBOT.podSize.l / 2 + POD.faceLift, 5)
      const side = (face.centre.x - pod.position.x) * Math.cos(pod.heading) - (face.centre.z - pod.position.z) * Math.sin(pod.heading)
      expect(Math.abs(side)).toBeLessThan(1e-5)
      // the bogie rides on the rail line right over the pod
      const bogie = bounds(h.meshes.bogie, h.geos.bogie, i)
      expect(bogie.centre.x).toBeCloseTo(pod.position.x, 5)
      expect(bogie.centre.z).toBeCloseTo(pod.position.z, 5)
      expect(bogie.max.y).toBeLessThanOrEqual(ROBOT.rail.undersideY + EPS)
    }
  })

  it('hangs entirely between podBottomY and the rail underside, touching nothing lower, at rest', () => {
    const h = harness()
    h.frame(1 / 60)
    const parts: [InstancedMesh, BufferGeometry, number, number][] = [
      [h.meshes.bogie, h.geos.bogie, N, 1],
      [h.meshes.body, h.geos.body, N, 1],
      [h.meshes.ring, h.geos.ring, N, 1],
      [h.meshes.face, h.geos.face, N, 1],
      [h.meshes.lids, h.geos.lids, N * LIDS, 1],
      [h.meshes.hatches, h.geos.hatches, N * 4, 1],
    ]
    for (const [mesh, geo, count] of parts) {
      for (let i = 0; i < count; i++) {
        const b = bounds(mesh, geo, i)
        expect(b.min.y, `${mesh.count} instance ${i} min`).toBeGreaterThanOrEqual(ROBOT.podBottomY - 1e-5)
        expect(b.max.y, `instance ${i} max`).toBeLessThanOrEqual(ROBOT.rail.undersideY + 1e-5)
      }
    }
  })

  it('keeps the whole pod at least 2.2 m up even at the largest sway of a hard stop', () => {
    const h = harness()
    const d = h.drivers[0].pod
    d.heading = 0
    d.speed = 1.2
    h.frame(1 / 60)
    let low = Infinity
    for (let k = 0; k < 240; k++) {
      d.speed = Math.max(0, d.speed - 1.2 / 60)
      h.frame(1 / 60)
      low = Math.min(low, bounds(h.meshes.body, h.geos.body, 0).min.y, bounds(h.meshes.hatches, h.geos.hatches, 0).min.y)
    }
    expect(low).toBeGreaterThan(ROBOT.podBottomY - 0.05)
    expect(low).toBeGreaterThan(2.2)
  })

  it('has six meshes for the pods and no floor shadow, no lanes, no lane arrows in the folder', () => {
    const h = harness()
    expect(Object.keys(h.meshes).sort()).toEqual(['body', 'bogie', 'face', 'hatches', 'lids', 'ring'])
    const files = readdirSync(DIR)
    expect(files).not.toContain('LanesLayer.tsx')
    expect(files).not.toContain('lanes.ts')
    expect(files).not.toContain('soup.ts')
    const layer = readFileSync(join(DIR, 'PodsLayer.tsx'), 'utf8')
    expect(layer.match(/<instancedMesh /g)?.length).toBe(ROBOT_LIMITS.podDrawCalls)
    expect(layer).not.toMatch(/createShadowMaterial|shadowGeo|blob/i)
    expect(readFileSync(join(DIR, 'faceMaterial.ts'), 'utf8')).not.toMatch(/createShadowMaterial|radialGradient/)
    expect(readFileSync(join(DIR, 'index.tsx'), 'utf8')).not.toMatch(/Lanes/)
  })

  it('counts the same meshes in the budget as the layers draw', () => {
    const lines = robotsBudget()
    expect(lines.filter((l) => l.name.startsWith('pods.')).length).toBe(ROBOT_LIMITS.podDrawCalls)
    expect(lines.some((l) => l.name.startsWith('lanes.'))).toBe(false)
    const rail = readFileSync(join(DIR, 'RailLayer.tsx'), 'utf8')
    expect(rail.match(/<mesh /g)?.length).toBe(lines.filter((l) => l.name.startsWith('rail.')).length)
  })
})

describe('pendulum sway', () => {
  /** One pod through a start, a cruise, a hard stop and a rest; returns the pitch it reached and when. */
  function stopRun(h: Harness, dtFrame = 1 / 60): { maxBack: number; maxFwd: number; settled: number } {
    const d = h.drivers[0].pod
    d.state = 'returning' // driving (a stopped 'charging' pod would be held by the dock clamp)
    d.heading = 0.3
    let maxBack = 0
    let maxFwd = 0
    let t = 0
    const pitch = (): number => h.rig.sway[0]
    const profile = (time: number): number => (time < 1.5 ? 0.8 * time : time < 3.5 ? 1.2 : time < 4.5 ? 1.2 - 1.2 * (time - 3.5) : 0)
    h.frame(dtFrame)
    for (; t < 4.5; t += dtFrame) {
      d.speed = profile(t)
      h.frame(dtFrame)
      maxBack = Math.max(maxBack, pitch())
      maxFwd = Math.min(maxFwd, pitch())
    }
    d.speed = 0
    for (let k = 0; k < 5 / dtFrame; k++) h.frame(dtFrame)
    return { maxBack, maxFwd: -maxFwd, settled: Math.abs(pitch()) }
  }

  it('swings back when speeding up and forward when braking, by a few degrees, and settles within seconds after the stop', () => {
    const r = stopRun(harness())
    const deg = 180 / Math.PI
    expect(r.maxBack * deg).toBeGreaterThan(1) // visible
    expect(r.maxFwd * deg).toBeGreaterThan(1.5) // the stop is harder than the start
    expect(r.maxBack).toBeLessThanOrEqual(SWAY.peak)
    expect(r.maxFwd).toBeLessThanOrEqual(SWAY.peak)
    expect(r.maxBack * deg).toBeLessThan(6)
    expect(r.maxFwd * deg).toBeLessThan(6)
    expect(r.settled).toBeLessThan(0.003)
  })

  it('rocks past the rest angle after a stop (an under-damped pendulum), but each swing is smaller than the last', () => {
    const h = harness()
    stopRun(h)
    const d = h.drivers[0].pod
    d.speed = 0
    // brake hard once more from cruise and watch the sign changes of the pitch after the stop
    d.speed = 1.2
    for (let k = 0; k < 60; k++) h.frame(1 / 60)
    for (let k = 0; k < 60; k++) {
      d.speed = Math.max(0, d.speed - 1.2 / 60)
      h.frame(1 / 60)
    }
    const peaks: number[] = []
    let prev = h.rig.sway[0]
    let rising = true
    for (let k = 0; k < 360; k++) {
      h.frame(1 / 60)
      const now = h.rig.sway[0]
      if (rising && now < prev) peaks.push(prev)
      if (!rising && now > prev) peaks.push(prev)
      rising = now >= prev
      prev = now
    }
    const swings = peaks.map((v) => Math.abs(v))
    expect(swings.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < Math.min(swings.length, 5); i++) expect(swings[i]).toBeLessThan(swings[i - 1] + 1e-4)
  })

  it('freezes while the sim is paused and runs on from where it stopped', () => {
    const h = harness()
    const d = h.drivers[0].pod
    d.heading = 0
    for (let k = 0; k < 45; k++) {
      d.speed = Math.min(1.2, d.speed + 0.8 / 60)
      h.frame(1 / 60)
    }
    const before = Array.from(h.rig.sway)
    for (let k = 0; k < 120; k++) h.frame(1 / 60, true) // paused: simDt = 0 (the sim clock also stands still in the app)
    expect(Array.from(h.rig.sway)).toEqual(before)
    h.frame(1 / 60)
    expect(Array.from(h.rig.sway)).not.toEqual(before)
  })

  it('is the same at 1x, 2x and 4x speed (in sim time) and never unstable', () => {
    const results: number[] = []
    for (const frame of [1 / 60, 2 / 60, 4 / 60, 0.4]) {
      const h = harness()
      const r = stopRun(h, frame)
      results.push(r.maxFwd)
      expect(Number.isFinite(r.maxFwd)).toBe(true)
      expect(r.maxFwd).toBeLessThanOrEqual(SWAY.peak)
      expect(r.settled).toBeLessThan(0.01)
    }
    for (const r of results) expect(Math.abs(r - results[0])).toBeLessThan(0.02)
  })

  it('swings out of a turn: turning towards the pod\'s +x pushes the hanging body towards -x', () => {
    const h = harness()
    const d = h.drivers[0].pod
    d.speed = 1.2
    d.heading = 0
    h.frame(1 / 60)
    for (let k = 0; k < 120; k++) {
      d.heading += (0.8 * 1) / 60 // a 1.5 m radius turn at 1.2 m/s, towards +x (heading increases)
      h.frame(1 / 60)
    }
    expect(h.rig.sway[2]).toBeLessThan(-0.02) // roll
    expect(Math.abs(h.rig.sway[2])).toBeLessThanOrEqual(SWAY.peak)
    expect(Math.abs(h.rig.sway[0])).toBeLessThan(0.01) // steady speed: no pitch
    // the body's middle is displaced to the outside of the turn, in the pod's own frame
    const b = bounds(h.meshes.body, h.geos.body, 0)
    const dx = b.centre.x - d.position.x
    const dz = b.centre.z - d.position.z
    const local = dx * Math.cos(d.heading) - dz * Math.sin(d.heading)
    expect(local).toBeLessThan(-0.005)
  })

  it('takes no pitch from heading wrap-around (pi to -pi) and starts a rebuilt hospital at rest', () => {
    expect(wrapPi(Math.PI * 2 - 0.01)).toBeCloseTo(-0.01, 9)
    expect(wrapPi(-Math.PI * 2 + 0.01)).toBeCloseTo(0.01, 9)
    const h = harness()
    for (const d of h.drivers) {
      d.pod.speed = 1.2
      d.pod.heading = 2.5
    }
    h.frame(1 / 60)
    for (let i = 0; i < N * 4; i++) expect(Math.abs(h.rig.sway[i])).toBeLessThan(1e-6) // first frame: no jolt from the unknown history
    h.rig.reset(h.simT)
    h.frame(1 / 60)
    for (let i = 0; i < N * 4; i++) expect(Math.abs(h.rig.sway[i])).toBeLessThan(1e-6)
  })

  it('soft-limits the target angle and is deterministic', () => {
    for (const a of [0.8, 1.2, 5, 50, -50]) expect(Math.abs(swayTarget(a))).toBeLessThanOrEqual(SWAY.max + 1e-12)
    expect(swayTarget(0)).toBe(0)
    expect(swayTarget(1)).toBeCloseTo(-swayTarget(-1), 12)
    const a = new Float32Array(2)
    const b = new Float32Array(2)
    for (let k = 0; k < 200; k++) {
      stepSway(a, 0, swayTarget(1.1), 1 / 60)
      stepSway(b, 0, swayTarget(1.1), 1 / 60)
    }
    expect(Array.from(a)).toEqual(Array.from(b))
    stepSway(a, 0, 1, 0)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

describe('hatches', () => {
  /** Where the free edge of a hatch (hatch space (0, 0, reach)) is, in the pod's own frame. */
  function freeEdge(h: Harness, index: number, pod: Pod): Vector3 {
    const w = worldPoint(h.meshes.hatches, index, 0, 0, HATCH.reach)
    const dx = w.x - pod.position.x
    const dz = w.z - pod.position.z
    return new Vector3(dx * Math.cos(pod.heading) - dz * Math.sin(pod.heading), w.y - POD.pivotY, dx * Math.sin(pod.heading) + dz * Math.cos(pod.heading))
  }
  /** The plate's far corner pair seen from the pod (hinge edge): its pod-frame z extent. */
  function plateZ(h: Harness, index: number, pod: Pod): [number, number] {
    const b = bounds(h.meshes.hatches, h.geos.hatches, index)
    const lo = new Vector3(b.min.x, 0, b.min.z)
    const hi = new Vector3(b.max.x, 0, b.max.z)
    const along = (v: Vector3): number => (v.x - pod.position.x) * Math.sin(pod.heading) + (v.z - pod.position.z) * Math.cos(pod.heading)
    // the plate is axis-aligned only at heading 0, so use all four corners
    const zs = [lo, hi, new Vector3(lo.x, 0, hi.z), new Vector3(hi.x, 0, lo.z)].map(along)
    return [Math.min(...zs), Math.max(...zs)]
  }

  it('lie closed against the body: the bottom one on the underside, the side one on the MedVend side (+x for ward A, -x for ward B)', () => {
    const h = harness()
    h.frame(1 / 60)
    for (let i = 0; i < N; i++) {
      const pod = h.drivers[i].pod
      const bottom = freeEdge(h, i, pod)
      expect(bottom.y).toBeCloseTo(HATCH.bottomHinge.y, 4)
      expect(bottom.z).toBeCloseTo(HATCH.bottomHinge.z + HATCH.reach, 4)
      const side = freeEdge(h, N + i, pod)
      const sign = HATCH.flipForWard(pod.ward) ? -1 : 1
      expect(side.x).toBeCloseTo(sign * ROBOT.podSize.w / 2, 4)
      expect(side.y).toBeCloseTo(HATCH.sideHinge.y - HATCH.reach, 4)
      expect(Math.abs(side.z)).toBeLessThan(1e-4)
    }
    expect(HATCH.flipForWard('A')).toBe(false)
    expect(HATCH.flipForWard('B')).toBe(true)
  })

  it('opens the bottom one while delivering (sliding back, never below podBottomY) and the side one while loading, and closes them again', () => {
    const h = harness()
    const a = h.drivers[0].pod // ward A
    const b = h.drivers[ROBOT.podsPerWard].pod // ward B
    a.heading = 0
    b.heading = 0
    h.frame(1 / 60)
    a.state = 'delivering'
    b.state = 'loading'
    for (let k = 0; k < 30; k++) h.frame(1 / 60) // 0.5 s: the bottom hatch (0.2 s) is open, the side hatch (0.5 s) too
    expect(h.rig.bottomOpen[0]).toBe(1)
    expect(h.rig.sideOpen[0]).toBe(0)
    const slid = freeEdge(h, 0, a)
    expect(slid.z).toBeCloseTo(HATCH.bottomHinge.z + HATCH.reach - HATCH.bottomSlide, 4) // the plate slid back its whole reach
    expect(slid.y).toBeCloseTo(HATCH.bottomHinge.y, 4) // and stayed level: nothing dips under the pod
    const [back, front] = plateZ(h, 0, a)
    expect(back).toBeCloseTo(HATCH.bottomHinge.z - HATCH.bottomSlide, 4)
    expect(front).toBeLessThanOrEqual(HATCH.bottomHinge.z + 1e-4) // clear of the opening (z from the hinge to +reach)
    expect(h.rig.sideOpen[ROBOT.podsPerWard]).toBe(1)
    expect(h.rig.bottomOpen[ROBOT.podsPerWard]).toBe(0)
    const out = freeEdge(h, N + ROBOT.podsPerWard, b)
    expect(out.x).toBeLessThan(-ROBOT.podSize.w / 2 - 0.2) // ward B's MedVend is on its -x side: the plate swung out that way
    expect(out.y).toBeGreaterThan(HATCH.sideHinge.y - HATCH.reach + 0.05) // and up
    // ward A's side hatch swings out to +x
    b.state = 'charging'
    a.state = 'loading'
    for (let k = 0; k < 40; k++) h.frame(1 / 60)
    expect(freeEdge(h, N, a).x).toBeGreaterThan(ROBOT.podSize.w / 2 + 0.2)
    expect(h.rig.bottomOpen[0]).toBe(0) // closed again on undock
    expect(freeEdge(h, 0, a).z).toBeCloseTo(HATCH.bottomHinge.z + HATCH.reach, 4)
  })

  it('opens the bottom hatch in 0.2 s and keeps it open the whole delivering phase', () => {
    const h = harness()
    const a = h.drivers[0].pod
    h.frame(1 / 60)
    a.state = 'delivering'
    for (let k = 0; k < 6; k++) h.frame(1 / 60) // 0.1 s: half way
    expect(h.rig.bottomOpen[0]).toBeGreaterThan(0.3)
    expect(h.rig.bottomOpen[0]).toBeLessThan(0.7)
    for (let k = 0; k < 7; k++) h.frame(1 / 60) // 0.2 s in (and a frame of rounding): open; the first pack leaves about 0.4 s in
    expect(h.rig.bottomOpen[0]).toBe(1)
    for (let k = 0; k < 600; k++) {
      h.frame(1 / 60)
      expect(h.rig.bottomOpen[0]).toBe(1)
    }
    a.state = 'returning'
    for (let k = 0; k < 13; k++) h.frame(1 / 60)
    expect(h.rig.bottomOpen[0]).toBe(0)
    expect(HATCH_SECONDS.bottom).toBeCloseTo(0.2, 9)
  })

  it('keeps a dark seat fixed under each plate: hidden by a closed plate, in view once it has moved, never lower than the plate', () => {
    const h = harness()
    const a = h.drivers[0].pod
    a.heading = 0
    h.frame(1 / 60)
    const c = new Color()
    for (let i = 0; i < N; i++) {
      h.meshes.hatches.getColorAt(i, c)
      expect(c.r + c.g + c.b).toBeGreaterThan(2.9) // plates keep the palette grey
      for (const k of [2 * N + i, 3 * N + i]) {
        h.meshes.hatches.getColorAt(k, c)
        expect(c.r + c.g + c.b).toBeLessThan(0.3) // seats are near-black
      }
    }
    const closedPlate = bounds(h.meshes.hatches, h.geos.hatches, 0)
    const seat = bounds(h.meshes.hatches, h.geos.hatches, 2 * N)
    expect(seat.min.y).toBeGreaterThan(closedPlate.min.y) // under the plate, never below the pod
    expect(seat.min.x).toBeGreaterThanOrEqual(closedPlate.min.x - 1e-6)
    expect(seat.max.x).toBeLessThanOrEqual(closedPlate.max.x + 1e-6)
    expect(seat.min.z).toBeGreaterThanOrEqual(closedPlate.min.z - 1e-6)
    expect(seat.max.z).toBeLessThanOrEqual(closedPlate.max.z + 1e-6)
    // the seat stands a little proud of the body's underside, so it shows once the plate has slid away
    expect(seat.min.y).toBeLessThan(ROBOT.podBottomY + HATCH.proud - 1e-4)
    a.state = 'delivering'
    for (let k = 0; k < 30; k++) h.frame(1 / 60)
    const same = bounds(h.meshes.hatches, h.geos.hatches, 2 * N)
    expect(same.min.z).toBeCloseTo(seat.min.z, 6) // the seat did not move with the plate
    expect(bounds(h.meshes.hatches, h.geos.hatches, 0).max.z).toBeLessThan(seat.min.z + 1e-4)
  })

  it('moves a hatch exactly to its target and eases the shown angle', () => {
    expect(moveHatch(0, 1, 10, 0.2)).toBe(1)
    expect(moveHatch(1, 0, 10, 0.2)).toBe(0)
    expect(moveHatch(0.5, 0.5, 1, 0.2)).toBe(0.5)
    expect(moveHatch(0, 1, 0.1, 0.2)).toBeCloseTo(0.5, 12)
    expect(easeHatch(0)).toBe(0)
    expect(easeHatch(1)).toBe(1)
    expect(easeHatch(0.5)).toBeCloseTo(0.5, 12)
    expect(easeHatch(0.1)).toBeLessThan(0.1)
    expect(easeHatch(2)).toBe(1)
  })
})

describe('a pod at a dock', () => {
  /** Brake hard from cruise to a stop, then flip to `state` on the frame it stops; returns the pod's lowest point and its bottom's sideways drift as a function of time since the stop. */
  function dock(state: PodState, brake: number): { at: (seconds: number) => { drop: number; drift: number; pitch: number } } {
    const h = harness()
    const d = h.drivers[0].pod
    d.heading = 0.4
    d.state = 'enRoute'
    d.speed = 1.2
    for (let k = 0; k < 120; k++) h.frame(1 / 60)
    while (d.speed > 0) {
      d.speed = Math.max(0, d.speed - brake / 60)
      h.frame(1 / 60)
    }
    d.state = state
    const samples: { drop: number; drift: number; pitch: number }[] = []
    for (let k = 0; k <= 120; k++) {
      const body = bounds(h.meshes.body, h.geos.body, 0)
      const hatch = bounds(h.meshes.hatches, h.geos.hatches, 0)
      const low = Math.min(body.min.y, hatch.min.y)
      // the middle of the body's underside, seen from the pod's own spot: how far the hanging body has drifted
      const under = worldPoint(h.meshes.body, 0, 0, POD.bottom + HATCH.proud, 0)
      samples.push({ drop: ROBOT.podBottomY - low, drift: Math.hypot(under.x - d.position.x, under.z - d.position.z), pitch: h.rig.sway[0] })
      h.frame(1 / 60)
    }
    return { at: (s) => samples[Math.round(s * 60)] }
  }

  it('is held by the dock clamp: delivering, loading and a parked pod in the rank', () => {
    expect(isDocked('delivering', 0)).toBe(true)
    expect(isDocked('loading', 0)).toBe(true)
    expect(isDocked('charging', 0)).toBe(true)
    expect(isDocked('charging', 0.9)).toBe(false) // still rolling forward in the rank
    for (const s of ['toDock', 'enRoute', 'returning'] as PodState[]) expect(isDocked(s, 0)).toBe(false)
  })

  it('has swung no more than a centimetre or two at its bottom half a second after a hard stop at a drawer (a funnel waits 1 cm under it)', () => {
    for (const brake of [0.8, 1.2, 3]) {
      const r = dock('delivering', brake)
      expect(r.at(0.5).drift, `drift at 0.5 s (brake ${brake})`).toBeLessThan(0.02)
      expect(r.at(0.5).drop, `drop at 0.5 s (brake ${brake})`).toBeLessThan(0.01)
      expect(r.at(1).drift).toBeLessThan(0.005)
      expect(r.at(1).drop).toBeLessThan(0.002)
    }
  })

  it('never lets the pod dip more than a centimetre under podBottomY once it is delivering, at the fleet\'s real braking (0.8 to 1.2 m/s^2)', () => {
    for (const brake of [0.8, 1.2]) {
      const r = dock('delivering', brake)
      let worst = 0
      for (let s = 0; s <= 2; s += 1 / 60) worst = Math.max(worst, r.at(s).drop)
      expect(worst, `worst drop (brake ${brake})`).toBeLessThan(0.01)
    }
  })

  it('settles much faster than a pod that is not docked (the free pendulum is still rocking after half a second)', () => {
    const clamped = dock('delivering', 1.2)
    const free = dock('returning', 1.2)
    expect(Math.abs(free.at(0.5).pitch)).toBeGreaterThan(Math.abs(clamped.at(0.5).pitch) * 3)
    expect(Math.abs(free.at(0.5).pitch)).toBeGreaterThan(0.01)
  })

  it('reaches the same few-degree swing before the stop as a free pod: the clamp only holds a docked pod', () => {
    const h = harness()
    const d = h.drivers[0].pod
    d.state = 'enRoute'
    d.heading = 0
    d.speed = 1.2
    h.frame(1 / 60)
    let peak = 0
    for (let k = 0; k < 90; k++) {
      d.speed = Math.max(0, d.speed - 1.2 / 60)
      h.frame(1 / 60)
      peak = Math.max(peak, Math.abs(h.rig.sway[0]))
    }
    expect(peak).toBeGreaterThan(0.03)
    expect(peak).toBeLessThanOrEqual(SWAY.peak)
  })
})

describe('ring, face and lids', () => {
  it('tints the light ring from Pod.light (teal, amber, green carry the status colours; amber pulses)', () => {
    const h = harness()
    const lights: PodLight[] = ['white', 'teal', 'amber', 'green']
    h.drivers.forEach((d, i) => (d.pod.light = lights[i % 4]))
    h.frame(1 / 60)
    const c = new Color()
    const want = { white: new Color(STATUS.idle).multiplyScalar(0.85), teal: new Color(STATUS.teal).multiplyScalar(1.7), green: new Color(STATUS.green).multiplyScalar(1.7) }
    for (let i = 0; i < N; i++) {
      h.meshes.ring.getColorAt(i, c)
      const l = lights[i % 4]
      if (l === 'amber') {
        // an amber pulse: the amber hue, brighter or dimmer
        const amber = new Color(STATUS.amber)
        expect(c.r / amber.r).toBeCloseTo(c.g / amber.g, 4)
        expect(c.r).toBeGreaterThan(0)
      } else expect([c.r, c.g, c.b].map((v) => +v.toFixed(4))).toEqual([want[l].r, want[l].g, want[l].b].map((v) => +v.toFixed(4)))
    }
  })

  it('draws a pod face only when its destination changes', () => {
    const h = harness()
    h.frame(1 / 60)
    expect(h.draws.length).toBe(N) // once per pod, the charge glyph
    h.frame(1 / 60)
    h.frame(1 / 60)
    expect(h.draws.length).toBe(N)
    h.drivers[3].pod.orderId = 'o1'
    h.frame(1 / 60)
    expect(h.draws.length).toBe(N + 1)
    expect(h.draws[N]).toEqual([3, 'A3'])
    h.frame(1 / 60)
    expect(h.draws.length).toBe(N + 1)
  })

  it('tints each compartment lid from Pod.compartments and puts the four lids on top of the body', () => {
    const h = harness()
    const med = MEDICINES[0]
    h.drivers[2].pod.compartments[1] = med.id
    h.frame(1 / 60)
    const c = new Color()
    h.meshes.lids.getColorAt(2 * LIDS + 1, c)
    const want = new Color(med.color)
    expect([c.r, c.g, c.b].map((v) => +v.toFixed(4))).toEqual([want.r, want.g, want.b].map((v) => +v.toFixed(4)))
    h.meshes.lids.getColorAt(2 * LIDS, c) // an empty compartment stays neutral
    expect(c.r).toBeCloseTo(new Color('#e1e8e8').r, 4)
    for (let k = 0; k < LIDS; k++) {
      const b = bounds(h.meshes.lids, h.geos.lids, 2 * LIDS + k)
      expect(b.centre.y).toBeGreaterThan(ROBOT.podTopY)
      expect(b.centre.y).toBeLessThan(ROBOT.podTopY + 0.04)
    }
  })
})
