/**
 * Model-vs-plan consistency: the authored walls must sit where `buildWallPieces()` says (same lines, same ends) within 2 cm, in the pilot region.
 * Method: for every solid level-1 wall piece inside the region, take the model's vertices at least 1 m above the floor in a band around
 * the piece, then require that the wall's two faces are centred on the plan line (across) and that the model reaches both ends (along).
 */
import { Box3, Mesh, Vector3, type Object3D } from 'three'
import type { WallPiece } from '../layout/types'
import { PILOT_REGION } from './region'

export const PLAN_TOLERANCE = 0.02
const BAND = 0.45 // half-width of the band searched around a wall line, metres
const Y0 = 1.0 // above the floor and skirting: a full-height wall quad has vertices only at its top and bottom edges

export interface PlanMismatch {
  piece: WallPiece
  reason: string
}

export interface PlanCheck {
  checked: number
  mismatches: PlanMismatch[]
}

const inside = (p: WallPiece): boolean => {
  const x0 = p.alongX ? p.a : p.c
  const x1 = p.alongX ? p.b : p.c
  const z0 = p.alongX ? p.c : p.a
  const z1 = p.alongX ? p.c : p.b
  return x0 >= PILOT_REGION.x0 && x1 <= PILOT_REGION.x1 && z0 >= PILOT_REGION.z0 && z1 <= PILOT_REGION.z1
}

/** World-space vertices of every mesh under `root`, flattened x,y,z. */
export function worldVertices(root: Object3D): Float32Array {
  root.updateMatrixWorld(true)
  const out: number[] = []
  const v = new Vector3()
  root.traverse((o) => {
    const mesh = o as Mesh
    const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      out.push(v.x, v.y, v.z)
    }
  })
  return Float32Array.from(out)
}

export function checkModelAgainstPlan(scene: Object3D, pieces: readonly WallPiece[], tol = PLAN_TOLERANCE): PlanCheck {
  const verts = worldVertices(scene)
  const mismatches: PlanMismatch[] = []
  let checked = 0
  for (const piece of pieces) {
    if (piece.cls !== 'solid' || !inside(piece)) continue
    checked++
    let aMin = Infinity
    let aMax = -Infinity
    const faces: number[] = []
    for (let i = 0; i < verts.length; i += 3) {
      if (verts[i + 1] < Y0) continue
      const along = piece.alongX ? verts[i] : verts[i + 2]
      const across = piece.alongX ? verts[i + 2] : verts[i]
      if (Math.abs(across - piece.c) > BAND || along < piece.a - BAND || along > piece.b + BAND) continue
      if (along < aMin) aMin = along
      if (along > aMax) aMax = along
      // a wall quad has vertices only at its corners, so the faces are read at the plan's own ends (a crossing wall's end faces do not pair up)
      if (along >= piece.a - tol && along <= piece.b + tol) faces.push(across)
    }
    if (faces.length === 0) {
      mismatches.push({ piece, reason: 'no model geometry on the wall line' })
      continue
    }
    // the two faces of the wall are a pair symmetric about the plan line
    const paired = faces.some((u) => u < piece.c - 0.005 && faces.some((v) => v > piece.c + 0.005 && Math.abs((u + v) / 2 - piece.c) <= tol))
    if (!paired) mismatches.push({ piece, reason: `no pair of wall faces centred on the plan line ${piece.c} (faces at ${[...new Set(faces.map((f) => f.toFixed(3)))].join(', ')})` })
    // a door or drawer cut leaves the end open, so only a solid end is held to the plan; an end must at least reach it
    if (aMin > piece.a + tol) mismatches.push({ piece, reason: `starts at ${aMin.toFixed(3)}, plan ${piece.a}` })
    if (aMax < piece.b - tol) mismatches.push({ piece, reason: `ends at ${aMax.toFixed(3)}, plan ${piece.b}` })
  }
  return { checked, mismatches }
}

/** The bounds of the model in world space (for logging in tests). */
export function modelBounds(scene: Object3D): Box3 {
  return new Box3().setFromObject(scene)
}
