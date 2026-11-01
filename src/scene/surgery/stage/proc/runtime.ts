/**
 * R5 wave 3 (agent J): the procedure rooms' stage as three.js objects, with no React. One merged mesh on the stage's matte cloth (../material.ts: `MACHINE_BODY`'s shader program,
 * matte), mounted hidden at load and shown only while it has something to draw: ONE draw call in each room's close-up. `stepProcRuntime` is the whole frame: it finds the patient
 * on the room's table in the crowd's registry (`Entity.patientPose` is the room's `procedure.patient`; failing that whoever lies on the room's table seat with a pose), skins
 * that body from the crowd's own pose rows (crowd/skinSource.ts: the body as the GPU draws it now) when the patient's pose has moved, hands the room's patient view and the skin to
 * `stepProcStage`, uploads what changed and writes the matrix: the patient's frame in the room (the entity's place and heading), so the table's travel into the CT's bore
 * carries the drapes exactly as it carries the body. Nothing is allocated in it.
 *
 * What a frame costs (P1 to P3, P9, P12):
 *   - nothing is skinned, fitted or looked for while the stage has nothing to show (`updateWants`: the turn before the prep, and from the step after the dressing on: the gown is back
 *     over the site, P6); the first time it has, the body is skinned and fitted once;
 *   - the body is skinned again (and so fitted again, as a job over several frames: field.ts, `FIT_BUDGET` units a frame) when its pose has moved by `FIT_DELTA` metres since the
 *     last (a fingerprint of the rig's followers scaled to the motion each makes: the turn, the side, the arms, the wedge AND the lie and sit blends, so a patient who is fitted
 *     mid lie-down is fitted again) and `REFIT_EVERY` real seconds have passed, and once more when it comes to rest (`REST_SPEED`); never while a fit is still running (it reads
 *     the skin's buffer). The followers run on REAL time, so all the clocks here do (`stageDt`: the layer passes the frame's own dt, capped; not the sim's speed's: at 30x the drape
 *     refitted every frame, and while the sim was paused the stage froze mid-roll while the body went on rolling);
 *   - what is uploaded is the used part of each buffer (`updateRanges`), and only the plate's colours while the tint spreads;
 *   - a room that is not drawn is suspended (`suspendProcRuntime`): when it is drawn again nothing stale shows, the body is fitted again first.
 *
 * The mesh lives in the room's group in SIM coordinates (the cryo suite's group is the level-2 offset; the imaging machines are at the scene's root on level 1).
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh } from 'three'
import { activeCrowd } from '@/scene/actors/crowd/runtime'
import type { PersonSlot } from '@/scene/actors/crowd/model'
import { skinInto } from '@/scene/actors/crowd/skinSource'
import { F_LITH, F_ONE, F_ROLL, F_SIDE, F_TUCK, F_TURN, F_UP } from '@/scene/actors/crowd/tablePatient'
import { shownAt } from '@/scene/levels/levelView'
import { LEVEL_Y } from '@/sim/levels'
import { CRYO_SUITE, IMAGING } from '@/sim/places'
import type { CryoTarget, PatientPoseView } from '@/sim/types'
import type { CtNeedlePath } from '@/sim/procedure/cryoPlaces'
import { MAX_TRIS, MAX_VERTS } from '../mesh'
import { STAGE_MATERIAL } from '../material'
import { siteOfNeedle, type RoomId } from './config'
import { MAX_SITES } from './marks'
import { cancelFit } from './field'
import { newProcMemory, stepProcStage, updateWants, type ProcIn, type ProcMemory, type ProcSkin } from './stage'

/** The table seat each room's patient lies on (src/scene/rooms: `scanTable:cryo`, `usCouch:us`). */
export const ROOM_SEAT: Readonly<Record<RoomId, string>> = { cryo: 'scanTable:cryo', us: 'usCouch:us' }
/** Seconds between two looks through the crowd for the patient, and the least between two skinnings (REAL seconds). */
export const LOOK_EVERY = 0.5
export const REFIT_EVERY = 0.15
/** The most vertices of a body the runtime skins (the avatars' LOD 0 have about 2 500). */
export const SKIN_CAP = 8192
/** The body is skinned and fitted again when its pose has moved this far (metres, `poseKey`'s units), and once more at rest when it has moved by `FIT_EPS` or more. */
export const FIT_DELTA = 0.012
export const FIT_EPS = 0.0006
/**
 * Rest: the pose moves slower than this (metres per second, the key's units): a critically damped follower has about 0.9 s of motion left at its speed (1 / omega, omega as slow as 1.1
 * for the arms), so the distance left is under `FIT_EPS` and the one fit at rest is the last. A higher number refits all through the settle tail (every half millimetre of it).
 */
