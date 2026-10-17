/**
 * The ceiling rail (W2): a slim white box-section beam that follows both robot circuits exactly, so the pods hang under
 * the very lines they used to drive on the floor. Pure geometry (no React, no sim state): built once, merged per
 * material, counted in node by the budget test and checked against the walls and ceilings by the clearance test.
 *
 *   body     the box-section beam, one continuous sweep round each closed circuit      (MAT.whitePlastic)
 *   collars  the hangers: a wider clamp block on the beam every `hangerEvery` metres    (MAT.frame)
 *   light    a thin teal line inlaid along the underside, and a matching one on the top (MAT.laneLine)
 *
 * Heights come from the contract (`ROBOT.rail`): the underside is `undersideY` and the beam stops at `hangerTopY`, the
 * ceiling plane. The contract also lists a `depth` of 0.08, but between an underside at 2.95 m and a 3.0 m ceiling there is
 * room for only 0.05 m, so the beam's height is `min(depth, hangerTopY - undersideY)` and the hangers are clamp blocks of
 * that same height (with a rod up to `hangerTopY` too, should the contract ever leave a gap above the beam). The light lines
 * are inlaid in the beam's faces (the beam leaves a gap there and the light fills it, in the same plane), so nothing
 * stands proud of the beam and nothing rises above the ceiling. The top line is for the overview, where there are no
 * ceilings and the beam is seen from above; in walk mode the ceiling hides it.
 */
import type { BufferGeometry } from 'three'
import { CIRCUITS, pointAt, type Circuit, type PathPoint } from '@/sim/meds/circuit'
import { ROBOT } from '@/sim/places'
import type { WardId } from '@/sim/types'
import { MeshBuilder } from './meshBuilder'

const R = ROBOT.rail

export const CEILING_RAIL = {
  /** Beam cross-section (m): across the travel direction and from underside to top. */
  width: R.width,
  height: Math.min(R.depth, R.hangerTopY - R.undersideY),
  /** The underside, and the top of the beam (never above the hanger top, which is the ceiling plane). */
  y0: R.undersideY,
  y1: R.undersideY + Math.min(R.depth, R.hangerTopY - R.undersideY),
  hangerTopY: R.hangerTopY,
  /** Metres between hangers along the beam, and the clamp block's half extents across / along the beam. */
  hangerEvery: 2,
  collarHalfAcross: 0.1,
  collarHalfAlong: 0.05,
  /** Hanger rod (only when there is a gap above the beam): half width. */
  rodHalf: 0.015,
  /** The light lines inlaid in the underside and the top: width. */
  lightWidth: 0.03,
  /** Arcs are sampled every 5 degrees (a 1.3 m U-turn then deviates from the true arc by about a millimetre). */
  arcStep: Math.PI / 36,
} as const

const WARDS: readonly WardId[] = ['A', 'B']

export interface RailSample {
  x: number
  z: number
  heading: number
  /** Arc length along the circuit. */
  s: number
}

/**
 * Where the beam's cross-sections go along a circuit: the start of every segment (a straight needs nothing between its two
 * ends) and every `arcStep` round a turn. The loop is closed: the last sample joins the first.
 */
export function railSamples(c: Circuit, arcStep: number = CEILING_RAIL.arcStep): RailSample[] {
  const out: RailSample[] = []
  const p: PathPoint = { x: 0, z: 0, heading: 0 }
  for (const g of c.segments) {
    const n = g.kind === 'line' ? 1 : Math.max(2, Math.ceil(Math.abs(g.sweep) / arcStep))
    for (let i = 0; i < n; i++) {
      const s = g.s0 + (g.len * i) / n
      pointAt(c, s, p)
      out.push({ x: p.x, z: p.z, heading: p.heading, s })
    }
  }
  return out
}

/** Offsets across the beam of the four points that split a face round the light line. */
function across(): readonly [number, number, number, number] {
  const hw = CEILING_RAIL.width / 2
  const lw = CEILING_RAIL.lightWidth / 2
  return [-hw, -lw, lw, hw]
}

