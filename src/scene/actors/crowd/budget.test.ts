/**
 * The crowd's budget, in node: how many draw calls it takes, how many triangles it submits at 200 people, and how much CPU a frame of the pose
 * and rig solve costs. Builds the real three.js side (crowdRig.ts) without a GL context, so the instance counts and geometry sizes are the ones a
 * frame would draw.
 */
import { describe, expect, it } from 'vitest'
import type { Mesh } from 'three'
import { ATTIRE, type AnimState, type Entity, type PatientPoseView, type PropKind, type Role, type StaffAct, type VehicleKind } from '@/sim/types'
import { BUILDING, VIEW } from '@/sim/places'
import { attachPeople, createCrowdRig, driveCrowd, type CrowdRig } from './crowdRig'
import { loadPeopleFromDisk } from './avatars.testkit'
import { LOD_TRIANGLES } from './avatars'
import { buildBodyGeometries } from './geometry'
import { highlight } from './runtime'

const ROLE_MIX: Role[] = ['nurse', 'nurse', 'nurse', 'doctor', 'doctor', 'patient', 'patient', 'patient', 'visitor', 'visitor', 'porter', 'cleaner', 'pharmacist', 'receptionist', 'coordinator', 'paramedic']
const ANIMS: AnimState[] = ['idle', 'walk', 'walk', 'walk', 'talk', 'tablet', 'carry', 'wave', 'give', 'run']
const PROPS: PropKind[] = ['none', 'none', 'tablet', 'folder', 'tray', 'coffee', 'bag', 'flowers']

/** A deterministic hospital crowd: `n` people spread over the building, a few pushing wheelchairs and stretchers, some seated and lying. */
function crowd(n: number): Map<string, Entity> {
  let seed = 20261012
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const out = new Map<string, Entity>()
  const add = (e: Partial<Entity> & { id: string }): Entity => {
    const full: Entity = {
      role: 'nurse',
      name: e.id,
      position: { x: 0, y: 0, z: 0 },
      heading: 0,
      speed: 0,
      anim: 'idle',
      emote: 'none',
      mood: 'neutral',
      tier: 'near',
      variant: Math.floor(rnd() * 1000),
      ...e,
    }
    out.set(full.id, full)
    return full
  }
  const at = () => ({ x: BUILDING.x0 + 2 + rnd() * (BUILDING.x1 - BUILDING.x0 - 4), y: 0, z: BUILDING.z0 + 2 + rnd() * (BUILDING.z1 - BUILDING.z0 - 4) })
  // wheeled pairs: 4 wheelchairs, 2 stretchers, 3 carts
  for (let i = 0; i < 6; i++) {
    const vehicle: VehicleKind = i < 4 ? 'wheelchair' : 'stretcher'
    const p = at()
    const h = rnd() * 6.28 - 3.14
    const ahead = vehicle === 'wheelchair' ? 0.8 : 1.45
    add({ id: `pusher-${i}`, role: i % 2 ? 'porter' : 'paramedic', position: p, heading: h, anim: 'push', vehicle, speed: 1.1 })
    add({ id: `rider-${i}`, role: 'patient', outfit: 'gown', position: { x: p.x + Math.sin(h) * ahead, y: 0, z: p.z + Math.cos(h) * ahead }, heading: h, anim: vehicle === 'wheelchair' ? 'sit' : 'lie', vehicle, riding: true })
  }
  for (let i = 0; i < 3; i++) add({ id: `cart-${i}`, role: i ? 'porter' : 'cleaner', position: at(), heading: rnd() * 6.28 - 3.14, anim: 'push', vehicle: i ? 'linenCart' : 'cleaningCart', speed: 1 })
  // patients in beds, a few seated people, the rest walking and working
  let k = 0
  while (out.size < n) {
    const i = k++
    const role = ROLE_MIX[i % ROLE_MIX.length]
    if (role === 'patient' && i % 3 === 0) add({ id: `bed-${i}`, role, outfit: 'gown', position: at(), anim: 'lie', heading: i % 2 ? 0 : Math.PI })
    else if (i % 11 === 0) add({ id: `sit-${i}`, role: i % 2 ? 'visitor' : 'coordinator', position: { ...at(), y: 0.45 }, anim: 'sit' })
    else add({ id: `p-${i}`, role, position: at(), heading: rnd() * 6.28 - 3.14, anim: ANIMS[i % ANIMS.length], speed: 1.3, prop: PROPS[i % PROPS.length] })
  }
  return out
}

