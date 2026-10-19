/**
 * W4 lab: the moving machine parts as ONE merged vertex-coloured geometry (drawn with MACHINE_BODY, one draw call): the two centrifuge lids
 * and rotors, the four analyser probes and the three grippers (decapper, recapper, sorter). Each part is built around its own pivot; `posePart`
 * rewrites its vertices (position and normal) in place for a new angle or offset, so nothing is allocated per frame and no part needs a mesh of
 * its own. Pure three.js (no DOM, no React): the node tests build it and count its triangles.
 *
 * Rotation about y follows the bucket maths of motion.ts (a point (r, 0) turns to (r cos a, r sin a)), so a rotor's sockets and the tubes in them
 * always agree; rotation about z lifts +x towards +y (a lid hinged at its west edge swings up and over to the west).
 */
import { type BufferAttribute, type BufferGeometry, DynamicDrawUsage } from 'three'
import { bx, COL, cyl, merge } from '@/scene/imaging/machines/geometry'
import { centrifuge, CFG_COUNT, GRIPPER_IDS, gripperAt, PROBE_IDS, probeAt } from './labDims'

export interface MovingPart {
  id: string
  /** First vertex in the merged geometry, and how many. */
  start: number
  count: number
  /** Local positions and normals (the pose maths reads these, never the live attributes). */
  base: Float32Array
  baseN: Float32Array
  pivot: { x: number; y: number; z: number }
  axis: 'x' | 'y' | 'z' | null
}

export interface MovingParts {
  geometry: BufferGeometry
  parts: MovingPart[]
  byId: Map<string, MovingPart>
}

interface Draft {
  id: string
  pivot: { x: number; y: number; z: number }
  axis: 'x' | 'y' | 'z' | null
  geos: BufferGeometry[]
}

const METAL = '#c9d0d2'
const GRIP = '#6e7a7d'

function lidDraft(i: number): Draft {
  const c = centrifuge(i)
  const { len, depth, thick } = c.lid
  return {
    id: `lid${i}`,
    pivot: { ...c.hinge },
    axis: 'z',
    geos: [
      bx(0, len, 0, thick, -depth / 2, depth / 2, COL.white),
      bx(0.1, len - 0.1, thick, thick + 0.004, -depth / 2 + 0.1, depth / 2 - 0.1, COL.darker),
      bx(len - 0.07, len - 0.02, thick, thick + 0.03, -0.1, 0.1, COL.dark),
      bx(0.02, len - 0.02, -0.012, 0, -depth / 2 + 0.03, depth / 2 - 0.03, COL.grey),
    ],
  }
}

function rotorDraft(i: number): Draft {
  const r = centrifuge(i).rotor
  const geos: BufferGeometry[] = [cyl('y', r.r, 0.03, METAL, { y: 0.015 }, 24), cyl('y', 0.045, 0.06, COL.dark, { y: 0.045 }, 12)]
  for (let k = 0; k < r.buckets; k++) {
    const a = (k * Math.PI * 2) / r.buckets
    geos.push(cyl('y', 0.015, 0.024, COL.darker, { x: Math.cos(a) * r.bucketR, y: 0.042, z: Math.sin(a) * r.bucketR }, 6))
  }
  // two bars across the disc (one red, one dark): they make the spin readable
  geos.push(bx(-0.22, 0.22, 0.03, 0.036, -0.012, 0.012, '#c0392b'), bx(-0.012, 0.012, 0.03, 0.036, -0.22, 0.22, COL.dark))
  return { id: `rotor${i}`, pivot: { x: r.x, y: r.y, z: r.z }, axis: 'y', geos }
}

function probeDraft(id: (typeof PROBE_IDS)[number]): Draft {
  const p = probeAt(id)
  return {
    id: `probe:${id}`,
    pivot: { x: p.x, y: 0, z: p.z },
    axis: null,
    // a thin rod whose tip is the part's origin, and the carriage that slides in the arm above it
    geos: [cyl('y', 0.004, 0.25, COL.greyMid, { y: 0.125 }, 6), bx(-0.02, 0.02, 0.19, 0.24, -0.02, 0.02, COL.dark)],
  }
}