/**
 * The beam of one circuit swept as faces: underside and top (each in two pieces, leaving the light line's gap between them)
 * and the two sides, closed into a loop.
 */
function addBeam(m: MeshBuilder, samples: readonly RailSample[]): void {
  const { y0, y1 } = CEILING_RAIL
  const [a, b, c, d] = across()
  // per sample: underside [-hw, -lw], [lw, hw]; top [-hw, -lw], [lw, hw]; left side (bottom, top); right side (bottom, top)
  const rows: number[][] = []
  for (const q of samples) {
    const nx = Math.cos(q.heading)
    const nz = -Math.sin(q.heading)
    const at = (o: number, y: number, ny: number, sx = 0, sz = 0): number => m.vertex(q.x + nx * o, y, q.z + nz * o, sx, ny, sz)
    rows.push([
      at(a, y0, -1),
      at(b, y0, -1),
      at(c, y0, -1),
      at(d, y0, -1),
      at(a, y1, 1),
      at(b, y1, 1),
      at(c, y1, 1),
      at(d, y1, 1),
      at(a, y0, 0, -nx, -nz),
      at(a, y1, 0, -nx, -nz),
      at(d, y0, 0, nx, nz),
      at(d, y1, 0, nx, nz),
    ])
  }
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i]
    const n = rows[(i + 1) % rows.length]
    for (const [k0, k1] of [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
      [10, 11],
    ]) {
      m.quad(p[k0], p[k1], n[k1], n[k0])
    }
  }
}

/** The light line: a strip of `lightWidth` along the circuit in the plane `y`, facing `ny` (-1 down, +1 up). */
function addStrip(m: MeshBuilder, samples: readonly RailSample[], y: number, ny: number): void {
  const [, b, c] = across()
  const rows: number[][] = []
  for (const q of samples) {
    const nx = Math.cos(q.heading)
    const nz = -Math.sin(q.heading)
    rows.push([m.vertex(q.x + nx * b, y, q.z + nz * b, 0, ny, 0), m.vertex(q.x + nx * c, y, q.z + nz * c, 0, ny, 0)])
  }
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i]
    const n = rows[(i + 1) % rows.length]
    m.quad(p[0], p[1], n[1], n[0])
  }
}

/** Where the hangers go on a circuit: `hangerEvery` metres apart, centred in their spans. */
export function hangerSpots(c: Circuit): RailSample[] {
  const n = Math.max(1, Math.round(c.length / CEILING_RAIL.hangerEvery))
  const p: PathPoint = { x: 0, z: 0, heading: 0 }
  const out: RailSample[] = []
  for (let k = 0; k < n; k++) {
    const s = ((k + 0.5) * c.length) / n
    pointAt(c, s, p)
    out.push({ x: p.x, z: p.z, heading: p.heading, s })
  }
  return out
}

export interface RailGeometry {
  body: BufferGeometry
  collars: BufferGeometry
  light: BufferGeometry
}

/** The whole rail of both wards: three merged meshes, so three draw calls. */
export function buildRail(): RailGeometry {
  const body = new MeshBuilder()
  const collars = new MeshBuilder()
  const light = new MeshBuilder()
  const { y0, y1, hangerTopY, collarHalfAcross, collarHalfAlong, rodHalf } = CEILING_RAIL
  for (const w of WARDS) {
    const c = CIRCUITS[w]
    const samples = railSamples(c)
    addBeam(body, samples)
    addStrip(light, samples, y0, -1)
    addStrip(light, samples, y1, 1)
    for (const h of hangerSpots(c)) {
      collars.box(h.x, h.z, h.heading, collarHalfAcross, collarHalfAlong, y0, y1)
      if (hangerTopY - y1 > 1e-3) collars.box(h.x, h.z, h.heading, rodHalf, rodHalf, y1, hangerTopY)
    }
  }
  return { body: body.geometry(), collars: collars.geometry(), light: light.geometry() }
}
