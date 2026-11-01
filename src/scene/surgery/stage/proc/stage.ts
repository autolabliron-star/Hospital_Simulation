/**
 * R5 wave 3 (agent J): the stage of a procedure room (the CT cryo suite's table, the ultrasound couch): the patient's prepped skin, the sterile sheet with its window and the
 * skin marks, as ONE merged mesh in the patient's frame (mesh.ts) on the stage's matte cloth (../material.ts). Built from the room's `procedure.patient` (`PatientPoseView`)
 * and fitted to the patient who lies there: `stepProcStage` is given the patient's SKIN (the body as the GPU draws it now, in the patient's frame: the runtime skins it from
 * the crowd's pose rows; the tests give the real avatars'), fits a height field to it (field.ts) when it changes, and lays the stage out:
 *
 *   prep   0..1  an opaque skin plate over the window, the antiseptic tint spreading from its middle (plate.ts); it also carries the pen marks, so it shows from the first mark on
 *   drape  0..1  the sterile sheet unfolds from the shoulders toward the feet, its window over the plate (sheet.ts), the hole closed from its edge down to the plate by a skirt of the
 *                same cloth, so no line of sight through it, at any slant, reaches anything but the plate
 *   marks        the sticker and pen dots / ring, the needles' nicks, closed lines, dressings (marks.ts)
 *
 * The window is placed round the needles the sim plans (window.ts: exact edges, as short as the sites need where the body narrows, always on the body) when the fit, the sites, the
 * position or the target change, and kept while the drape eases; the plate and its marks are laid before the sheet (its skirt drops to the plate's surface).
 *
 * The numbers ease over a script step and the enums switch at its start, as in the theatre's stage (../stage.ts, which this follows): the geometry is rebuilt at most `MIN_REBUILD`
 * REAL seconds apart while `drape` eases (at once when something discrete changes: the marks, the position, the fit), the plate's colours are repainted while `prep` eases. The
 * sheet's drape starts when the prep is half done (`drapeShown`). `stepProcStage` allocates nothing.
 *
 * What it costs (P1 to P3). Nothing is skinned, fitted or built while the stage has nothing to show (`wants`: the turn before the prep). A fit is a JOB over several frames
 * (field.ts `stepFit`, `ProcIn.fitBudget` work units a frame) into a second field that replaces the first only when whole; a frame does at most one heavy job (a slice of a fit, or a
 * rebuild: the rebuild after a fit comes the frame after it), unless the budget is `Infinity` (the tests, the default: the whole fit and the build in one call).
 *
 * Where the patient is (P6). The window is laid for the position the prep was done in (`latched`: the position and arms at the first moment of prep or marks). When the patient's
 * position or arms later change away from it (the turn back onto the back, the ProSense arm lowered at sign-out) the stage shows NOTHING: the gown is back over the site and the
 * dressing under it, not a plate laid across the front or over the lowered arm. It comes back if she returns to that position; it resets when the prep and marks are gone.
 *
 * The gown goes back over (P6, the owner's ruling). The plate (and the dressings on it) stays through the drapes coming off and the dressing step; from the NEXT step of the script on
 * (the cryo suite's sign-out, the ProSense cold pack) nothing of the stage shows, whether she has moved or not: no plate, no marks, no dressing, no sheet. That is `ProcIn.gown`,
 * which `gownBackOver` says from the step the sim publishes (`ProcedureView.procedureId` and `stepId`): the first step of each script whose pose has the site `dressed` is the last the
 * stage shows. It is a rule of the step, not of the pose: the pose cannot tell the dressing step from the one after it (the prep, the drape and the marks are the same numbers; `prep`
 * eased down over the step would leave the plate showing at its start), and a pose with the prep painted and no marks is a legitimate stage (the tests, a script that preps before it
 * marks). The table is made once from the compiled scripts, so a step inserted into a script moves the rule with it.
 */
