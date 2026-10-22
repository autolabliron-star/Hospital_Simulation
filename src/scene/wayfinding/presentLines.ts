/**
 * Presentation mode (C) hides the coloured floor lines: an architectural walkthrough shows the floor, not the game's guidance. They stay in the
 * walk and the overview.
 *
 * The lines are prims of the building layout (./lines.ts), compiled with every other coloured decal on the palette's `tinted` material into the
 * building's instanced meshes (src/scene/building/render/compile.ts: one InstancedMesh per tinted shape, shared with e.g. the imaging rooms' floor
 * decals). So they are hidden per INSTANCE: on entering the mode their instances are found again by their exact centres (`wayfindingPieces`, the
 * same numbers the layout was built from) and given a zero matrix (no triangles); on leaving, the saved matrices go back. Nothing remounts,
 * nothing recompiles; it runs only when the mode changes (one scene walk and one small buffer upload), never per frame.
 *
 * `syncPresentLines(scene, presenting)` is called once a frame by Effects.tsx and returns at once unless `presenting` changed.
 */
import type { InstancedMesh, Material, Object3D } from 'three'
import { wayfindingPieces } from './lines'

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

/** While presenting with nothing hidden yet (the building is not mounted yet: `?view=present` is on from the first frame), look again this often (frames). */
const RETRY_FRAMES = 30
let retryIn = 0

/** Called every frame: acts only when `presenting` changed (or, while presenting, until the lines have been found). */
export function syncPresentLines(root: Object3D, presenting: boolean): void {
  if (presenting === state) {
    if (!presenting || hidden.length > 0 || --retryIn > 0) return
    retryIn = RETRY_FRAMES
    hideLines(root)
    return
  }
  state = presenting
  if (presenting) {
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
