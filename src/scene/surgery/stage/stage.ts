/**
 * R5 wave 2 (agent H): the stage of the operating table, the patient's prepped skin, sterile drapes and skin marks, as ONE merged mesh in the table's own frame.
 *
 *   prep   0..1  an opaque skin plate over the operative window, the antiseptic tint spreading from its middle (plate.ts)
 *   drape  0..1  the sterile sheets unfold: the big sheet from the neck toward the feet with its window over the plate and the anaesthetic screen at the neck (sheet.ts,
 *                screen.ts); in lithotomy the abdominal sheet ends at the groin and two leg sleeves and the perineal drape take over (legs.ts, perineum.ts)
 *   marks        pen dots, nicks with cannula stubs, closed lines, dressings on the plate at the ports (marks.ts)
 *
 * It is built from the room's `procedure.patient` (`PatientPoseView`): the numbers ease over a script step and the enums switch at its start. `stepStage` does everything a
 * frame needs and allocates nothing: it follows the legs' swing into the boots (the stirrups' own rate, so the body, the boots and these drapes slide together), rebuilds
 * the geometry at most `MIN_REBUILD` seconds apart while `drape` eases (at once when something discrete changes), repaints the plate's vertex colours while `prep` eases, and
 * writes the table's matrix: a tipped table costs only that.
 *
 * Drapes unfold in order (`prep` first: the drapes start when the skin is half done): the sheet from the neck, the screen rising, then in lithotomy the sleeves and the
 * perineal curtain. Their coming off is the same in reverse. A lithotomy patient going back to supine while draped (the wake-up) loses the leg parts at once and keeps the
 * abdominal sheet (`torsoOnly`) until it is gone.
 */
import { PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { newTablePose, setTablePose, tableMatrixInto, type TablePose } from '@/sim/surgery/tablePose'
import type { PatientMarks, PatientPoseView } from '@/sim/types'
import { settle } from '../table'
import { selectFit } from './fit'
import { clamp01, smoothstep } from './frame'
import { buildSleeve } from './legs'
import { buildMarks, SITE_COUNT } from './marks'
import { finishNormals, newStageMesh, resetMesh, type StageMesh } from './mesh'
import { buildPerineum } from './perineum'
import { buildPlate, paintPlate } from './plate'
import { buildScreen } from './screen'
import { buildSheet, LITH_END, SHEET_B0, SUPINE_END } from './sheet'

/** The legs' swing into the stirrups (1 / s): the live table top's own `OMEGA_BOOT` (table.ts), by value; stage.test.ts pins the two equal. */
export const STAGE_OMEGA = 3.2
/** The least time (s) between two geometry rebuilds while `drape` eases, and between two repaints of the plate while `prep` eases. */
export const MIN_REBUILD = 0.125
export const MIN_REPAINT = 0.06
/** How far the body slides toward the feet in lithotomy: the lithotomy position's pelvis (body.ts). */
const SLIDE = PELVIS_ON_TABLE.lithotomy

/** The parts of the mesh, for the index ranges `StageMemory.parts` keeps (two numbers each: first index, one past the last). */
export const PART = { sheet: 0, screen: 1, sleeveL: 2, sleeveR: 3, perineum: 4, plate: 5, marks: 6, count: 7 } as const

export interface StageIn {
  patient: Readonly<PatientPoseView>
  /** Five (body-frame d, x) pairs: the four robot ports, then the assistant's (ports.ts). */
  sites: Float64Array
  /** Bit i set: robot arm i is docked on its port (its stub is left out). */
  docked: number
  /** Real seconds since the last frame (0 while paused). */
  dt: number
  /** The patient's body in fit.data.ts (fit.ts `fitIndexOf`; -1 when not known: the union of the avatars) and size (`look.scale`). */
  fitAvatar: number
  fitScale: number
}

export interface StageMemory {
  mesh: StageMesh
  pose: TablePose
  /** The table's 4x4 (column-major, no offsets) and the mesh's own: that with the body's slide toward the feet added. */
  m: Float64Array
  matrix: Float64Array
  /** [legs in the stirrups 0..1, velocity]. */
  st: Float64Array
  init: boolean
  clock: number
  builtAt: number
  paintedAt: number
  // what the geometry was built from
  bLith: boolean
  bMarks: PatientMarks
  bDocked: number
  bDrape: number
  bPlate: boolean
  bTorso: boolean
  bSites: number
  bFit: number
  bPrep: number
  torsoOnly: boolean
  /** First vertex of the plate's colours, -1 without a plate; first vertex of the marks. */
  plateV0: number
  marksV0: number
  /** Index ranges of each part. */
  parts: Int32Array
  /** The drape actually shown (the script's, delayed behind the prep) and the slide, as of the last step. */
  drape: number
  slide: number
  /** The position the sheets were laid out for. */
  lith: boolean
  /** For the layer: the buffers changed (upload them), the colours changed, the matrix changed. */
  geoDirty: boolean
  colDirty: boolean
  /** Rebuilds so far (the tests count them). */
  builds: number
  repaints: number
}

export function newStageMemory(): StageMemory {
  const pose = newTablePose()
  const m = new Float64Array(16)
  tableMatrixInto(pose, m)
  return {
    mesh: newStageMesh(),
    pose,
    m,
    matrix: new Float64Array(m),
    st: new Float64Array(2),
    init: false,
    clock: 0,
    builtAt: -1e9,
    paintedAt: -1e9,
    bLith: false,
    bMarks: 'none',
    bDocked: 0,
    bDrape: -1,
    bPlate: false,
    bTorso: false,
    bSites: 0,
    bFit: -1,
    bPrep: -1,
    torsoOnly: false,
    plateV0: -1,
    marksV0: 0,
    parts: new Int32Array(PART.count * 2),
    drape: 0,
    slide: 0,
    lith: false,
    geoDirty: false,
    colDirty: false,
    builds: 0,
    repaints: 0,
  }
}

/** The drape the script's `drape` shows once the prep is under way: the sheets start when the skin is half done. */
export function drapeShown(drape: number, prep: number): number {
  return clamp01(drape) * smoothstep(0.45, 0.9, prep)
}

function setPart(mem: StageMemory, part: number, from: number): void {
  mem.parts[part * 2] = from
  mem.parts[part * 2 + 1] = mem.mesh.ni
}

/** A cheap fingerprint of the sites: the build is redone when a port moves. */
function sitesKey(sites: Float64Array): number {
  let s = 0
  for (let i = 0; i < SITE_COUNT * 2; i++) s += sites[i] * (i + 1) * 1.7
  return s
}

/** Lay the whole stage out for the current state into `mem.mesh`. */
function build(mem: StageMemory, patient: Readonly<PatientPoseView>, sites: Float64Array, docked: number, u: number, prepOn: boolean, fit: number, fitScale: number): void {
  const m = mem.mesh
  const lith = patient.position === 'lithotomy'
  const pelvisD = PELVIS_ON_TABLE[patient.position] ?? 0
  selectFit(fit, fitScale)
  resetMesh(m)
  mem.parts.fill(0)
  mem.plateV0 = -1
  if (u > 0.004) {
    let from = m.ni
    let rows: number
    if (lith) {
      rows = buildSheet(m, true, pelvisD, SHEET_B0 + (LITH_END - SHEET_B0) * smoothstep(0, 0.45, u), false)
    } else {
      let lead = SHEET_B0 + (SUPINE_END - SHEET_B0) * smoothstep(0, 0.92, u)
      if (mem.torsoOnly && lead > LITH_END) lead = LITH_END
      rows = buildSheet(m, false, pelvisD, lead, true)
    }
    setPart(mem, PART.sheet, from)
    if (rows > 0) {
      from = m.ni
      buildScreen(m, pelvisD, smoothstep(0.08, 0.58, u))
      setPart(mem, PART.screen, from)
    }
    if (lith) {
      const ext = smoothstep(0.3, 0.8, u)
      from = m.ni
      buildSleeve(m, 1, ext)
      setPart(mem, PART.sleeveL, from)
      from = m.ni
      buildSleeve(m, -1, ext)
      setPart(mem, PART.sleeveR, from)
      from = m.ni
      buildPerineum(m, smoothstep(0.55, 1, u))
      setPart(mem, PART.perineum, from)
    }
  }
  if (prepOn) {
    let from = m.ni
    mem.plateV0 = buildPlate(m, lith, pelvisD)
    setPart(mem, PART.plate, from)
    paintPlate(m, mem.plateV0, clamp01(patient.prep))
    from = m.ni
    mem.marksV0 = m.nv
    buildMarks(m, patient.marks, lith, pelvisD, sites, docked)
    setPart(mem, PART.marks, from)
  }
  finishNormals(m)
  mem.lith = lith
}

/**
 * One frame. Reads the room's patient view, the ports and which arms are docked; follows the legs' swing; rebuilds and repaints when the state asks (see the file's header);
 * writes `mem.matrix` (the mesh's matrix). `mem.geoDirty` / `mem.colDirty` tell the layer what to upload; it clears them.
 */
export function stepStage(mem: StageMemory, inp: StageIn): void {
  const p = inp.patient
  const dt = inp.dt > 0 ? inp.dt : 0
  mem.clock += dt
  const targetLith = p.position === 'lithotomy' ? 1 : 0
  if (!mem.init) {
    mem.init = true
    mem.st[0] = targetLith
    mem.st[1] = 0
  } else settle(mem.st, 0, targetLith, STAGE_OMEGA, dt)

  const prepOn = p.prep > 0.004
  const u = drapeShown(p.drape, p.prep)
  mem.drape = u
  const lith = targetLith === 1
  // the wake-up: lithotomy back to supine while draped: the leg parts go, the abdominal sheet stays until it is gone
  if (lith !== mem.bLith && !lith && mem.bDrape > 0) mem.torsoOnly = true
  if (u < 0.02) mem.torsoOnly = false
  const dq = Math.round(u * 150)
  const sk = sitesKey(inp.sites)
  const docked = inp.docked
  // the patient's body and size (to a quarter of a percent): the drapes are laid out for them
  const fitKey = inp.fitAvatar < 0 ? -1 : inp.fitAvatar * 1000 + Math.round(inp.fitScale * 200)
  const discrete =
    lith !== mem.bLith || p.marks !== mem.bMarks || docked !== mem.bDocked || prepOn !== mem.bPlate || mem.torsoOnly !== mem.bTorso || Math.abs(sk - mem.bSites) > 1e-9 || fitKey !== mem.bFit || (dq === 0) !== (mem.bDrape === 0)
  const eased = dq !== mem.bDrape && mem.clock - mem.builtAt >= MIN_REBUILD
  if (discrete || eased || mem.bDrape < 0) {
    build(mem, p, inp.sites, docked, u, prepOn, inp.fitAvatar, inp.fitScale)
    mem.bFit = fitKey
    mem.bLith = lith
    mem.bMarks = p.marks
    mem.bDocked = docked
    mem.bDrape = dq
    mem.bPlate = prepOn
    mem.bTorso = mem.torsoOnly
    mem.bSites = sk
    mem.bPrep = Math.round(clamp01(p.prep) * 100)
    mem.builtAt = mem.clock
    mem.paintedAt = mem.clock
    mem.geoDirty = true
    mem.colDirty = true
    mem.builds++
  } else if (prepOn && mem.plateV0 >= 0) {
    const pq = Math.round(clamp01(p.prep) * 100)
    if (pq !== mem.bPrep && mem.clock - mem.paintedAt >= MIN_REPAINT) {
      paintPlate(mem.mesh, mem.plateV0, clamp01(p.prep))
      mem.bPrep = pq
      mem.paintedAt = mem.clock
      mem.colDirty = true
      mem.repaints++
    }
  }

  // the table's pose; the body's slide toward the feet while the legs swing (the geometry was built for the target position)
  setTablePose(mem.pose, p.headTiltDeg, p.rollDeg)
  tableMatrixInto(mem.pose, mem.m)
  const slide = (clamp01(mem.st[0]) - targetLith) * SLIDE
  mem.slide = slide
  const M = mem.m
  const O = mem.matrix
  for (let i = 0; i < 12; i++) O[i] = M[i]
  O[12] = M[12] + M[8] * slide
  O[13] = M[13] + M[9] * slide
  O[14] = M[14] + M[10] * slide
  O[15] = 1
}

/** Triangles of the stage as it stands (index count / 3). */
export function stageTriangles(mem: StageMemory): number {
  return mem.mesh.ni / 3
}
