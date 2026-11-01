/**
 * R5 wave 3 (agent J): the procedure stage's runtime (proc/runtime.ts) against the real crowd: a patient on the CT cryo table or the ultrasound couch, drawn by the crowd model
 * with the realistic avatars attached (the skin sources the rig attach makes), is found in the registry, skinned from the model's own pose rows (the body as the GPU draws it),
 * and the stage rides the entity: the table's travel into the bore carries the drapes. Also the fallbacks: the procedural body, a patient the sim posed with a copy of the view.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { P, ROW_FLOATS, TEX } from '@/scene/actors/crowd/constants'
import { loadPeopleFromDisk, cpuMesh, rowParts, skinAll } from '@/scene/actors/crowd/avatars.testkit'
import { buildBodyGeometries } from '@/scene/actors/crowd/geometry'
import { CrowdModel, type FrameInput } from '@/scene/actors/crowd/model'
import { setActiveCrowd } from '@/scene/actors/crowd/runtime'
import { measureLieFit } from '@/scene/actors/crowd/tablePatient'
import { skinSourceOfBody, skinSourceOfProcedural } from '@/scene/actors/crowd/skinSource'
import { levelView, shownAt } from '@/scene/levels/levelView'
import type { BufferAttribute } from 'three'
import { CRYO_SUITE, IMAGING } from '@/sim/places'
import type { Entity, PatientPoseView } from '@/sim/types'
import { applyBinds } from '@/scene/actors/crowd/avatars'
import { FIT_EPS, REFIT_EVERY, createProcRuntime, keyDelta, poseKeyInto, roomDrawn, stageDt, stepProcRuntime, suspendProcRuntime, type NeedleEntry, type ProcRuntime } from './runtime'
import { fitField, newSkinField } from './field'
import { ROOMS } from './config'
import { skinInto } from '@/scene/actors/crowd/skinSource'
import { PROC_PART } from './stage'

const POSE: PatientPoseView = { position: 'prone', headTiltDeg: 0, rollDeg: 0, arms: 'aboveHead', airway: 'none', awareness: 'asleep', prep: 1, drape: 1, marks: 'needles', catheter: false, manipulator: false }
const US_POSE: PatientPoseView = { ...POSE, position: 'supine', arms: 'oneUp', rollDeg: -8 }
const CRYO = CRYO_SUITE.ct.table
const US = IMAGING.us.table

function ent(o: Partial<Entity> & { id: string }): Entity {
  return { role: 'patient', outfit: 'gown', name: o.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'lie', emote: 'none', mood: 'neutral', tier: 'near', variant: 3, ...o } as Entity
}
const cryoEntity = (pose: PatientPoseView | null): Entity => ent({ id: 'pat', seated: { seatId: 'scanTable:cryo', pose: 'lie' }, position: { x: CRYO.out.x, y: 0, z: CRYO.out.z }, heading: CRYO.heading, patientPose: pose })
const usEntity = (pose: PatientPoseView | null): Entity => ent({ id: 'pat', seated: { seatId: 'usCouch:us', pose: 'lie' }, position: { x: US.out.x, y: 0, z: US.out.z }, heading: US.heading, patientPose: pose })

function frame(entities: Map<string, Entity>, t: number): FrameInput {
  return { dt: 1 / 60, time: t, camX: CRYO.out.x - 150, camY: 6.2, camZ: CRYO.out.z + 2, entities, followId: null, selectedId: null, hoverId: null, driven: null }
}
function runModel(m: CrowdModel, es: Map<string, Entity>, frames: number, t0 = 0): void {
  for (let i = 0; i < frames; i++) m.update(frame(es, t0 + i / 60))
}

const NEEDLES: NeedleEntry[] = [
  { entry: { x: 40, y: -80 }, dz: -10 },
  { entry: { x: 55, y: -70 }, dz: 25 },
]

describe('the procedure stage against the crowd', () => {
  const shownBefore = { shown: levelView.shown, overview: levelView.overview }
  let people: Awaited<ReturnType<typeof loadPeopleFromDisk>>
  beforeAll(async () => {
    people = await loadPeopleFromDisk()
  })
  afterEach(() => {
    setActiveCrowd(null)
    levelView.shown = shownBefore.shown
    levelView.overview = shownBefore.overview
  })

  function crowdWith(avatars: boolean): CrowdModel {
    const m = new CrowdModel()
    m.proceduralSkin = skinSourceOfProcedural(buildBodyGeometries().high)
    if (avatars) {
      m.setAvatars(
        people.avatars.map((a) => a.entry),
        [],
        [],
        [],
        people.avatars.map((a) => {
          const c = cpuMesh(a.lods[0])
          return measureLieFit(c.pos, c.joints, c.weights, c.count, a.entry.bindInverse)
        }),
        people.avatars.map((a) => skinSourceOfBody(a.lods[0])),
      )
    }
    setActiveCrowd(m)
    return m
  }

  /** Step the runtime (real frames of 1/60 s, the model too) until the stage is whole and still: no fit running, none to lay out, a few quiet frames. Returns the frames it took. */
  function settle(rt: ProcRuntime, view: PatientPoseView, needles: readonly NeedleEntry[] | null, target: 'kidney' | 'lung' | 'liver' = 'kidney', m?: CrowdModel, es?: Map<string, Entity>, t0 = 0): number {
    let quiet = 0
    for (let f = 0; f < 600; f++) {
      if (m && es) m.update(frame(es, t0 + f / 60))
      const before = rt.mem.builds + rt.skinnings
      stepProcRuntime(rt, view, needles, stageDt(1 / 60), target)
      const busy = rt.mem.field.busy || rt.mem.refitPending || rt.mem.builds + rt.skinnings !== before
      quiet = busy ? 0 : quiet + 1
      if (quiet >= 5) return f
    }
    throw new Error('the stage did not settle in 10 s')
  }

  it('finds the patient who carries the room\'s view, skins the body from the model\'s own rows (the GPU\'s numbers), fits it over a few frames and rides the entity: the table\'s travel carries the stage', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = crowdWith(true)
    const e = cryoEntity(POSE)
    const es = new Map([['pat', e]])
    runModel(m, es, 400)
    const slot = m.get('pat')!
    expect(slot.avatar).toBeGreaterThanOrEqual(0)
    const rt = createProcRuntime('cryo')
    expect(rt.mesh.visible).toBe(false)
    // the first frame skins and begins the fit; the stage is not drawn until the fit is whole (the fit is a job over frames: FIT_BUDGET units a frame)
    stepProcRuntime(rt, POSE, NEEDLES, 1 / 60)
    expect(rt.slot).toBe(slot)
    expect(rt.skinnings).toBe(1)
    expect(rt.mesh.visible).toBe(false)
    const frames = settle(rt, POSE, NEEDLES)
    expect(frames, 'the whole fit and the build take a handful of frames').toBeLessThan(30)
    expect(rt.mesh.visible).toBe(true)
    expect(rt.mem.mesh.ni).toBeGreaterThan(0)
    // the skin the stage was fitted to is the avatar skinned with the model's rows (binds applied), in the patient's frame (x, h above the table's top, z)
    const a = people.avatars[slot.avatar]
    const cpu = cpuMesh(a.lods[0])
    const rows = rowParts(m.data, slot.row).slice()
    const skinned = skinAll(cpu, rows)
    const surface = slot.seatHeight
    let worst = 0
    for (let i = 0; i < cpu.count; i++) {
      worst = Math.max(worst, Math.abs(rt.skinBuf[i * 3] - skinned[i * 3]), Math.abs(rt.skinBuf[i * 3 + 1] - (skinned[i * 3 + 1] - surface)), Math.abs(rt.skinBuf[i * 3 + 2] - skinned[i * 3 + 2]))
    }
    expect(worst).toBeLessThan(1e-4)
    // the stage's frame is the entity's: x, z the sim's, y the table's top, the heading its own
    const O = rt.mesh.matrix.elements
    expect(O[12]).toBeCloseTo(CRYO.out.x, 6)
    expect(O[14]).toBeCloseTo(CRYO.out.z, 6)
    expect(O[13]).toBeCloseTo(CRYO.height, 6)
    expect(Math.atan2(O[8], O[0])).toBeCloseTo(CRYO.heading, 6)
    // the table goes into the bore: the entity moves, and the next frame's matrix moves by the same
    const builds = rt.mem.builds
    const fits = rt.mem.field.fits
    e.position.x += CRYO.in.x - CRYO.out.x
    runModel(m, es, 30, 400 / 60)
    for (let i = 0; i < 30; i++) stepProcRuntime(rt, POSE, NEEDLES, 1 / 60)
    expect(rt.mesh.matrix.elements[12]).toBeCloseTo(CRYO.in.x, 6)
    expect(rt.mesh.matrix.elements[14]).toBeCloseTo(CRYO.in.z, 6)
    // the geometry is not rebuilt for the ride (the same fit, the same buffers)
    expect(rt.mem.builds).toBe(builds)
    expect(rt.mem.field.fits).toBe(fits)
  }, 120000)

  it('fits again while the body moves under a stage that is shown (the sim ran ahead: the prep is on while she still rolls), at most every REFIT_EVERY seconds and one job at a time, once more when she comes to rest, and not while she lies still; away from where the prep was done, nothing', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = crowdWith(true)
    // the entity's own pose (what the body follows) and the stage's view (the sim's: supine, prepped and draped) are two objects here, as when the sim has run ahead of the body
    const entityView: PatientPoseView = { ...POSE, position: 'supine', arms: 'out' }
    const view: PatientPoseView = { ...entityView }
    const es = new Map([['pat', cryoEntity(entityView)]])
    runModel(m, es, 300)
    const rt = createProcRuntime('cryo')
    settle(rt, view, NEEDLES)
    const still = rt.skinnings
    for (let i = 0; i < 60; i++) stepProcRuntime(rt, view, NEEDLES, 1 / 60)
    expect(rt.skinnings, 'lying still: no new skin').toBe(still)
    // the body turns onto its front (the entity's pose changes; the stage's view stays: the sim's step has not got there)
    entityView.position = 'prone'
    entityView.arms = 'aboveHead'
    const at: number[] = []
    let overlap = 0
    // (twelve seconds: the arms' follower is 95 % there in 4.3 s and at rest, under half a millimetre a second, at about nine)
    for (let i = 0; i < 12 * 60; i++) {
      m.update(frame(es, 5 + i / 60))
      const before = rt.skinnings
      const busyBefore = rt.mem.field.busy || rt.mem.refitPending
      stepProcRuntime(rt, view, NEEDLES, 1 / 60)
      if (rt.skinnings !== before) {
        at.push(i / 60)
        // (a new skin is never taken while a fit still reads the buffer, or before the stage has laid the last one out)
        if (busyBefore) overlap++
      }
    }
    expect(overlap, 'one job at a time').toBe(0)
    expect(at.length, 'the turn is followed').toBeGreaterThan(5)
    for (let k = 1; k < at.length; k++) expect(at[k] - at[k - 1], `skins ${k - 1} and ${k}`).toBeGreaterThanOrEqual(REFIT_EVERY - 1e-6)
    // and at rest again: the last skin is the resting pose's, nothing is running, and a few more frames add none
    const slot = m.get('pat')!
    poseKeyInto(slot, rt.key)
    expect(keyDelta(rt.key, rt.keyFit)).toBeLessThanOrEqual(FIT_EPS + 1e-9)
    expect(rt.mem.field.busy).toBe(false)
    const rest = rt.skinnings
    for (let i = 0; i < 60; i++) stepProcRuntime(rt, view, NEEDLES, 1 / 60)
    expect(rt.skinnings).toBe(rest)
    expect(rt.mesh.visible).toBe(true)
    // the sim turns her too (the view says prone): she is away from where the prep was done; nothing is shown, nothing is skinned, whatever she does
    view.position = 'prone'
    view.arms = 'aboveHead'
    for (let i = 0; i < 30; i++) stepProcRuntime(rt, view, NEEDLES, 1 / 60)
    expect(rt.mem.away).toBe(true)
    expect(rt.mesh.visible).toBe(false)
    expect(rt.mem.mesh.ni).toBe(0)
    expect(rt.skinnings).toBe(rest)
  }, 120000)

  it('a patient the sim posed with a COPY of the view is found by the room\'s table seat; a patient on another seat is not', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = crowdWith(true)
    const es = new Map([['pat', cryoEntity({ ...POSE })]])
    runModel(m, es, 300)
    const rt = createProcRuntime('cryo')
    settle(rt, POSE, NEEDLES)
    expect(rt.slot).toBe(m.get('pat'))
    expect(rt.mesh.visible).toBe(true)
    const other = new Map([['pat', ent({ id: 'pat', seated: { seatId: 'scanTable:ct', pose: 'lie' }, position: { x: CRYO.out.x, y: 0, z: CRYO.out.z }, heading: CRYO.heading, patientPose: { ...POSE } })]])
    const m2 = crowdWith(true)
    runModel(m2, other, 300)
    const rt2 = createProcRuntime('cryo')
    for (let i = 0; i < 90; i++) stepProcRuntime(rt2, POSE, NEEDLES, 1 / 60)
    expect(rt2.slot).toBeNull()
    expect(rt2.mesh.visible).toBe(false)
  }, 120000)

  it('the procedural body (no avatars loaded) is fitted too, from its own mesh', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = crowdWith(false)
    const es = new Map([['pat', cryoEntity(POSE)]])
    runModel(m, es, 400)
    expect(m.get('pat')!.avatar).toBe(-1)
    const rt = createProcRuntime('cryo')
    settle(rt, POSE, NEEDLES)
    expect(rt.slot).toBe(m.get('pat'))
    expect(rt.mesh.visible).toBe(true)
    expect(rt.mem.parts[PROC_PART.plate * 2 + 1]).toBeGreaterThan(rt.mem.parts[PROC_PART.plate * 2])
  })

  it('the ultrasound room\'s stage: the patient on the couch with the arm up, in the room\'s frame (heading pi), the window over the left breast', () => {
    levelView.shown = 1
    levelView.overview = false
    const m = crowdWith(true)
    const es = new Map([['pat', usEntity(US_POSE)]])
    runModel(m, es, 400)
    const rt = createProcRuntime('us')
    settle(rt, US_POSE, null)
    expect(rt.mesh.visible).toBe(true)
    const O = rt.mesh.matrix.elements
    expect(O[12]).toBeCloseTo(US.out.x, 6)
    expect(O[14]).toBeCloseTo(US.out.z, 6)
    expect(O[13]).toBeCloseTo(US.height, 6)
    // heading pi: the patient frame's +z (toward the feet) is the room's -z (north), its +x (the left) the room's -x (west)
    expect(O[10]).toBeCloseTo(-1, 6)
    expect(O[0]).toBeCloseTo(-1, 6)
    // the window's middle in the room: west of the couch's middle and toward the head (south of it), as the breast point is
    const w = rt.mem.window
    const zc = (w.z0 + w.z1) / 2
    const xc = (w.x0 + w.x1) / 2
    const roomX = O[0] * xc + O[8] * zc + O[12]
    const roomZ = O[2] * xc + O[10] * zc + O[14]
    const b = IMAGING.us.procedure!.breast
    expect(Math.abs(roomX - (US.in.x - b.across))).toBeLessThan(0.15)
    expect(Math.abs(roomZ - (US.in.z + b.toHead))).toBeLessThan(0.15)
    void ROW_FLOATS
    void TEX
    void P
    void applyBinds
  }, 120000)

  // ---------------------------------------------------------------------------------------------
  // P3: nothing is skinned or fitted while there is nothing to show
  // ---------------------------------------------------------------------------------------------

  it('P3: through the turn before the prep (prep 0, drape 0, marks none) nothing is looked for, skinned, fitted or built; the first fit comes when the prep starts, once', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = crowdWith(true)
    const view: PatientPoseView = { ...POSE, position: 'supine', arms: 'out', prep: 0, drape: 0, marks: 'none' }
    const es = new Map([['pat', cryoEntity(view)]])
    runModel(m, es, 300)
    const rt = createProcRuntime('cryo')
    for (let i = 0; i < 60; i++) stepProcRuntime(rt, view, NEEDLES, 1 / 60)
    view.position = 'prone'
    view.arms = 'aboveHead'
    // the whole turn, 6 s: nothing wanted, nothing done
    for (let i = 0; i < 360; i++) {
      m.update(frame(es, 5 + i / 60))
      stepProcRuntime(rt, view, NEEDLES, 1 / 60)
    }
    expect(rt.skinnings).toBe(0)
    expect(rt.mem.fitsBegun).toBe(0)
    expect(rt.mem.builds).toBe(0)
    expect(rt.slot, 'not even looked for').toBeNull()
    expect(rt.mesh.visible).toBe(false)
    // the prep starts: the body is skinned and fitted once, at rest
    view.prep = 0.3
    view.marks = 'marked'
    const frames = settle(rt, view, NEEDLES, 'kidney', m, es, 12)
    expect(frames).toBeLessThan(40)
    expect(rt.skinnings).toBe(1)
    expect(rt.mem.fitsBegun).toBe(1)
    expect(rt.mem.field.fits).toBe(1)
    expect(rt.mesh.visible).toBe(true)
    // (the prep goes on: nothing more to fit)
    view.prep = 1
    for (let i = 0; i < 60; i++) stepProcRuntime(rt, view, NEEDLES, 1 / 60)
    expect(rt.skinnings).toBe(1)
  }, 120000)

  // ---------------------------------------------------------------------------------------------
  // P12 c: the lie and sit blends are in the key
  // ---------------------------------------------------------------------------------------------

  it('P12 c: a patient fitted while still lying down (the entity just came onto the table: the rig\'s lie blend is part way) is fitted again once she has lain down: the last fit is of her final pose', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = crowdWith(true)
    const view: PatientPoseView = { ...POSE, position: 'supine', arms: 'out' }
    const e = cryoEntity(view)
    const es = new Map([['pat', e]])
    const rt = createProcRuntime('cryo')
    // she is on the table from the model's first frame (the stage wants from the start: the prep is on); the lie blend rises over about half a second
    let lieAtFirstSkin = -1
    let firstSkin = new Float32Array(0)
    for (let i = 0; i < 90; i++) {
      m.update(frame(es, i / 60))
      stepProcRuntime(rt, view, NEEDLES, 1 / 60)
      if (lieAtFirstSkin < 0 && rt.skinnings > 0) {
        lieAtFirstSkin = m.get('pat')!.rig.lie
        firstSkin = rt.skinBuf.slice()
      }
    }
    settle(rt, view, NEEDLES, 'kidney', m, es, 2)
    const slot = m.get('pat')!
    // the control: the first skin WAS taken with the lie blend part way, not at rest
    expect(lieAtFirstSkin).toBeGreaterThan(-1)
    expect(lieAtFirstSkin).toBeLessThan(0.9)
    expect(slot.rig.lie).toBeGreaterThan(0.99)
    expect(rt.skinnings).toBeGreaterThan(1)
    // the last skin was taken with the pose at rest: its key is the final pose's (within the half millimetre the stage fits to)
    poseKeyInto(slot, rt.key)
    expect(keyDelta(rt.key, rt.keyFit)).toBeLessThanOrEqual(FIT_EPS + 1e-9)
    // and the field in the stage is the field of the final body: a fresh fit of the final skin agrees with it (but for the odd cell of the silhouette a millimetre moves), and the field
    // of the FIRST skin, the one the old key never replaced, does not
    const src = m.skinOf(slot)!
    const tris = (src.index.length / 3) | 0
    const buf = new Float32Array(rt.skinBuf.length)
    skinInto(buf, src.n, src, m.data, slot.row, slot.seatHeight)
    const fresh = newSkinField()
    fitField(fresh, buf, src.index, tris, ROOMS.cryo.sheetZ0, ROOMS.cryo.sheetZ1)
    const early = newSkinField()
    fitField(early, firstSkin, src.index, tris, ROOMS.cryo.sheetZ0, ROOMS.cryo.sheetZ1)
    const share = (a: Float32Array, b: Float32Array): number => {
      let cells = 0
      let off = 0
      for (let k = 0; k < a.length; k++) {
        const x = a[k] < 0 ? 0 : a[k]
        const y = b[k] < 0 ? 0 : b[k]
        if (x > 0 || y > 0) cells++
        if (Math.abs(x - y) > 0.02) off++
      }
      return off / Math.max(1, cells)
    }
    expect(share(rt.mem.field.h, fresh.h)).toBeLessThan(0.01)
    expect(share(early.h, fresh.h), 'the first skin is not the final pose').toBeGreaterThan(0.1)
  }, 120000)

  // ---------------------------------------------------------------------------------------------
  // P2: real time
  // ---------------------------------------------------------------------------------------------

  it('P2: the stage\'s dt is the frame\'s own, capped, whatever the sim\'s speed: not visualDt (the layer reads no timeScale)', () => {
    expect(stageDt(1 / 60)).toBeCloseTo(1 / 60, 12)
    expect(stageDt(0)).toBe(0)
    expect(stageDt(-1)).toBe(0)
    expect(stageDt(0.5)).toBeCloseTo(0.1, 12)
    const src = readFileSync(join(process.cwd(), 'src/scene/surgery/stage/proc/ProcStageLayer.tsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toContain('visualDt')
    expect(code).not.toContain('timeScale')
    expect(code).toContain('stageDt(dt)')
  })

  it('P2: the body keeps rolling while the sim is paused, and the stage follows it on real time: the last fit is the resting pose\'s, the refits are about as many as at any speed', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = crowdWith(true)
    // the sim is paused with the prep done and the patient prone (the view does not change); the body rolls there from supine on real time
    const view: PatientPoseView = { ...POSE, position: 'prone', arms: 'aboveHead', prep: 1, drape: 1, marks: 'needles' }
    const entityView: PatientPoseView = { ...view, position: 'supine', arms: 'out' }
    const es = new Map([['pat', cryoEntity(entityView)]])
    runModel(m, es, 300)
    const rt = createProcRuntime('cryo')
    settle(rt, view, NEEDLES)
    entityView.position = 'prone'
    entityView.arms = 'aboveHead'
    const s0 = rt.skinnings
    for (let i = 0; i < 720; i++) {
      m.update(frame(es, 5 + i / 60))
      // (`stageDt`: the sim being paused does not stop the frame's own time)
      stepProcRuntime(rt, view, NEEDLES, stageDt(1 / 60))
    }
    const slot = m.get('pat')!
    poseKeyInto(slot, rt.key)
    expect(keyDelta(rt.key, rt.keyFit), 'the last skin is the resting pose\'s').toBeLessThanOrEqual(FIT_EPS + 1e-9)
    expect(rt.mem.field.busy).toBe(false)
    expect(rt.mem.refitPending).toBe(false)
    expect(rt.skinnings - s0).toBeGreaterThan(5)
    expect(rt.skinnings - s0).toBeLessThan(45)
    expect(rt.mesh.visible).toBe(true)
  }, 120000)

  // ---------------------------------------------------------------------------------------------
  // P9: uploads
  // ---------------------------------------------------------------------------------------------

  it('P9: a rebuild uploads the used part of each buffer (update ranges), a colour repaint only the plate\'s colours', () => {
    levelView.shown = 2
    levelView.overview = false
    const m = crowdWith(true)
    const view: PatientPoseView = { ...POSE, prep: 0.2, drape: 0.4, marks: 'marked' }
    const es = new Map([['pat', cryoEntity(view)]])
    runModel(m, es, 300)
    const rt = createProcRuntime('cryo')
    settle(rt, view, NEEDLES)
    const a = rt.geometry.attributes
    const used = rt.mem.mesh.nv * 3
    const cap = (a.position as BufferAttribute).array.length
    for (const k of ['position', 'normal', 'color'] as const) {
      const r = (a[k] as BufferAttribute).updateRanges
      expect(r.length, k).toBe(1)
      expect(r[0].start, k).toBe(0)
      expect(r[0].count, k).toBe(used)
    }
    const ir = rt.geometry.index!.updateRanges
    expect(ir.length).toBe(1)
    expect(ir[0].count).toBe(rt.mem.mesh.ni)
    // far less than the buffers' capacity: the four uploads were about a third of what they were (the full 396 KB of each)
    expect(used / cap).toBeLessThan(0.45)
    expect(rt.geometry.drawRange.count).toBe(rt.mem.mesh.ni)
    // the renderer uploads and clears the ranges; then the prep eases: only the plate's colours are repainted
    for (const k of ['position', 'normal', 'color'] as const) (a[k] as BufferAttribute).clearUpdateRanges()
    rt.geometry.index!.clearUpdateRanges()
    const builds = rt.mem.builds
    view.prep = 0.35
    for (let i = 0; i < 20; i++) {
      stepProcRuntime(rt, view, NEEDLES, 1 / 60)
      if (rt.mem.repaints > 0) break
    }
    expect(rt.mem.repaints).toBeGreaterThan(0)
    expect(rt.mem.builds).toBe(builds)
    const cr = (a.color as BufferAttribute).updateRanges
    expect(cr.length).toBe(1)
    const p = rt.mem.plate
    expect(cr[0].start).toBe(p.v0 * 3)
    expect(cr[0].count).toBe(p.rows * p.cols * 3)
    expect((a.position as BufferAttribute).updateRanges.length, 'positions are not uploaded for a repaint').toBe(0)
    expect(cr[0].count).toBeLessThan(used)
  }, 120000)

  // ---------------------------------------------------------------------------------------------
  // P8: the level it is drawn on
  // ---------------------------------------------------------------------------------------------

  it('P8: a room that was not drawn shows nothing stale when it is drawn again: the body rolled while it was away, and the sheet and plate wait for the new fit instead of standing on the new pose shaped for the old one (a control that is not suspended shows the old one)', () => {
    levelView.shown = 2
    levelView.overview = false
    const run = (suspend: boolean): { firstVisible: boolean; hiddenFrames: number; fitsAfter: number; finalVisible: boolean } => {
      const m = crowdWith(true)
      // the body follows the entity's own pose; the stage's view is the sim's (it stays prone with the prep on)
      const entityView: PatientPoseView = { ...POSE, position: 'prone', arms: 'aboveHead' }
      const view: PatientPoseView = { ...POSE, position: 'prone', arms: 'aboveHead' }
      const es = new Map([['pat', cryoEntity(entityView)]])
      runModel(m, es, 300)
      const rt = createProcRuntime('cryo')
      settle(rt, view, NEEDLES, 'kidney', m, es, 5)
      expect(rt.mesh.visible).toBe(true)
      // the room is not drawn for 6 s: the patient turns onto her back meanwhile (the crowd's own rig keeps going); the layer calls `suspendProcRuntime` each frame
      entityView.position = 'supine'
      entityView.arms = 'out'
      for (let i = 0; i < 360; i++) {
        m.update(frame(es, 10 + i / 60))
        if (suspend) suspendProcRuntime(rt)
      }
      // drawn again: the first frame, and how long it is hidden
      const f0 = rt.mem.field.fits
      m.update(frame(es, 17))
      stepProcRuntime(rt, view, NEEDLES, 1 / 60)
      const firstVisible = rt.mesh.visible
      let hiddenFrames = firstVisible ? 0 : 1
      for (let i = 1; i < 60; i++) {
        m.update(frame(es, 17 + i / 60))
        stepProcRuntime(rt, view, NEEDLES, 1 / 60)
        if (!rt.mesh.visible) hiddenFrames++
      }
      return { firstVisible, hiddenFrames, fitsAfter: rt.mem.field.fits - f0, finalVisible: rt.mesh.visible }
    }
    const control = run(false)
    const suspended = run(true)
    // the control shows the old fit at once (the sheet and plate of the prone body standing on the supine one), the suspended room shows nothing until the fit is whole
    expect(control.firstVisible).toBe(true)
    expect(suspended.firstVisible).toBe(false)
    expect(suspended.hiddenFrames).toBeGreaterThan(2)
    expect(suspended.hiddenFrames).toBeLessThan(25)
    expect(suspended.fitsAfter).toBeGreaterThanOrEqual(1)
    expect(suspended.finalVisible).toBe(true)
  }, 120000)

  it('P8: the stage steps exactly when the screen draws the patient: the CT room on level 2, the couch on level 1 and in the level-2 overview wherever the ground floor is drawn; hidden otherwise', () => {
    const rule: [number, boolean, boolean, boolean][] = [
      // [level shown, overview, cryo drawn, us drawn]
      [1, false, false, true],
      [1, true, false, true],
      [2, false, true, false],
    ]
    for (const [shown, overview, cryo, us] of rule) {
      levelView.shown = shown as 1 | 2
      levelView.overview = overview
      expect(roomDrawn('cryo'), `shown ${shown} overview ${overview}`).toBe(cryo)
      expect(roomDrawn('us'), `shown ${shown} overview ${overview}`).toBe(us)
    }
    // the level-2 overview keeps the ground floor drawn round the storey, not under its slab: the couch is drawn there exactly where the crowd draws its people (levelView.shownAt)
    levelView.shown = 2
    levelView.overview = true
    expect(roomDrawn('cryo')).toBe(true)
    expect(roomDrawn('us')).toBe(shownAt(IMAGING.us.table.in.x, IMAGING.us.table.in.z))
    const src = readFileSync(join(process.cwd(), 'src/scene/surgery/stage/proc/ProcStageLayer.tsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).toContain('roomDrawn(room)')
    expect(code).toMatch(/if \(!roomDrawn\(room\)\) \{\s*suspendProcRuntime\(rt\)\s*return\s*\}/)
  })
})