import { COMPILED_SCRIPTS } from '@/sim/procedure'
import type { CryoTarget, PatientArms, PatientMarks, PatientPosition, PatientPoseView, ProcedureId } from '@/sim/types'
import { clamp01, smoothstep } from '../frame'
import { finishNormals, newStageMesh, resetMesh, type StageMesh } from '../mesh'
import { drapeShown, MIN_REBUILD, MIN_REPAINT } from '../stage'
import { fieldSiteInto, newWindowSpec, ROOMS, windowInto, type RoomId, type WindowSpec } from './config'
import { beginFit, cancelFit, newSkinField, stepFit, type SkinField } from './field'
import { buildMarks } from './marks'
import { buildPlate, newPlateInfo, paintPlate, type PlateInfo } from './plate'
import { SHEET_BUILD, buildSheet } from './sheet'
import { MAX_SITES, newPlacedWindow, placeWindow, type PlacedWindow } from './window'

export { MIN_REBUILD, MIN_REPAINT, MAX_SITES }

/**
 * The parts of the mesh, for the index ranges `ProcMemory.parts` keeps (two numbers each: first index, one past the last). The sheet is the cloth's own triangles; the skirt that closes the
 * hole from its edge down to the plate (sheet.ts) is a part of its own (it comes right after the sheet's in the index buffer).
 */
export const PROC_PART = { sheet: 0, plate: 1, marks: 2, skirt: 3, count: 4 } as const

/** The patient's skin as `stepProcStage` takes it: the body's vertices in the patient's frame (three floats each: x across, h above the pad, z toward the feet) and triangles. */
export interface ProcSkin {
  v: ArrayLike<number>
  index: ArrayLike<number>
  tris: number
  /** Changes whenever the body has moved (the pose followers, the table): the field is fitted again. The arrays must stay as they are until that fit is whole (`ProcMemory.field.busy`). */
  version: number
}

export interface ProcIn {
  patient: Readonly<PatientPoseView>
  skin: ProcSkin | null
  /** The needles' skin entries in the patient frame (z, x pairs), and how many (CT; the breast's one site is the window's middle when none is given). */
  sites: Float64Array
  nSites: number
  /** The patient's root in the mesh's frame: the pad's top under the pelvis (x, y, z) and the heading about y. */
  rootX: number
  rootY: number
  rootZ: number
  heading: number
  /** REAL seconds since the last frame (the sim's speed does not scale it; the crowd's table followers, which the fit follows, run on it too). */
  dt: number
  /** The case's target (the CT's: where the window waits before a needle is planned; the couch ignores it). Default 'kidney'. */
  target?: CryoTarget
  /** The work units the fit may spend this frame (field.ts); `Infinity` (the default): all of it, and the rebuild, in this call. */
  fitBudget?: number
  /** The gown is back over the site (`gownBackOver`: the script is past the dressing step): nothing of the stage shows. Default false. */
  gown?: boolean
}

export interface ProcMemory {
  room: RoomId
  mesh: StageMesh
  field: SkinField
  window: PlacedWindow
  plate: PlateInfo
  /** The default window (scratch of `windowInto`). */
  spec: WindowSpec
  /** The mesh's 4x4 (column-major): the patient's frame in the room. */
  matrix: Float64Array
  clock: number
  builtAt: number
  paintedAt: number
  // what the geometry was built from
  bFits: number
  bMarks: PatientMarks
  bDrape: number
  bPlate: boolean
  bPosition: PatientPosition
  bTarget: CryoTarget
  bSites: number
  bPrep: number
  /** The skin version the field was last begun for (-1 none yet), and the epoch it was begun in. */
  fitVersion: number
  fitEpoch: number
  /** Index ranges of each part. */
  parts: Int32Array
  /** The drape shown (the script's, delayed behind the prep, and none while the patient is away from where the prep was done). */
  drape: number
  /** For the layer: the buffers changed (upload them), the colours changed. */
  geoDirty: boolean
  colDirty: boolean
  builds: number
  repaints: number
  /** The sites actually used (the breast's default filled in), and how many. */
  usedSites: Float64Array
  nUsed: number
  // ---- what the stage has to show (updateWants)
  /** The plate shows (the prep is under way or there are marks, and the patient lies where it was done) and the drape (0..1, also 0 when away). */
  plateOn: boolean
  /** Anything is to be drawn: the plate or the drape. Nothing is skinned, fitted or built while it is not. */
  wants: boolean
  /** The position and arms the prep was done in (`latched`), and whether the patient has since moved away from them. */
  latched: boolean
  lPosition: PatientPosition
  lArms: PatientArms
  away: boolean
  /** The gown is back over the site (the script is past the dressing step): nothing shows, whatever the pose says. */
  gown: boolean
  /** Counts the times `wants` turned on; a fit counts only for the epoch it was begun in (a field kept from before is the patient's old pose). */
  epoch: number
  /** The epoch of the last whole fit (the stage draws when it equals `epoch`). */
  readyEpoch: number
  /** A fit completed: the next frame lays the stage out again. */
  refitPending: boolean
  /** Fits begun (the tests). */
  fitsBegun: number
  /** What the window was last placed from (the placement is kept while none of it changes), and the placements made (the tests). */
  placed: boolean
  placedFits: number
  placedSites: number
  placedPosition: PatientPosition
  placedTarget: CryoTarget
  placedEpoch: number
  placements: number
}