/** Triangles a draw submits: index count times its instances. */
function submitted(rig: CrowdRig): { calls: number; triangles: number; perMesh: Record<string, number> } {
  let calls = 0
  let triangles = 0
  const perMesh: Record<string, number> = {}
  for (const o of rig.objects) {
    if (!o.visible) continue
    const mesh = o as Mesh
    const geo = mesh.geometry
    const tri = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3
    const instances = 'isInstancedMesh' in o ? (o as unknown as { count: number }).count : 'instanceCount' in geo ? (geo as unknown as { instanceCount: number }).instanceCount : 1
    if (!(instances > 0)) continue
    calls++
    triangles += tri * instances
    perMesh[o.name] = tri * instances
  }
  return { calls, triangles, perMesh }
}

function frames(rig: CrowdRig, es: Map<string, Entity>, cam: [number, number, number], n: number, t0 = 0): void {
  for (let i = 0; i < n; i++) {
    // everyone who walks moves, so the planters really step
    for (const e of es.values()) {
      if (e.anim === 'walk' || e.anim === 'run' || e.anim === 'push') {
        e.position.x += Math.sin(e.heading) * 1.3 * (1 / 60)
        e.position.z += Math.cos(e.heading) * 1.3 * (1 / 60)
      }
    }
    driveCrowd(rig, es, cam[0], cam[1], cam[2], 1 / 60, t0 + i / 60)
  }
}

const OVERVIEW: [number, number, number] = [VIEW.center.x, 80, 66]
const CLOSE: [number, number, number] = [-11, 9, 8]
/** W1: the walk camera, at eye level inside the building (about 1.7 m above the floor). */
const EYE_LEVEL: [number, number, number] = [-11, 1.7, 8]