function gripperDraft(id: (typeof GRIPPER_IDS)[number]): Draft {
  const g = gripperAt(id)
  return {
    id: `grip:${id}`,
    pivot: { x: g.x, y: 0, z: g.z },
    axis: null,
    geos: [cyl('y', 0.006, 0.2, COL.dark, { y: 0.1 }, 6), bx(-0.022, 0.022, 0, 0.03, -0.022, 0.022, GRIP), bx(-0.026, -0.02, -0.022, 0.012, -0.012, 0.012, COL.dark), bx(0.02, 0.026, -0.022, 0.012, -0.012, 0.012, COL.dark)],
  }
}

export function buildMovingParts(): MovingParts {
  const drafts: Draft[] = []
  for (let i = 0; i < CFG_COUNT; i++) drafts.push(lidDraft(i), rotorDraft(i))
  for (const id of PROBE_IDS) drafts.push(probeDraft(id))
  for (const id of GRIPPER_IDS) drafts.push(gripperDraft(id))

  const merged: BufferGeometry[] = []
  const parts: MovingPart[] = []
  let start = 0
  for (const d of drafts) {
    const g = merge(d.geos)
    const count = g.getAttribute('position').count
    parts.push({
      id: d.id,
      start,
      count,
      base: Float32Array.from(g.getAttribute('position').array as Float32Array),
      baseN: Float32Array.from(g.getAttribute('normal').array as Float32Array),
      pivot: d.pivot,
      axis: d.axis,
    })
    start += count
    merged.push(g)
  }
  const geometry = merge(merged)
  const position = geometry.getAttribute('position') as BufferAttribute
  const normal = geometry.getAttribute('normal') as BufferAttribute
  position.setUsage(DynamicDrawUsage)
  normal.setUsage(DynamicDrawUsage)
  const byId = new Map(parts.map((p) => [p.id, p]))
  const mp: MovingParts = { geometry, parts, byId }
  for (const p of parts) posePart(mp, p, 0, 0, 0, 0)
  // the bounds cover every pose of every part (the mesh is never culled, but a bounding box makes the probe and the tests honest)
  geometry.boundingBox = null
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return mp
}

/**
 * Pose a part: turn it by `angle` about its axis, then move its pivot to the pivot + (dx, dy, dz). Rewrites the part's vertices in the merged
 * geometry (the caller sets `needsUpdate` once for the frame). Allocation-free.
 */
export function posePart(mp: MovingParts, p: MovingPart, angle: number, dx: number, dy: number, dz: number): void {
  const pos = (mp.geometry.getAttribute('position') as BufferAttribute).array as Float32Array
  const nor = (mp.geometry.getAttribute('normal') as BufferAttribute).array as Float32Array
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const px = p.pivot.x + dx
  const py = p.pivot.y + dy
  const pz = p.pivot.z + dz
  const a = p.axis
  for (let i = 0; i < p.count; i++) {
    const o = i * 3
    const t = (p.start + i) * 3
    let x = p.base[o]
    let y = p.base[o + 1]
    let z = p.base[o + 2]
    let nx = p.baseN[o]
    let ny = p.baseN[o + 1]
    let nz = p.baseN[o + 2]
    if (a === 'y') {
      // (x, z) -> (x cos - z sin, x sin + z cos)
      const x2 = x * c - z * s
      const z2 = x * s + z * c
      x = x2
      z = z2
      const nx2 = nx * c - nz * s
      const nz2 = nx * s + nz * c
      nx = nx2
      nz = nz2
    } else if (a === 'z') {
      // (x, y) -> (x cos - y sin, x sin + y cos)
      const x2 = x * c - y * s
      const y2 = x * s + y * c
      x = x2
      y = y2
      const nx2 = nx * c - ny * s
      const ny2 = nx * s + ny * c
      nx = nx2
      ny = ny2
    } else if (a === 'x') {
      const y2 = y * c - z * s
      const z2 = y * s + z * c
      y = y2
      z = z2
      const ny2 = ny * c - nz * s
      const nz2 = ny * s + nz * c
      ny = ny2
      nz = nz2
    }
    pos[t] = px + x
    pos[t + 1] = py + y
    pos[t + 2] = pz + z
    nor[t] = nx
    nor[t + 1] = ny
    nor[t + 2] = nz
  }
}