export function newProcMemory(room: RoomId): ProcMemory {
  return {
    room,
    mesh: newStageMesh(),
    field: newSkinField(),
    window: newPlacedWindow(),
    plate: newPlateInfo(),
    spec: newWindowSpec(),
    matrix: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    clock: 0,
    builtAt: -1e9,
    paintedAt: -1e9,
    bFits: -1,
    bMarks: 'none',
    bDrape: -1,
    bPlate: false,
    bPosition: 'supine',
    bTarget: 'kidney',
    bSites: 0,
    bPrep: -1,
    fitVersion: -1,
    fitEpoch: -1,
    parts: new Int32Array(PROC_PART.count * 2),
    drape: 0,
    geoDirty: false,
    colDirty: false,
    builds: 0,
    repaints: 0,
    usedSites: new Float64Array(MAX_SITES * 2),
    nUsed: 0,
    plateOn: false,
    wants: false,
    latched: false,
    lPosition: 'supine',
    lArms: 'out',
    away: false,
    gown: false,
    epoch: 0,
    readyEpoch: -1,
    refitPending: false,
    fitsBegun: 0,
    placed: false,
    placedFits: -1,
    placedSites: 0,
    placedPosition: 'supine',
    placedTarget: 'kidney',
    placedEpoch: -1,
    placements: 0,
  }
}

function setPart(mem: ProcMemory, part: number, from: number): void {
  mem.parts[part * 2] = from
  mem.parts[part * 2 + 1] = mem.mesh.ni
}

/** A cheap fingerprint of the sites: the build is redone when a needle's entry moves. */
function sitesKey(sites: Float64Array, n: number): number {
  let s = n * 7.3
  for (let i = 0; i < n * 2; i++) s += sites[i] * (i + 1) * 1.7
  return s
}

/**
 * The steps after the dressing, per script (P6): the ids of the steps that come after the first one whose pose has the site `dressed`. Made once from the compiled scripts (step ids are
 * unique in a script: the schema's rule), so the rule follows the scripts, not a list of names kept here.
 */
const GOWN_STEPS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const out = new Map<string, ReadonlySet<string>>()
  for (const [id, cs] of Object.entries(COMPILED_SCRIPTS)) {
    if (cs === undefined) continue
    const dressed = cs.poseAfter.findIndex((p) => p.marks === 'dressed')
    if (dressed < 0) continue
    out.set(id, new Set(cs.script.steps.slice(dressed + 1).map((st) => st.id)))
  }
  return out
})()

/**
 * Whether the gown is back over the site at this step of this script (P6): true from the step after the dressing on, false before it and for a room with no case (`procedureId` null)
 * or a script that never dresses the site. Two lookups, no allocation: the layer asks it every frame.
 */
export function gownBackOver(procedureId: ProcedureId | null, stepId: string): boolean {
  if (procedureId === null) return false
  const after = GOWN_STEPS.get(procedureId)
  return after !== undefined && after.has(stepId)
}

/**
 * What the patient's view asks the stage to show, kept in `mem` (idempotent: the runtime calls it before it skins, `stepProcStage` again): the latch of the position the prep was
 * done in, whether she has moved away from it, the plate, the drape, and `wants`. A rise of `wants` starts a new epoch. `gown`: the gown is back over the site (`gownBackOver`): nothing
 * is wanted, the latch is let go, whatever the view's prep, marks and drape say.
 */
