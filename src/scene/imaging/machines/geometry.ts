/**
 * The geometry kit of the animated machines: small pure functions that return vertex-coloured `BufferGeometry`.
 *
 * Every part is baked to the same layout (non-indexed, attributes `position`, `normal`, `color`) so any list of parts merges
 * into ONE geometry. Colours are given as hex strings in sRGB and stored as linear values (three's colour management).
 * Nothing here touches the DOM or WebGL, so node tests can build and measure every machine.
 *
 * Coordinates: metres, y up, x east, z south. Boxes are given by their bounds (`bx`), cylinders and rounded boxes by their centre.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** The architect's-model palette of the machines (matches `src/scene/materials.ts`). */
export const COL = {
  white: '#f5f6f6',
  liner: '#d3dcdd',
  grey: '#c6cdcf',
  greyMid: '#9aa6a8',
  dark: '#3a4245',
  darker: '#1f2527',
  rubber: '#2b3133',
  teal: '#5ea89c',
  bezel: '#1b2224',
  skin: '#e0ac86',
  gel: '#8ec9d6',
} as const

// ---------------------------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------------------------

export interface Place {
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
}

const _e = new Euler()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3(1, 1, 1)
const _m = new Matrix4()
const _c = new Color()

/** Fill the whole geometry with one colour (`color` attribute, 3 floats per vertex). */
export function paint(g: BufferGeometry, color: string | Color): BufferGeometry {
  _c.set(color)
  const n = g.getAttribute('position').count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[3 * i] = _c.r
    a[3 * i + 1] = _c.g
    a[3 * i + 2] = _c.b
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3))
  return g
}

/** Fill the whole geometry with one colour and an alpha (`color` attribute, 4 floats per vertex: the glow layout). */
export function paintRGBA(g: BufferGeometry, color: string | Color, alpha = 1): BufferGeometry {
  _c.set(color)
  const n = g.getAttribute('position').count
  const a = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    a[4 * i] = _c.r
    a[4 * i + 1] = _c.g
    a[4 * i + 2] = _c.b
    a[4 * i + 3] = alpha
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 4))
  return g
}

/** Make a source geometry mergeable: non-indexed, only position and normal, transformed by `at`, painted `color` (null: keep). */
export function bake(src: BufferGeometry, color: string | Color | null, at: Place = {}): BufferGeometry {
  let g = src
  if (g.index) {
    g = src.toNonIndexed()
    src.dispose()
  }
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  g.clearGroups()
  _e.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0, 'YXZ')
  _q.setFromEuler(_e)
  _p.set(at.x ?? 0, at.y ?? 0, at.z ?? 0)
  g.applyMatrix4(_m.compose(_p, _q, _s))
  if (color !== null) paint(g, color)
  return g
}

/** Merge parts into one geometry (the parts are disposed). All parts must have been baked. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false)
  if (!g) throw new Error('machines: parts do not share one attribute layout')
  for (const p of parts) p.dispose()
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** Number of triangles drawn by a geometry (respects its draw range). */
export function triangles(g: BufferGeometry): number {
  const total = g.index ? g.index.count : g.getAttribute('position').count
  const n = Math.min(total - g.drawRange.start, g.drawRange.count)
  return Math.floor(n / 3)
}

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

/** A box from its bounds. */
export function bx(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string): BufferGeometry {
  return bake(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0), color, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 })
}

/** A box centred at `at` (rotated by its rx, ry, rz). */
export function box(w: number, h: number, d: number, color: string, at: Place = {}): BufferGeometry {
  return bake(new BoxGeometry(w, h, d), color, at)
}

/** A rounded box, centred at `at`, `w` x `h` x `d`, corner radius `r`. */
export function rbox(w: number, h: number, d: number, r: number, color: string, at: Place = {}): BufferGeometry {
  return bake(new RoundedBoxGeometry(w, h, d, 2, Math.max(0.002, Math.min(r, Math.min(w, h, d) / 2 - 0.0005))), color, at)
}

/** A rounded box from its bounds. */
export function rbx(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, color: string): BufferGeometry {
  return rbox(x1 - x0, y1 - y0, z1 - z0, r, color, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 })
}

export type Axis = 'x' | 'y' | 'z'

/** Orient a geometry built along y (cylinder, capsule) or z (extrusion) so its axis runs along `axis`. */
function alongY(g: BufferGeometry, axis: Axis): BufferGeometry {
  if (axis === 'x') g.rotateZ(-Math.PI / 2)
  else if (axis === 'z') g.rotateX(Math.PI / 2)
  return g
}

/** A solid cylinder (or cone: `rEnd` is the radius at the +axis end) centred at `at`. */
export function cyl(axis: Axis, r: number, len: number, color: string, at: Place = {}, seg = 20, rEnd = r): BufferGeometry {
  return bake(alongY(new CylinderGeometry(rEnd, r, len, seg, 1), axis), color, at)
}