export const REST_SPEED = 0.0005
/** The work units of the fit a frame takes (field.ts `FIT_UNITS_PER_MS`: this is about 0.33 ms on an M4: the whole fit of a body is about five frames). */
export const FIT_BUDGET = 80_000
/** The longest frame time the stage takes (the crowd's own cap: a hitch must not make the fit jump). */
export const STAGE_DT_MAX = 0.1

/** The frame's REAL seconds as the stage takes them: not scaled by the sim's speed, and 0 for none; capped like the crowd's. Allocation-free. */
export function stageDt(dt: number): number {
  return dt < 0 ? 0 : dt > STAGE_DT_MAX ? STAGE_DT_MAX : dt
}

/** Where each room's table stands (sim x, z): the point the screen's level rule is asked about. */
const TABLE_X = { cryo: CRYO_SUITE.ct.table.out.x, us: IMAGING.us.table.in.x } as const
const TABLE_Z = { cryo: CRYO_SUITE.ct.table.out.z, us: IMAGING.us.table.in.z } as const

/**
 * Whether the screen draws the patient of this room now (levelView `shownAt` the room's table, the rule the crowd draws people by: your level while walking; in the overview the storey
 * on show, and the ground floor round it where it is not under the slab). The stage steps exactly then and is hidden otherwise (the layer).
 */
export function roomDrawn(room: RoomId): boolean {
  return shownAt(TABLE_X[room], TABLE_Z[room])
}

/** A needle as the stage reads it (the cryo suite's `CryoNeedleState`: its skin entry in the plan's own axes, mm). */
export type NeedleEntry = CtNeedlePath

/**
 * The pose key: the followers of the rig scaled to the metres each moves a part of the body per unit (the turn is a half turn about the body's long axis, the arms swing a metre),
 * then the lie and sit blends (the patient arriving on the table). Its entries, in order:
 */
const KEY_LEN = 9
const LEVER_LITH = 0.3
const LEVER_TUCK = 0.15
const LEVER_TURN = 0.63
const LEVER_SIDE = 0.19
const LEVER_ARMS = 0.6
/** Per degree of the wedge's roll. */
const LEVER_ROLL = 0.0035
const LEVER_LIE = 1.5
const LEVER_SIT = 1

export interface ProcRuntime {
  room: RoomId
  mem: ProcMemory
  geometry: BufferGeometry
  mesh: Mesh
  /** The patient's skin in the patient frame (x, h, z per vertex), what the field is fitted to. */
  skinBuf: Float32Array
  skin: ProcSkin
  sites: Float64Array
  input: ProcIn
  /** The patient's slot (null: not found yet), the view it was looked for under, real seconds since the last look and the last skinning. */
  slot: PersonSlot | null
  looking: Readonly<PatientPoseView> | null
  sinceLook: number
  sinceFit: number
  /** The pose key now, last frame and when the skin was last taken; how fast it moves (metres per second); the slot the skin was taken from. */
  key: Float64Array
  keyPrev: Float64Array
  keyFit: Float64Array
  speed: number
  skinSlot: PersonSlot | null
  /** The skin is not a fit for this stage's last wanting (the stage had nothing to show since): take it again. */
  stale: boolean
  /** The update ranges of the four buffers (reused: nothing is allocated to upload). */
  ranges: { start: number; count: number }[]
  /** Skinnings done (the tests). */
  skinnings: number
  visit: (slot: PersonSlot) => void
}