export function updateWants(mem: ProcMemory, p: Readonly<PatientPoseView>, gown = false): boolean {
  mem.gown = gown
  const prepOn = !gown && (p.prep > 0.004 || p.marks !== 'none')
  if (!prepOn) mem.latched = false
  else if (!mem.latched) {
    mem.latched = true
    mem.lPosition = p.position
    mem.lArms = p.arms
  }
  mem.away = mem.latched && (p.position !== mem.lPosition || p.arms !== mem.lArms)
  mem.plateOn = prepOn && !mem.away
  mem.drape = mem.away || gown ? 0 : drapeShown(p.drape, p.prep)
  const wants = mem.plateOn || mem.drape > 0
  if (wants && !mem.wants) mem.epoch++
  mem.wants = wants
  return wants
}

/**
 * Lay the whole stage out for the current state into `mem.mesh`. The plate and its marks come first: the sheet's skirt drops to the plate's surface (sheet.ts). The window is placed
 * again only when what it is placed from changed (a fit came in, the needles moved, the case's position or target): the rebuilds while the drape eases reuse it.
 */
function build(mem: ProcMemory, patient: Readonly<PatientPoseView>, u: number, plateOn: boolean, target: CryoTarget, sk: number): void {
  const m = mem.mesh
  const cfg = ROOMS[mem.room]
  const f = mem.field
  const pos = mem.latched ? mem.lPosition : patient.position
  if (!mem.placed || mem.placedFits !== f.fits || mem.placedSites !== sk || mem.placedPosition !== pos || mem.placedTarget !== target || mem.placedEpoch !== mem.epoch) {
    windowInto(mem.room, pos, target, mem.spec)
    placeWindow(f, cfg, mem.spec, mem.usedSites, mem.nUsed, mem.window)
    mem.placed = true
    mem.placedFits = f.fits
    mem.placedSites = sk
    mem.placedPosition = pos
    mem.placedTarget = target
    mem.placedEpoch = mem.epoch
    mem.placements++
  }
  resetMesh(m)
  mem.parts.fill(0)
  mem.plate.v0 = -1
  if (plateOn) {
    let from = m.ni
    buildPlate(m, f, mem.window, mem.plate)
    setPart(mem, PROC_PART.plate, from)
    paintPlate(m, mem.plate, clamp01(patient.prep))
    from = m.ni
    buildMarks(m, f, mem.plate, mem.room, patient.marks, mem.usedSites, mem.nUsed)
    setPart(mem, PROC_PART.marks, from)
  }
  if (u > 0.004) {
    const from = m.ni
    const lead = cfg.sheetZ0 + (cfg.sheetZ1 - cfg.sheetZ0) * smoothstep(0, 0.92, u)
    buildSheet(m, f, cfg, lead, mem.window, plateOn ? mem.plate : null)
    mem.parts[PROC_PART.sheet * 2] = from
    mem.parts[PROC_PART.sheet * 2 + 1] = SHEET_BUILD.clothEnd
    mem.parts[PROC_PART.skirt * 2] = SHEET_BUILD.clothEnd
    mem.parts[PROC_PART.skirt * 2 + 1] = m.ni
  }
  finishNormals(m)
}

/** Whether the geometry has to be laid out again for what the patient's view says now (the fit being whole). */
function buildDue(mem: ProcMemory, p: Readonly<PatientPoseView>, plateOn: boolean, dq: number, sk: number, target: CryoTarget): boolean {
  const discrete =
    mem.refitPending ||
    p.marks !== mem.bMarks ||
    plateOn !== mem.bPlate ||
    p.position !== mem.bPosition ||
    target !== mem.bTarget ||
    Math.abs(sk - mem.bSites) > 1e-9 ||
    (dq === 0) !== (mem.bDrape === 0)
  const eased = dq !== mem.bDrape && mem.clock - mem.builtAt >= MIN_REBUILD
  return discrete || eased || mem.bDrape < 0
}

/**
 * One frame. Starts and steps the fit of the field when the stage has something to show and the skin changed, lays the stage out when the state asks (see the file's header),
 * repaints the plate while `prep` eases and writes the mesh's matrix. `mem.geoDirty` / `mem.colDirty` tell the layer what to upload; it clears them. Nothing is drawn (the mesh
 * stays empty) until the patient's skin is known and fitted, and nothing while she is away from where the prep was done.
 */