describe('crowd budget', () => {
  it('draws the whole crowd in at most 8 draw calls (7 plus the ring while somebody is selected)', () => {
    const rig = createCrowdRig()
    const es = crowd(200)
    frames(rig, es, OVERVIEW, 10)
    const a = submitted(rig)
    // (R5: the instruments are a ninth object, hidden while nobody near the camera holds one: never a draw at the overview)
    expect(rig.objects.length).toBeLessThanOrEqual(9)
    expect(rig.instruments.visible).toBe(false)
    expect(a.calls).toBeLessThanOrEqual(8)
    highlight.selectedId = 'pusher-0'
    frames(rig, es, OVERVIEW, 2)
    const b = submitted(rig)
    highlight.selectedId = null
    expect(rig.ring.visible).toBe(true)
    expect(b.calls).toBe(a.calls + 1)
    expect(b.calls).toBeLessThanOrEqual(8)
    frames(rig, es, OVERVIEW, 2)
    expect(rig.ring.visible).toBe(false)
    // bodies 3 + props 1 + vehicles 1 + blobs 1 (+ ring 1)
    expect(rig.bodies.length).toBe(3)
    console.log(`draw calls at the overview: ${a.calls} (${Object.keys(a.perMesh).join(', ')}); with a selection: ${b.calls}`)
    rig.dispose()
  })

  it('stays within about 420k triangles at 200 people at the overview (mostly mid and far) and when everyone is near', () => {
    const rig = createCrowdRig()
    const es = crowd(200)
    frames(rig, es, OVERVIEW, 10)
    const over = submitted(rig)
    const st = rig.model.stats
    console.log(`overview: people ${st.people}, high ${st.high} mid ${st.mid} far ${st.far}, props ${st.props}, vehicles ${st.vehicles}, blobs ${st.blobs}, triangles ${Math.round(over.triangles)}`)
    expect(st.people).toBe(200)
    expect(st.mid + st.far).toBeGreaterThan(st.high) // mostly mid and far
    expect(over.triangles).toBeLessThan(350_000) // the overview is all mid and far bodies: the close-up head costs nothing there
    // the worst case: the camera in the middle of the ward, everyone within 24 m is high detail
    frames(rig, es, CLOSE, 10)
    const near = submitted(rig)
    console.log(`close: high ${rig.model.stats.high} mid ${rig.model.stats.mid} far ${rig.model.stats.far}, triangles ${Math.round(near.triangles)}`)
    expect(near.triangles).toBeLessThan(420_000)
    // and the absolute ceiling: all 200 at the high body
    const g = buildBodyGeometries()
    console.log(`triangles per body: high ${g.triangles.high}, mid ${g.triangles.mid}, far ${g.triangles.far}; 200 x high = ${200 * g.triangles.high}`)
    expect(200 * g.triangles.high).toBeLessThan(450_000)
    rig.dispose()
  })

  it('W1 close-up people: at most about 2.2k triangles for a person at eye level, and the mid and far bodies are as they were', () => {
    const g = buildBodyGeometries()
    // Waltz City's high body had 1,233 triangles; the close-up head, hair, hands and staff details take it to just under 2k
    expect(g.triangles.high).toBeGreaterThan(1233)
    expect(g.triangles.high).toBeLessThanOrEqual(2200)
    // the mid and far bodies are untouched by W1 (the close-up pieces are not built for them)
    expect(g.triangles.mid).toBe(487)
    expect(g.triangles.far).toBe(100)
    const rig = createCrowdRig()
    const es = crowd(200)
    frames(rig, es, EYE_LEVEL, 20)
    const a = submitted(rig)
    const st = rig.model.stats
    console.log(`eye level: high ${st.high} mid ${st.mid} far ${st.far}, draw calls ${a.calls}, triangles ${Math.round(a.triangles)}; triangles per person: high ${g.triangles.high}, mid ${g.triangles.mid}, far ${g.triangles.far}`)
    // nobody near the camera is drawn with anything but the high body, and nothing was added to the draw list
    expect(st.high).toBeGreaterThan(20)
    expect(rig.bodies.length).toBe(3)
    expect(a.calls).toBeLessThanOrEqual(7)
    expect(a.triangles).toBeLessThan(420_000)
    rig.dispose()
  })

  it('costs a couple of milliseconds of CPU per frame at 200 people (pose, rig solve, texture rows, lists)', () => {
    const rig = createCrowdRig()
    const es = crowd(200)
    frames(rig, es, OVERVIEW, 90) // warm up: JIT, fades, blends
    const measure = (cam: [number, number, number], label: string): number => {
      const runs = 300
      const t0 = process.hrtime.bigint()
      frames(rig, es, cam, runs, 10)
      const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs
      const st = rig.model.stats
      console.log(`CPU per frame at 200 people, ${label}: ${ms.toFixed(3)} ms (the benchmark loop also moves the walkers) — solved ${st.solved} of ${st.people}`)
      return ms
    }
    const overview = measure(OVERVIEW, 'overview')
    const close = measure(CLOSE, 'close')
    // generous: a loaded CI machine is several times slower than the laptop this was written on
    expect(overview).toBeLessThan(8)
    expect(close).toBeLessThan(12)
    rig.dispose()
  })
})

// ---------------------------------------------------------------------------------------------
// W3 wave B: the realistic people
// ---------------------------------------------------------------------------------------------

/** Draw calls and triangles of every visible crowd mesh, the realistic people's included. */
function submittedAll(rig: CrowdRig): { calls: number; triangles: number; perMesh: Record<string, number> } {
  let calls = 0
  let triangles = 0
  const perMesh: Record<string, number> = {}
  const meshes = [...rig.objects, ...(rig.people.visible ? rig.people.children : [])]
  for (const o of meshes) {
    if (!o.visible) continue
    const mesh = o as Mesh
    const geo = mesh.geometry
    const tri = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3
    const instances = 'isInstancedMesh' in o ? (o as unknown as { count: number }).count : 'instanceCount' in geo ? (geo as unknown as { instanceCount: number }).instanceCount : 1
    if (!(instances > 0)) continue
    calls++
    triangles += tri * instances
    perMesh[o.name] = tri * instances
  }
  return { calls, triangles, perMesh }
}