/** A capsule: `len` is the overall length including both caps. */
export function capsule(axis: Axis, r: number, len: number, color: string, at: Place = {}): BufferGeometry {
  return bake(alongY(new CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 3, 8), axis), color, at)
}

export function sphere(r: number, color: string, at: Place = {}, sx = 1, sy = 1, sz = 1): BufferGeometry {
  const g = new SphereGeometry(r, 14, 10)
  g.scale(sx, sy, sz)
  return bake(g, color, at)
}

/** A torus ring lying in the plane perpendicular to `axis`: ring radius `r`, tube radius `tube`. */
export function torus(axis: Axis, r: number, tube: number, color: string, at: Place = {}, seg = 48): BufferGeometry {
  const g = new TorusGeometry(r, tube, 6, seg) // lies in the XY plane (axis z)
  if (axis === 'x') g.rotateY(Math.PI / 2)
  else if (axis === 'y') g.rotateX(Math.PI / 2)
  return bake(g, color, at)
}

/** A flat plane facing `normal` (+x, -x, +y, +z or -z), `w` x `h`, centred at `at`. Faces up by default. */
export function plane(w: number, h: number, color: string, at: Place = {}, facing: 'up' | '+x' | '-x' | '+z' | '-z' = 'up'): BufferGeometry {
  const g = new PlaneGeometry(w, h)
  if (facing === 'up') g.rotateX(-Math.PI / 2)
  else if (facing === '+x') g.rotateY(Math.PI / 2)
  else if (facing === '-x') g.rotateY(-Math.PI / 2)
  else if (facing === '-z') g.rotateY(Math.PI)
  return bake(g, color, at)
}

// ---------------------------------------------------------------------------------------------
// Shapes and extrusions
// ---------------------------------------------------------------------------------------------

/** A rounded rectangle as a CCW polygon (corner radius `r`, `steps` segments per corner). */
export function rrPoints(cx: number, cy: number, w: number, h: number, r: number, steps = 8): Vector2[] {
  const pts: Vector2[] = []
  const hx = w / 2 - r
  const hy = h / 2 - r
  const corners: [number, number, number][] = [
    [hx, -hy, -Math.PI / 2],
    [hx, hy, 0],
    [-hx, hy, Math.PI / 2],
    [-hx, -hy, Math.PI],
  ]
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2)
      pts.push(new Vector2(cx + ox + r * Math.cos(a), cy + oy + r * Math.sin(a)))
    }
  }
  return pts
}

export function circlePoints(cx: number, cy: number, r: number, n = 48): Vector2[] {
  const pts: Vector2[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push(new Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)))
  }
  return pts
}

/** A rounded-rectangle shape with optional circular holes (each `[cx, cy, r]`). */
export function roundedShape(cx: number, cy: number, w: number, h: number, r: number, holes: [number, number, number][] = [], seg = 48): Shape {
  const s = new Shape(rrPoints(cx, cy, w, h, r))
  for (const [hx, hy, hr] of holes) s.holes.push(new Path(circlePoints(hx, hy, hr, seg)))
  return s
}

/** Crease angle that smooths round edges (a few degrees per facet) and keeps real corners sharp. */
const CREASE = 0.6

/** Give every big flat cap of an extrusion its exact flat normal (smooth shading must not bend a cap towards its bevel). */
function flattenCaps(g: BufferGeometry): void {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal') as BufferAttribute
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ax = pos.getX(i)
    const ay = pos.getY(i)
    const az = pos.getZ(i)
    const ux = pos.getX(i + 1) - ax
    const uy = pos.getY(i + 1) - ay
    const uz = pos.getZ(i + 1) - az
    const vx = pos.getX(i + 2) - ax
    const vy = pos.getY(i + 2) - ay
    const vz = pos.getZ(i + 2) - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len > 0 && Math.abs(nz) / len > 0.9999) {
      const s = nz > 0 ? 1 : -1
      for (let k = 0; k < 3; k++) nor.setXYZ(i + k, 0, 0, s)
    }
  }
  nor.needsUpdate = true
}

/**
 * A soft extruded body: `shape` (XY plane) extruded `depth` along z, centred on z = 0 (so it spans +-(depth/2 + bevelT)), with a
 * rounded bevel. The caps keep the outline of `shape`; the middle of the body is `bevelS` larger all round and the holes `bevelS`
 * smaller. Smooth round edges, flat caps. Not yet baked (call `bake` with a transform and colour).
 */
export function extrudeSoft(shape: Shape, depth: number, bevelT: number, bevelS: number, bevelSegs: number): BufferGeometry {
  const g0 = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevelT, bevelSize: bevelS, bevelSegments: bevelSegs, steps: 1, curveSegments: 1 })
  g0.translate(0, 0, -depth / 2)
  const g = toCreasedNormals(g0, CREASE)
  if (g !== g0) g0.dispose()
  flattenCaps(g)
  return g
}

/** A flat extruded plate (no bevel), centred on z = 0, with smooth round walls. */
export function extrudeFlat(shape: Shape, depth: number): BufferGeometry {
  const g0 = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 })
  g0.translate(0, 0, -depth / 2)
  const g = toCreasedNormals(g0, CREASE)
  if (g !== g0) g0.dispose()
  flattenCaps(g)
  return g
}

