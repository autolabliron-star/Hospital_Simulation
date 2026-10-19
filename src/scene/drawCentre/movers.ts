/**
 * The moving parts of the draw centre, as ONE vertex-coloured mesh. Every part (a robot head, a needle, a tourniquet ring, a tube bar, the prep
 * gripper and its held tube ...) is baked into the merged geometry at its REST pose; the rig then re-poses a part by rewriting its vertices from
 * a copy of the rest positions (a translation, a scale about a pivot, a shear, a spin about the vertical axis). A pose is a few hundred floats at
 * most, written only when it changed by more than `EPS`, so the whole centre's moving parts cost one draw call and a handful of comparisons.
 * Nothing allocates after construction.
 *
 * Normals are left as baked: a translation keeps them exact, a spin turns the part's normals too, and the scaled parts (thin boxes and a ring)
 * shade well enough with their rest normals.
 */
import { type BufferAttribute, type BufferGeometry, DynamicDrawUsage, Sphere, Vector3 } from 'three'
import { merge } from '@/scene/imaging/machines/geometry'

/** A run of vertices of the movers geometry, with the pivot it scales and spins about. */
export interface Part {
  id: string
  start: number
  count: number
  px: number
  py: number
  pz: number
}

export class MoversBuilder {
  private readonly geos: BufferGeometry[] = []
  private readonly list: Part[] = []
  private vertices = 0

  /** Add a part made of baked geometries (`bake`/`bx`/`cyl` ... from the machines' geometry kit), with the pivot of its scale and spin. */
  part(id: string, geometries: BufferGeometry[], pivot: readonly [number, number, number]): Part {
    if (this.list.some((p) => p.id === id)) throw new Error(`movers: part ${id} exists`)
    const start = this.vertices
    for (const g of geometries) {
      this.geos.push(g)
      this.vertices += g.getAttribute('position').count
    }
    const part: Part = { id, start, count: this.vertices - start, px: pivot[0], py: pivot[1], pz: pivot[2] }
    this.list.push(part)
    return part
  }

  build(): Movers {
    const geometry = merge(this.geos)
    return new Movers(geometry, this.list)
  }
}

/** A pose component must change by more than this (m, or radians) to be rewritten. */
export const EPS = 0.0004

export class Movers {
  readonly geometry: BufferGeometry
  readonly parts: readonly Part[]
  private readonly rest: Float32Array
  private readonly pos: BufferAttribute
  private readonly col: BufferAttribute
  private touched = false
  private paintedColors = false
  /** The last pose of each part, to skip an unchanged one: tx, ty, tz, sx, sy, sz, shear, spin. */
  private readonly last: Float32Array

  constructor(geometry: BufferGeometry, parts: readonly Part[]) {
    this.geometry = geometry
    this.parts = parts
    this.pos = geometry.getAttribute('position') as BufferAttribute
    this.col = geometry.getAttribute('color') as BufferAttribute
    this.pos.setUsage(DynamicDrawUsage)
    this.col.setUsage(DynamicDrawUsage)
    this.rest = new Float32Array(this.pos.array as Float32Array)
    this.last = new Float32Array(parts.length * 8).fill(Number.NaN)
    // the poses move parts around inside the room: a fixed bounding sphere that holds the whole diagnostics area keeps the frustum culling valid
    geometry.boundingSphere = new Sphere(new Vector3(-25, 1.2, 7), 7)
  }

  indexOf(part: Part): number {
    return this.parts.indexOf(part)
  }

  /**
   * Put a part at `rest * scale (about its pivot) + shear + translation`, then spin it about the vertical axis through its (translated) pivot.
   * `shear` moves x by `shear` metres per metre of height above the pivot (a tube rocking). `spin` is in radians.
   */
  pose(i: number, tx: number, ty: number, tz: number, sx = 1, sy = 1, sz = 1, shear = 0, spin = 0): void {
    const l = this.last
    const o = i * 8
    if (
      Math.abs(tx - l[o]) <= EPS &&
      Math.abs(ty - l[o + 1]) <= EPS &&
      Math.abs(tz - l[o + 2]) <= EPS &&
      Math.abs(sx - l[o + 3]) <= EPS &&
      Math.abs(sy - l[o + 4]) <= EPS &&
      Math.abs(sz - l[o + 5]) <= EPS &&
      Math.abs(shear - l[o + 6]) <= EPS &&
      Math.abs(spin - l[o + 7]) <= EPS
    ) {
      return
    }
    l[o] = tx
    l[o + 1] = ty
    l[o + 2] = tz
    l[o + 3] = sx
    l[o + 4] = sy
    l[o + 5] = sz
    l[o + 6] = shear
    l[o + 7] = spin
    const p = this.parts[i]
    const a = this.pos.array as Float32Array
    const r = this.rest
    const c = spin === 0 ? 1 : Math.cos(spin)
    const s = spin === 0 ? 0 : Math.sin(spin)
    for (let v = p.start, e = p.start + p.count; v < e; v++) {
      const k = v * 3
      const dx = r[k] - p.px
      const dy = r[k + 1] - p.py
      const dz = r[k + 2] - p.pz
      const x = dx * sx + shear * dy
      const z = dz * sz
      // spin about the vertical axis through the pivot, then move the pivot by t
      a[k] = p.px + tx + (spin === 0 ? x : x * c + z * s)
      a[k + 1] = p.py + ty + dy * sy
      a[k + 2] = p.pz + tz + (spin === 0 ? z : -x * s + z * c)
    }
    this.touched = true
  }

  /** Paint a whole part one colour (linear RGB, as three stores vertex colours). */
  paint(i: number, r: number, g: number, b: number): void {
    const p = this.parts[i]
    const a = this.col.array as Float32Array
    for (let v = p.start, e = p.start + p.count; v < e; v++) {
      a[v * 3] = r
      a[v * 3 + 1] = g
      a[v * 3 + 2] = b
    }
    this.paintedColors = true
  }

  /** Flag the buffers that changed this frame for upload (once, after all the poses). */
  commit(): void {
    if (this.touched) {
      this.pos.needsUpdate = true
      this.touched = false
    }
    if (this.paintedColors) {
      this.col.needsUpdate = true
      this.paintedColors = false
    }
  }

  /** The rest position of a part's pivot-relative first vertex, for tests. */
  restPositions(): Float32Array {
    return this.rest
  }
}