/** Triangles of the realistic people's bodies alone. */
const peopleTriangles = (perMesh: Record<string, number>): number => Object.entries(perMesh).reduce((s, [name, t]) => s + (/-(high|mid|far)$/.test(name) ? t : 0), 0)

describe('crowd budget with the realistic people', () => {
  it('200 people: at most 24 draw calls and 120k triangles at the overview, 46 and 450k at eye level; the selection ring adds one', async () => {
    const loaded = await loadPeopleFromDisk()
    const rig = createCrowdRig()
    attachPeople(rig, loaded)
    const es = crowd(200)
    frames(rig, es, OVERVIEW, 10)
    const over = submittedAll(rig)
    const st = rig.model.stats
    console.log(`people at the overview: ${st.avatars} avatars (near ${st.avatarHigh}, mid ${st.avatarMid}, far ${st.avatarFar}), draw calls ${over.calls}, triangles ${Math.round(over.triangles)}`, `(bodies ${peopleTriangles(over.perMesh)})`)
    expect(st.avatars).toBe(200)
    expect(st.high + st.mid + st.far).toBe(0)
    expect(over.calls).toBeLessThanOrEqual(24)
    // the people themselves (the props and vehicles meshes submit their merged kinds per instance, as they did before the people came)
    expect(peopleTriangles(over.perMesh)).toBeLessThanOrEqual(120_000)
    expect(over.triangles).toBeLessThan(200_000)
    // nearly everybody is on the 350 triangle body there
    expect(st.avatarFar).toBeGreaterThan(st.avatarHigh + st.avatarMid)
    frames(rig, es, EYE_LEVEL, 20)
    const eye = submittedAll(rig)
    console.log(`people at eye level: near ${rig.model.stats.avatarHigh}, mid ${rig.model.stats.avatarMid}, far ${rig.model.stats.avatarFar}, draw calls ${eye.calls}, triangles ${Math.round(eye.triangles)} (bodies ${peopleTriangles(eye.perMesh)})`)
    expect(eye.calls).toBeLessThanOrEqual(46)
    expect(peopleTriangles(eye.perMesh)).toBeLessThanOrEqual(450_000)
    expect(eye.triangles).toBeLessThanOrEqual(450_000)
    frames(rig, es, CLOSE, 20)
    const close = submittedAll(rig)
    console.log(`people from the close camera: draw calls ${close.calls}, triangles ${Math.round(close.triangles)}`)
    expect(close.calls).toBeLessThanOrEqual(46)
    expect(close.triangles).toBeLessThanOrEqual(450_000)
    // the absolute ceiling: one avatar body per draw, the meshes the people bring (3 per avatar, the badge and R2's theatre caps)
    // (R5: and the surgical masks and the gowns' skirts)
    expect(rig.people.children.length).toBe(loaded.avatars.length * 3 + 4)
    expect(LOD_TRIANGLES[2] * 200).toBeLessThanOrEqual(120_000)
    highlight.selectedId = 'pusher-0'
    frames(rig, es, OVERVIEW, 2)
    const sel = submittedAll(rig)
    highlight.selectedId = null
    expect(sel.calls).toBeLessThanOrEqual(25)
    rig.dispose()
  }, 60_000)

  it('costs about as much CPU per frame as the procedural crowd (every avatar is solved, its far body included)', async () => {
    const loaded = await loadPeopleFromDisk()
    /** One run of 120 frames, ms per frame. */
    const run = (rig: CrowdRig, es: Map<string, Entity>, cam: [number, number, number], t0: number): number => {
      const start = process.hrtime.bigint()
      frames(rig, es, cam, 120, t0)
      return Number(process.hrtime.bigint() - start) / 1e6 / 120
    }
    const plain = createCrowdRig()
    const real = createCrowdRig()
    attachPeople(real, loaded)
    const esA = crowd(200)
    const esB = crowd(200)
    const out: string[] = []
    for (const [cam, label] of [
      [OVERVIEW, 'overview'],
      [EYE_LEVEL, 'eye level'],
    ] as const) {
      frames(plain, esA, cam, 60)
      frames(real, esB, cam, 60)
      // interleaved, the best of five runs each: the least disturbed by the other test worker
      let a = Infinity
      let b = Infinity
      for (let k = 0; k < 5; k++) {
        a = Math.min(a, run(plain, esA, cam, 10 + k))
        b = Math.min(b, run(real, esB, cam, 10 + k))
      }
      out.push(`${label}: procedural ${a.toFixed(3)} ms, realistic ${b.toFixed(3)} ms (+${(b - a).toFixed(3)} ms; solved ${real.model.stats.solved} of ${real.model.stats.people})`)
      expect(b - a).toBeLessThan(0.3)
    }
    console.log(`CPU per frame at 200 people, ${out.join('; ')}`)
    plain.dispose()
    real.dispose()
  }, 60_000)
})