export function createProcRuntime(room: RoomId): ProcRuntime {
  const mem = newProcMemory(room)
  const m = mem.mesh
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(m.pos, 3).setUsage(DynamicDrawUsage))
  geometry.setAttribute('normal', new BufferAttribute(m.nrm, 3).setUsage(DynamicDrawUsage))
  geometry.setAttribute('color', new BufferAttribute(m.col, 3).setUsage(DynamicDrawUsage))
  geometry.setIndex(new BufferAttribute(m.idx, 1).setUsage(DynamicDrawUsage))
  geometry.setDrawRange(0, 0)
  const mesh = new Mesh(geometry, STAGE_MATERIAL)
  mesh.name = `${room}-stage`
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.matrixAutoUpdate = false
  mesh.visible = false
  const skinBuf = new Float32Array(SKIN_CAP * 3)
  const sites = new Float64Array(MAX_SITES * 2)
  const skin: ProcSkin = { v: skinBuf, index: [], tris: 0, version: 0 }
  const rt: ProcRuntime = {
    room,
    mem,
    geometry,
    mesh,
    skinBuf,
    skin,
    sites,
    input: { patient: null as unknown as PatientPoseView, skin: null, sites, nSites: 0, rootX: 0, rootY: 0, rootZ: 0, heading: 0, dt: 0, target: 'kidney', fitBudget: FIT_BUDGET, gown: false },
    slot: null,
    looking: null,
    sinceLook: LOOK_EVERY,
    sinceFit: REFIT_EVERY,
    key: new Float64Array(KEY_LEN),
    keyPrev: new Float64Array(KEY_LEN),
    keyFit: new Float64Array(KEY_LEN),
    speed: 0,
    skinSlot: null,
    stale: true,
    ranges: [
      { start: 0, count: 0 },
      { start: 0, count: 0 },
      { start: 0, count: 0 },
      { start: 0, count: 0 },
    ],
    skinnings: 0,
    visit: (slot) => {
      const e = slot.entity
      if (e === null || e.patientPose === null || e.patientPose === undefined) return
      if (rt.looking !== null && e.patientPose === rt.looking) rt.slot = slot
      else if (rt.slot === null && slot.posture === 'lie' && e.seated?.seatId === ROOM_SEAT[rt.room]) rt.slot = slot
    },
  }
  return rt
}

/** The pose key of a person into `out` (see KEY_LEN): the rig's table followers, scaled to metres of motion, and its lie and sit blends. */
export function poseKeyInto(slot: PersonSlot, out: Float64Array): void {
  const st = slot.rig.tbl.st
  out[0] = st[F_LITH] * LEVER_LITH
  out[1] = st[F_TUCK] * LEVER_TUCK
  out[2] = st[F_TURN] * LEVER_TURN
  out[3] = st[F_SIDE] * LEVER_SIDE
  out[4] = st[F_UP] * LEVER_ARMS
  out[5] = st[F_ONE] * LEVER_ARMS
  out[6] = st[F_ROLL] * LEVER_ROLL
  out[7] = slot.rig.lie * LEVER_LIE
  out[8] = slot.rig.sit * LEVER_SIT
}

/** The largest difference of two pose keys (metres). */
export function keyDelta(a: Float64Array, b: Float64Array): number {
  let d = 0
  for (let i = 0; i < KEY_LEN; i++) {
    const x = a[i] - b[i]
    const y = x < 0 ? -x : x
    if (y > d) d = y
  }
  return d
}

/** Put the range [start, start + count) (elements) on an attribute's update ranges, merging with one not yet uploaded; the range object is the runtime's own (no allocation). */
function setRange(a: BufferAttribute, r: { start: number; count: number }, start: number, count: number): void {
  const ur = a.updateRanges
  if (ur.length === 1 && ur[0] === r) {
    const end = r.start + r.count > start + count ? r.start + r.count : start + count
    if (start < r.start) r.start = start
    r.count = end - r.start
    return
  }
  ur.length = 0
  r.start = start
  r.count = count
  ur.push(r)
}

/**
 * One frame: `patient` is the room's `procedure.patient` (by reference), `needles` the CT's planned needles (null for the couch), `dt` the frame's REAL seconds (`stageDt`), `target`
 * the case's (the CT's window waits at its field before a needle is planned), `gown` whether the gown is back over the site (stage.ts `gownBackOver` of the room's published step:
 * nothing of the stage shows, nothing is skinned or fitted).
 */
