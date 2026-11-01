/**
 * R5 wave 2 (agent H): the stage as three.js objects, with no React. One merged mesh on the stage's matte cloth (material.ts: `MACHINE_BODY`'s shader program, matte), mounted
 * hidden at load and shown only while it has something to draw: ONE draw call in the theatre close-up. `stepStageRuntime` is the whole frame: it finds the patient on the
 * table in the crowd's registry (the drapes hug that body: fit.ts; the union of the avatars when nobody is found), hands the room's patient view to `stepStage` (stage.ts),
 * uploads what changed (the buffers only after a rebuild, the colours only after a repaint) and writes the matrix. Nothing is allocated in it.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh } from 'three'
import { PROCEDURE_META } from '@/content/procedures'
import { SURGERY_COPY } from '@/content/surgery'
import { activeCrowd } from '@/scene/actors/crowd/runtime'
import type { PersonSlot } from '@/scene/actors/crowd/model'
import type { PortLayout } from '@/sim/places'
import type { PatientPoseView, ProcedureId, RobotArmState, SurgeryProcedure } from '@/sim/types'
import { fitIndexOf } from './fit'
import { STAGE_MATERIAL } from './material'
import { portSitesInto } from './ports'
import { newStageMemory, stepStage, type StageIn, type StageMemory } from './stage'

/** A robot arm counts as docked once it has swung this far onto its port (its own cannula takes over from the stub). */
export const DOCKED_AT = 0.2

export interface StageRuntime {
  mem: StageMemory
  geometry: BufferGeometry
  mesh: Mesh
  sites: Float64Array
  input: StageIn
  /** The procedure the sites were made for and its layout. */
  procedureId: ProcedureId | null
  layout: PortLayout
  /** Uploads so far (the tests count them). */
  uploads: number
  /** The patient's slot in the crowd (null: not found yet), the patient view it was looked for under, and real seconds since the last look. */
  slot: PersonSlot | null
  looking: Readonly<PatientPoseView> | null
  sinceLook: number
  /** The callback of the look (made once). */
  visit: (slot: PersonSlot) => void
}

/** Seconds between two looks through the crowd for the patient on the table. */
export const LOOK_EVERY = 0.5

/** The port layout of a procedure (oblique unless the case says otherwise). */
export function layoutOf(id: ProcedureId | null): PortLayout {
  if (id === null) return 'oblique'
  const meta = PROCEDURE_META[id]
  const copy = meta.machine === 'daVinci' ? SURGERY_COPY.procedures[meta.key as SurgeryProcedure] : undefined
  return copy?.portLayout ?? 'oblique'
}

export function createStageRuntime(): StageRuntime {
  const mem = newStageMemory()
  const m = mem.mesh
  const geometry = new BufferGeometry()
  const pos = new BufferAttribute(m.pos, 3).setUsage(DynamicDrawUsage)
  const nrm = new BufferAttribute(m.nrm, 3).setUsage(DynamicDrawUsage)
  const col = new BufferAttribute(m.col, 3).setUsage(DynamicDrawUsage)
  const idx = new BufferAttribute(m.idx, 1).setUsage(DynamicDrawUsage)
  geometry.setAttribute('position', pos)
  geometry.setAttribute('normal', nrm)
  geometry.setAttribute('color', col)
  geometry.setIndex(idx)
  geometry.setDrawRange(0, 0)
  const mesh = new Mesh(geometry, STAGE_MATERIAL)
  mesh.name = 'surgery-stage'
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.matrixAutoUpdate = false
  mesh.visible = false
  const sites = new Float64Array(10)
  const rt: StageRuntime = {
    mem,
    geometry,
    mesh,
    sites,
    input: { patient: null as unknown as PatientPoseView, sites, docked: 0, dt: 0, fitAvatar: -1, fitScale: 1 },
    procedureId: null,
    layout: 'oblique',
    uploads: 0,
    slot: null,
    looking: null,
    sinceLook: LOOK_EVERY,
    visit: (slot) => {
      const e = slot.entity
      if (e !== null && rt.looking !== null && e.patientPose === rt.looking) rt.slot = slot
    },
  }
  portSitesInto('oblique', sites)
  return rt
}

/**
 * One frame: `procedureId` and `patient` are the room's `procedure` view (patient by reference), `arms` the robot's four arms, `dt` real seconds (0 while paused).
 */
export function stepStageRuntime(rt: StageRuntime, procedureId: ProcedureId | null, patient: Readonly<PatientPoseView>, arms: readonly RobotArmState[], dt: number): void {
  // the ports follow the case's layout (they are body-frame: they ride the patient when the position changes)
  if (procedureId !== rt.procedureId) {
    rt.procedureId = procedureId
    if (procedureId !== null) {
      rt.layout = layoutOf(procedureId)
      portSitesInto(rt.layout, rt.sites)
    }
  }
  let docked = 0
  for (let i = 0; i < arms.length && i < 4; i++) if (arms[i].engage > DOCKED_AT) docked |= 1 << i
  const inp = rt.input
  inp.patient = patient
  inp.docked = docked
  inp.dt = dt
  findPatient(rt, patient, dt)
  const mem = rt.mem
  stepStage(mem, inp)
  const g = rt.geometry
  if (mem.geoDirty) {
    mem.geoDirty = false
    mem.colDirty = false
    const a = g.attributes
    a.position.needsUpdate = true
    a.normal.needsUpdate = true
    a.color.needsUpdate = true
    g.index!.needsUpdate = true
    g.setDrawRange(0, mem.mesh.ni)
    rt.mesh.visible = mem.mesh.ni > 0
    rt.uploads++
  } else if (mem.colDirty) {
    mem.colDirty = false
    g.attributes.color.needsUpdate = true
    rt.uploads++
  }
  const e = rt.mesh.matrix.elements
  const O = mem.matrix
  for (let i = 0; i < 16; i++) e[i] = O[i]
  rt.mesh.matrixWorldNeedsUpdate = true
}

/**
 * Who lies on the table: the crowd's person whose entity carries this very patient view (`Entity.patientPose` is the room's `procedure.patient`). Looked for twice a second
 * until found (and again if they are gone); then the body (an index into fit.data.ts's, -1 when it has no fit) and the person's size go to the stage.
 */
function findPatient(rt: StageRuntime, patient: Readonly<PatientPoseView>, dt: number): void {
  const crowd = activeCrowd()
  const inp = rt.input
  inp.fitAvatar = -1
  inp.fitScale = 1
  if (crowd === null) return
  const slot = rt.slot
  if (slot === null || slot.entity === null || slot.entity.patientPose !== patient) {
    rt.slot = null
    rt.sinceLook += dt
    if (rt.sinceLook < LOOK_EVERY) return
    rt.sinceLook = 0
    rt.looking = patient
    crowd.people.forEach(rt.visit)
  }
  const found = rt.slot
  if (found === null || found.avatar < 0) return
  const body = crowd.avatars[found.avatar]
  if (body === undefined) return
  inp.fitAvatar = fitIndexOf(body.id)
  inp.fitScale = found.look.scale
}

export function disposeStageRuntime(rt: StageRuntime): void {
  rt.geometry.dispose()
}