export function stepProcStage(mem: ProcMemory, inp: ProcIn): void {
  const p = inp.patient
  const dt = inp.dt > 0 ? inp.dt : 0
  mem.clock += dt
  const target: CryoTarget = inp.target === undefined ? 'kidney' : inp.target
  const cfg = ROOMS[mem.room]
  const wants = updateWants(mem, p, inp.gown === true)
  const plateOn = mem.plateOn
  const u = mem.drape
  const f = mem.field
  const budget = inp.fitBudget === undefined ? Infinity : inp.fitBudget
  const sync = budget === Infinity
  const skin = inp.skin

  // the sites: the needles' entries, or the breast's one (the couch's window middle)
  let n = inp.nSites < MAX_SITES ? inp.nSites : MAX_SITES
  for (let i = 0; i < n * 2; i++) mem.usedSites[i] = inp.sites[i]
  if (n === 0 && mem.room === 'us') {
    fieldSiteInto('us', target, mem.usedSites, 0)
    n = 1
  }
  mem.nUsed = n

  // the fit: begun when there is something to show and the skin is one this epoch has not been fitted to; dropped when there is nothing to show
  if (!wants) {
    if (f.busy) cancelFit(f)
  } else if (skin !== null && !f.busy && (mem.fitVersion !== skin.version || mem.fitEpoch !== mem.epoch)) {
    beginFit(f, skin.v, skin.index, skin.tris, cfg.sheetZ0, cfg.sheetZ1)
    mem.fitVersion = skin.version
    mem.fitEpoch = mem.epoch
    mem.fitsBegun++
  }

  const dq = Math.round(u * 150)
  const sk = sitesKey(mem.usedSites, n)
  let ready = wants && mem.readyEpoch === mem.epoch
  // one heavy job a frame (a slice of the fit, or the rebuild; the rebuild goes first when it is due), unless the budget is the whole fit
  let ran = false
  if (wants && f.busy && budget > 0 && (sync || !(ready && buildDue(mem, p, plateOn, dq, sk, target)))) {
    if (stepFit(f, budget)) {
      mem.refitPending = true
      mem.readyEpoch = mem.fitEpoch
      ready = mem.readyEpoch === mem.epoch
    }
    ran = true
  }
  if (!ready) {
    // nothing to draw (nothing wanted, or the skin is not fitted yet): an empty mesh
    if (mem.mesh.ni > 0 || mem.bDrape >= 0) {
      resetMesh(mem.mesh)
      mem.parts.fill(0)
      mem.plate.v0 = -1
      mem.bDrape = -1
      mem.bPlate = false
      mem.bMarks = 'none'
      mem.geoDirty = true
      mem.colDirty = false
    }
  } else if ((sync || !ran) && buildDue(mem, p, plateOn, dq, sk, target)) {
    build(mem, p, u, plateOn, target, sk)
    mem.refitPending = false
    mem.bFits = f.fits
    mem.bMarks = p.marks
    mem.bPlate = plateOn
    mem.bPosition = p.position
    mem.bTarget = target
    mem.bSites = sk
    mem.bDrape = dq
    mem.bPrep = Math.round(clamp01(p.prep) * 100)
    mem.builtAt = mem.clock
    mem.paintedAt = mem.clock
    mem.geoDirty = true
    mem.colDirty = true
    mem.builds++
  } else if (plateOn && mem.plate.v0 >= 0) {
    const pq = Math.round(clamp01(p.prep) * 100)
    if (pq !== mem.bPrep && mem.clock - mem.paintedAt >= MIN_REPAINT) {
      paintPlate(mem.mesh, mem.plate, clamp01(p.prep))
      mem.bPrep = pq
      mem.paintedAt = mem.clock
      mem.colDirty = true
      mem.repaints++
    }
  }
  // the patient's frame in the room: Ry(heading), then the translation to the pad's top under the pelvis
  const c = Math.cos(inp.heading)
  const s = Math.sin(inp.heading)
  const O = mem.matrix
  O[0] = c
  O[1] = 0
  O[2] = -s
  O[3] = 0
  O[4] = 0
  O[5] = 1
  O[6] = 0
  O[7] = 0
  O[8] = s
  O[9] = 0
  O[10] = c
  O[11] = 0
  O[12] = inp.rootX
  O[13] = inp.rootY
  O[14] = inp.rootZ
  O[15] = 1
}

/** Triangles of the stage as it stands (index count / 3). */
export function procTriangles(mem: ProcMemory): number {
  return mem.mesh.ni / 3
}