/** Turn an extrusion built along z so it runs along `axis` (z -> +x for 'x', z -> +y for 'y'). */
export function extrusionAlong(g: BufferGeometry, axis: Axis): BufferGeometry {
  if (axis === 'x') g.rotateY(Math.PI / 2)
  else if (axis === 'y') g.rotateX(-Math.PI / 2)
  return g
}

/** A hollow tube (outer radius `rOut`, inner `rIn`, length `len`) along `axis`, centred at `at`. */
export function tube(axis: Axis, rOut: number, rIn: number, len: number, color: string, at: Place = {}, seg = 48): BufferGeometry {
  const s = new Shape(circlePoints(0, 0, rOut, seg))
  s.holes.push(new Path(circlePoints(0, 0, rIn, seg)))
  return bake(extrusionAlong(extrudeFlat(s, len), axis), color, at)
}

/** A circular-arc band (inner radius `rIn`, outer `rOut`, from angle `a0` to `a1` in the XY plane) extruded `depth` along z. */
export function sector(rIn: number, rOut: number, a0: number, a1: number, depth: number, color: string, at: Place = {}, steps = 10): BufferGeometry {
  const pts: Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    pts.push(new Vector2(rOut * Math.cos(a), rOut * Math.sin(a)))
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps
    pts.push(new Vector2(rIn * Math.cos(a), rIn * Math.sin(a)))
  }
  return bake(extrudeFlat(new Shape(pts), depth), color, at)
}

/**
 * Re-colour a non-indexed geometry triangle by triangle. `pick` receives the nine corner coordinates of the triangle in `t` (reused,
 * never keep it) and returns a colour, or null to leave the triangle as it is.
 */
export function paintTriangles(g: BufferGeometry, pick: (t: Float32Array) => string | Color | null): BufferGeometry {
  const pos = g.getAttribute('position')
  const col = g.getAttribute('color') as BufferAttribute
  const t = new Float32Array(9)
  for (let i = 0; i + 2 < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) {
      t[3 * k] = pos.getX(i + k)
      t[3 * k + 1] = pos.getY(i + k)
      t[3 * k + 2] = pos.getZ(i + k)
    }
    const c = pick(t)
    if (c === null) continue
    _c.set(c)
    for (let k = 0; k < 3; k++) col.setXYZ(i + k, _c.r, _c.g, _c.b)
  }
  col.needsUpdate = true
  return g
}

// ---------------------------------------------------------------------------------------------
// Glow geometry: one mesh, several independently dimmable regions
// ---------------------------------------------------------------------------------------------

/** A run of vertices of a glow geometry that share one base colour and are dimmed, brightened or faded together. */
export interface GlowRegion {
  start: number
  count: number
  r: number
  g: number
  b: number
}

export interface GlowGeometry {
  geometry: BufferGeometry
  regions: Record<string, GlowRegion>
}

export class GlowBuilder {
  private readonly parts: BufferGeometry[] = []
  private readonly regions: Record<string, GlowRegion> = {}
  private vertices = 0

  /** Add a region made of `parts` (any baked geometries), painted `hex` at full alpha. Names must be unique. */
  region(name: string, hex: string, parts: BufferGeometry[]): this {
    if (this.regions[name]) throw new Error(`glow region ${name} exists`)
    _c.set(hex)
    const start = this.vertices
    for (const p of parts) {
      paintRGBA(p, hex, 1)
      this.parts.push(p)
      this.vertices += p.getAttribute('position').count
    }
    this.regions[name] = { start, count: this.vertices - start, r: _c.r, g: _c.g, b: _c.b }
    return this
  }

  build(): GlowGeometry {
    const geometry = merge(this.parts)
    geometry.deleteAttribute('normal') // unlit
    return { geometry, regions: this.regions }
  }
}

/** Write `gain * base colour` and `alpha` into a region of a glow geometry (colours above 1 bloom). Allocates nothing. */
export function setRegion(g: BufferGeometry, rg: GlowRegion, gain: number, alpha = 1): void {
  setRegionRGB(g, rg, rg.r * gain, rg.g * gain, rg.b * gain, alpha)
}

export function setRegionRGB(g: BufferGeometry, rg: GlowRegion, r: number, gr: number, b: number, alpha = 1): void {
  const attr = g.getAttribute('color') as BufferAttribute
  const a = attr.array as Float32Array
  for (let i = rg.start * 4, e = (rg.start + rg.count) * 4; i < e; i += 4) {
    a[i] = r
    a[i + 1] = gr
    a[i + 2] = b
    a[i + 3] = alpha
  }
  attr.needsUpdate = true
}

/** The colour of a hex string in linear space, as `[r, g, b]` (for blending two colours in a frame without allocating). */
export function linear(hex: string): [number, number, number] {
  _c.set(hex)
  return [_c.r, _c.g, _c.b]
}