// ---------------------------------------------------------------------------------------------
// R5: a theatre team at work, close up (instruments in both hands, masks, gowns, the patient's breathing tube)
// ---------------------------------------------------------------------------------------------

/** The theatre: a team of seven in sterile attire acting at the table around (x, z), a patient on it with a tube; the rest of the crowd as above. */
function theatre(acting: boolean): Map<string, Entity> {
  const es = crowd(200)
  const x0 = -11
  const z0 = 10.5
  const work = { x: x0, y: 1.08, z: z0 }
  const team: [string, number, number, number, StaffAct][] = [
    ['surgeon', x0 + 0.55, z0, -Math.PI / 2, { action: 'closeSkin', progress: 0.3, left: 'forceps', right: 'needleHolder', work }],
    ['assistant', x0 - 0.55, z0 + 0.2, Math.PI / 2, { action: 'suction', progress: 0.5, left: 'none', right: 'lapSuction', work }],
    ['scrub', x0 - 0.5, z0 - 0.6, Math.PI / 2, { action: 'passInstrument', progress: 0.2, left: 'none', right: 'scissors', work: { x: x0, y: 1.15, z: z0 - 0.5 } }],
    ['anaesthetist', x0, z0 - 1.25, 0, { action: 'bagMask', progress: 0.4, left: 'bagValveMask', right: 'none', work: { x: x0, y: 1.05, z: z0 - 0.85 } }],
    ['circulator', x0 + 1.4, z0 - 1.2, -Math.PI / 2, { action: 'countItems', progress: 0.6, left: 'none', right: 'countBoard', work: { x: x0 + 0.9, y: 0.95, z: z0 - 1.2 } }],
    ['scrub2', x0 + 0.6, z0 + 0.9, -Math.PI / 2, { action: 'clipLap', progress: 0.3, left: 'none', right: 'lapClipApplier', work }],
    ['fellow', x0 - 0.5, z0 + 1, Math.PI / 2, { action: 'holdScope', progress: 0.3, left: 'none', right: 'laparoscope', work }],
  ]
  for (const [id, x, z, h, act] of team) {
    const e: Entity = { id: `r5-${id}`, role: id === 'anaesthetist' ? 'doctor' : 'nurse', name: id, outfit: 'theatre', position: { x, y: 0, z }, heading: h, speed: 0, anim: 'idle', emote: 'none', mood: 'neutral', tier: 'near', variant: id.length * 7 }
    if (acting) {
      e.act = act
      e.attire = id === 'circulator' || id === 'anaesthetist' ? ATTIRE.mask : ATTIRE.mask | ATTIRE.gown | ATTIRE.gloves
    }
    es.set(e.id, e)
  }
  const pose: PatientPoseView = { position: 'supine', headTiltDeg: 0, rollDeg: 0, arms: 'tucked', airway: acting ? 'tube' : 'none', awareness: 'asleep', prep: 1, drape: 1, marks: 'ports', catheter: false, manipulator: false }
  es.set('r5-patient', { id: 'r5-patient', role: 'patient', name: 'patient', outfit: 'gown', position: { x: x0, y: 0, z: z0 }, heading: 0, speed: 0, anim: 'lie', emote: 'none', mood: 'neutral', tier: 'near', variant: 4, patientPose: pose })
  return es
}