export function stepProcRuntime(rt: ProcRuntime, patient: Readonly<PatientPoseView>, needles: readonly NeedleEntry[] | null, dt: number, target: CryoTarget = 'kidney', gown = false): void {
  const inp = rt.input
  const mem = rt.mem
  inp.patient = patient
  inp.dt = dt
  inp.target = target
  inp.gown = gown
  const wants = updateWants(mem, patient, gown)
  let n = 0
  if (wants && needles !== null) {
    for (let i = 0; i < needles.length && n < MAX_SITES; i++) {
      siteOfNeedle(target, needles[i], rt.sites, n * 2)
      n++
    }
  }
  inp.nSites = n
  let known = false
  let skinned = false
  if (!wants) {
    // nothing to show: no look, no skin, no fit (and the skin we have is not the patient's by the time there is)
    rt.stale = true
  } else {
    findPatient(rt, patient, dt)
    const slot = rt.slot
    const crowd = activeCrowd()
    if (slot !== null && crowd !== null && slot.entity !== null) {
      const src = crowd.skinOf(slot)
      if (src !== null) {
        known = true
        rt.sinceFit += dt
        poseKeyInto(slot, rt.key)
        rt.speed = dt > 1e-5 ? keyDelta(rt.key, rt.keyPrev) / dt : rt.speed
        rt.keyPrev.set(rt.key)
        // (a fit in progress reads the skin's buffer, and the frame after it lays the stage out: neither is disturbed)
        if (!mem.field.busy && !mem.refitPending) {
          const d = keyDelta(rt.key, rt.keyFit)
          if (rt.stale || slot !== rt.skinSlot || (rt.sinceFit >= REFIT_EVERY && (d >= FIT_DELTA || (rt.speed < REST_SPEED && d > FIT_EPS)))) {
            const cap = src.n < SKIN_CAP ? src.n : SKIN_CAP
            skinInto(rt.skinBuf, cap, src, crowd.data, slot.row, slot.seatHeight)
            rt.skin.index = src.index
            rt.skin.tris = (src.index.length / 3) | 0
            rt.skin.version++
            rt.keyFit.set(rt.key)
            rt.skinSlot = slot
            rt.sinceFit = 0
            rt.stale = false
            rt.skinnings++
            skinned = true
          }
        }
        // the patient's frame: where the entity is (the sim's own, interpolated this frame: the table's travel carries it), the pad's top under the pelvis
        const e = slot.entity
        inp.rootX = e.position.x
        inp.rootZ = e.position.z
        inp.rootY = slot.y - LEVEL_Y[slot.level] + slot.seatHeight
        inp.heading = slot.heading
      }
    }
  }
  inp.skin = known ? rt.skin : null
  // (a frame that skinned does not also take a slice of the fit)
  inp.fitBudget = skinned ? 0 : FIT_BUDGET
  stepProcStage(mem, inp)
  const g = rt.geometry
  const a = g.attributes
  if (mem.geoDirty) {
    mem.geoDirty = false
    mem.colDirty = false
    const m = mem.mesh
    if (m.nv > 0) {
      setRange(a.position as BufferAttribute, rt.ranges[0], 0, m.nv * 3)
      setRange(a.normal as BufferAttribute, rt.ranges[1], 0, m.nv * 3)
      setRange(a.color as BufferAttribute, rt.ranges[2], 0, m.nv * 3)
      setRange(g.index!, rt.ranges[3], 0, m.ni)
      a.position.needsUpdate = true
      a.normal.needsUpdate = true
      a.color.needsUpdate = true
      g.index!.needsUpdate = true
    }
    g.setDrawRange(0, m.ni)
  } else if (mem.colDirty) {
    mem.colDirty = false
    const p = mem.plate
    if (p.v0 >= 0) {
      setRange(a.color as BufferAttribute, rt.ranges[2], p.v0 * 3, p.rows * p.cols * 3)
      a.color.needsUpdate = true
    }
  }
  rt.mesh.visible = known && mem.mesh.ni > 0
  const e = rt.mesh.matrix.elements
  const O = mem.matrix
  for (let i = 0; i < 16; i++) e[i] = O[i]
  rt.mesh.matrixWorldNeedsUpdate = true
}

/**
 * The room is not drawn this frame (the layer does not step it): hide the mesh, and mark the skin and the fit stale. The patient goes on moving while the room is away (the crowd's
 * rig is not asked); when it is drawn again the stage starts a new epoch and shows nothing until the body has been fitted again, instead of showing the sheet and the plate shaped
 * for the pose it had left (they stood on the new pose for about six frames until the refit came in). Cheap and idempotent: the layer calls it every frame the room is not drawn.
 */
export function suspendProcRuntime(rt: ProcRuntime): void {
  rt.mesh.visible = false
  rt.stale = true
  rt.mem.wants = false
  if (rt.mem.field.busy) cancelFit(rt.mem.field)
}

/** Who lies on the table: the crowd's person whose entity carries this very patient view, or else whoever lies on the room's table seat with a pose; looked for twice a second. */
function findPatient(rt: ProcRuntime, patient: Readonly<PatientPoseView>, dt: number): void {
  const crowd = activeCrowd()
  if (crowd === null) return
  const slot = rt.slot
  const e = slot === null ? null : slot.entity
  if (slot === null || e === null || e.patientPose === null || e.patientPose === undefined || (e.patientPose !== patient && e.seated?.seatId !== ROOM_SEAT[rt.room])) {
    rt.slot = null
    rt.sinceLook += dt
    if (rt.sinceLook < LOOK_EVERY) return
    rt.sinceLook = 0
    rt.looking = patient
    crowd.people.forEach(rt.visit)
  }
}

export function disposeProcRuntime(rt: ProcRuntime): void {
  rt.geometry.dispose()
}

/** Limits the tests pin: the mesh's buffers hold the biggest stage. */
export const PROC_LIMITS = { verts: MAX_VERTS, tris: MAX_TRIS } as const
