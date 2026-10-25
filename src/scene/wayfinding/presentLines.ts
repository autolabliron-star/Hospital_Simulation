/**
 * The coloured floor lines are the map's guidance, not part of the place: they show in the overview (the map view) only. Walking (step 3: a real
 * place, not a game; their rounded caps read as a pointer at eye level), the flights between the two and presentation mode (C) hide them.
 * `linesHidden` is that rule. The flights count as walking, so the lines change only while the camera is up at the overview, where they are small.
 *
 * The lines are prims of the building layout (./lines.ts), compiled with every other coloured decal on the palette's `tinted` material into the
 * building's instanced meshes (src/scene/building/render/compile.ts: one InstancedMesh per tinted shape, shared with e.g. the imaging rooms' floor
 * decals). So they are hidden per INSTANCE: on entering the mode their instances are found again by their exact centres (`wayfindingPieces`, the
 * same numbers the layout was built from) and given a zero matrix (no triangles); on leaving, the saved matrices go back. Nothing remounts,
 * nothing recompiles; it runs only when the mode changes (one scene walk and one small buffer upload), never per frame.
 *
 * `syncPresentLines(scene, hide)` is called once a frame by Effects.tsx (with `linesHidden(...)`) and returns at once unless `hide` changed.
 */
import type { InstancedMesh, Material, Object3D } from 'three'
import type { PlayerMode } from '@/sim/types'
import { wayfindingPieces } from './lines'

/**
 * Are the floor lines hidden now: in presentation mode, and whenever the player is not in the overview (walking, or flying to or from it). With no
 * player mounted (`phase` null) only presentation hides them.
 */
export function linesHidden(presenting: boolean, phase: PlayerMode | null): boolean {
  return presenting || (phase !== null && phase !== 'overview')
}

/** Centres (instance translations) of the line pieces, as a set of rounded keys. Built on first use. */
let centres: Set<string> | null = null

/** The rounded key of a centre (millimetres: float32 matrices keep far more than that, and no other decal shares a centre to the millimetre). */
function keyOf(x: number, y: number, z: number): string {
  return `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`
}

function lineCentres(): Set<string> {
  if (centres) return centres
  centres = new Set()
  // a strip's prim sits at its y; a cap is a cylinder placed by its bottom, so its centre is half its height higher (LayoutBuilder.push)
  for (const p of wayfindingPieces()) centres.add(keyOf(p.x, p.shape === 'cyl' ? p.y + p.d / 2 : p.y, p.z))
  return centres
}

/** Instances hidden now: the mesh, the index and the matrix to put back. */
interface Hidden {
  mesh: InstancedMesh
  index: number
  matrix: Float32Array
}
let hidden: Hidden[] = []
let state = false
let tinted: Material | null = null

/** The material the lines are drawn with (the palette's `tinted`): set once by the caller, so this module stays free of the palette in tests. */
export function setLineMaterial(m: Material): void {
  tinted = m
}

function isLineHost(o: Object3D): o is InstancedMesh {
  const m = o as InstancedMesh
  return m.isInstancedMesh === true && m.material === tinted && m.name.startsWith('tinted|')
}

let scratch: Hidden[] = []
function visit(o: Object3D): void {
  if (!isLineHost(o)) return
  const want = lineCentres()
  const a = o.instanceMatrix.array as Float32Array
  let any = false
  for (let i = 0; i < o.count; i++) {
    const at = i * 16
    if (!want.has(keyOf(a[at + 12], a[at + 13], a[at + 14]))) continue
    scratch.push({ mesh: o, index: i, matrix: a.slice(at, at + 16) })
    a.fill(0, at, at + 16)
    any = true
  }
  if (any) o.instanceMatrix.needsUpdate = true
}

/** Zero every line instance under `root` (saving its matrix). Returns how many were hidden. */
export function hideLines(root: Object3D): number {
  scratch = hidden
  root.traverse(visit)
  hidden = scratch
  return hidden.length
}

/** Put every hidden instance back. */
export function showLines(): void {
  for (const h of hidden) {
    ;(h.mesh.instanceMatrix.array as Float32Array).set(h.matrix, h.index * 16)
    h.mesh.instanceMatrix.needsUpdate = true
  }
  hidden = []
}

/** While hiding with nothing hidden yet (the building is not mounted yet: the app starts walking, and `?view=present` is on from the first frame), look again this often (frames). */
const RETRY_FRAMES = 30
let retryIn = 0

/** Called every frame: acts only when `hide` changed (or, while hiding, until the lines have been found). */
export function syncPresentLines(root: Object3D, hide: boolean): void {
  if (hide === state) {
    if (!hide || hidden.length > 0 || --retryIn > 0) return
    retryIn = RETRY_FRAMES
    hideLines(root)
    return
  }
  state = hide
  if (hide) {
    retryIn = RETRY_FRAMES
    hideLines(root)
  } else showLines()
}

/** For tests. */
export function resetPresentLinesForTests(): void {
  hidden = []
  state = false
  retryIn = 0
  centres = null
  tinted = null
}