describe('R5: the theatre team close up', () => {
  const CAM: [number, number, number] = [-11, 1.75, 7.6]
  it('costs at most 3 more draw calls (instruments, masks, gown skirts) and about 33k more triangles; the overview pays nothing', async () => {
    const loaded = await loadPeopleFromDisk()
    const base = createCrowdRig()
    attachPeople(base, loaded)
    const r5 = createCrowdRig()
    attachPeople(r5, loaded)
    const esA = theatre(false)
    const esB = theatre(true)
    frames(base, esA, CAM, 40)
    frames(r5, esB, CAM, 40)
    const a = submittedAll(base)
    const b = submittedAll(r5)
    const st = r5.model.stats
    const added = (b.perMesh['crowd-instruments'] ?? 0) + (b.perMesh['crowd-masks'] ?? 0) + (b.perMesh['crowd-gowns'] ?? 0)
    console.log(`theatre close-up: draw calls ${a.calls} -> ${b.calls}; instruments ${st.instruments}, masks ${st.masks}, gowns ${st.gowns}; added triangles ${Math.round(added)} (instruments ${b.perMesh['crowd-instruments']}, masks ${b.perMesh['crowd-masks']}, gowns ${b.perMesh['crowd-gowns']})`)
    expect(st.instruments).toBeGreaterThanOrEqual(7)
    expect(st.masks).toBe(7)
    expect(st.gowns).toBe(5)
    expect(b.calls - a.calls).toBeLessThanOrEqual(3)
    expect(added).toBeLessThanOrEqual(33_000)
    // the overview: no instrument is listed, and the masks and gowns are gone with the near bodies
    frames(r5, esB, OVERVIEW, 10)
    expect(r5.instruments.visible).toBe(false)
    expect(r5.model.stats.instruments).toBe(0)
    const over = submittedAll(r5)
    expect(over.perMesh['crowd-instruments']).toBeUndefined()
    base.dispose()
    r5.dispose()
  }, 60_000)

  it('R5 wave 2: a patient in lithotomy with the arms tucked on a table tipped -25 degrees draws exactly what one lying flat does: no draw call and no triangle more (realistic and procedural)', async () => {
    const loaded = await loadPeopleFromDisk()
    const lithotomy: PatientPoseView = { position: 'lithotomy', headTiltDeg: -25, rollDeg: 8, arms: 'tucked', airway: 'tube', awareness: 'asleep', prep: 1, drape: 1, marks: 'ports', catheter: false, manipulator: false }
    const flat: PatientPoseView = { ...lithotomy, position: 'supine', headTiltDeg: 0, rollDeg: 0, arms: 'out' }
    const onTable = (pose: PatientPoseView): Map<string, Entity> => {
      const es = theatre(true)
      const pat = es.get('r5-patient')!
      pat.seated = { seatId: 'orTable:0', pose: 'lie' }
      pat.patientPose = pose
      return es
    }
    for (const realistic of [true, false]) {
      const a = createCrowdRig()
      const b = createCrowdRig()
      if (realistic) {
        attachPeople(a, loaded)
        attachPeople(b, loaded)
      }
      frames(a, onTable(flat), CAM, 240)
      frames(b, onTable(lithotomy), CAM, 240)
      expect(b.model.get('r5-patient')!.rig.tbl.on, 'the table paths ran').toBe(true)
      const x = submittedAll(a)
      const y = submittedAll(b)
      expect(y.calls, realistic ? 'realistic' : 'procedural').toBe(x.calls)
      expect(y.triangles, realistic ? 'realistic' : 'procedural').toBe(x.triangles)
      a.dispose()
      b.dispose()
    }
  }, 60_000)

  it('the procedural crowd draws the instruments too (one draw), and hides the mesh when nobody near holds one', () => {
    const rig = createCrowdRig()
    const es = theatre(true)
    frames(rig, es, CAM, 30)
    expect(rig.instruments.visible).toBe(true)
    expect(rig.model.stats.instruments).toBeGreaterThanOrEqual(7)
    for (const e of es.values()) {
      e.act = null
      if (e.patientPose) e.patientPose = null
    }
    frames(rig, es, CAM, 30)
    expect(rig.instruments.visible).toBe(false)
    expect(rig.instrumentGeometry.instanceCount).toBe(0)
    rig.dispose()
  })
})
