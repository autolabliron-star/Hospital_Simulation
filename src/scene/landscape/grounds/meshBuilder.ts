/**
 * A tiny, pure triangle-soup builder for the exterior (no three.js, no React, no randomness): flat-shaded, vertex-coloured, non-indexed.
 * Every face is wound so its normal points the way the caller says it faces (`face` flips a triangle that disagrees with its hint), so a
 * mistake in the order of corners can never turn a face inside out.
 *
 * Colours are written as scene-LINEAR floats (the same numbers three's `Color.set('#rrggbb')` stores), so the renderer can hand the
 * arrays to a `vertexColors` material as they are.
 *
 * Axes follow the sim: x east, z south, y up. A rotation `ry` is about y with three's sign (x' = x cos + z sin, z' = -x sin + z cos).
 */

export type Rgb = readonly [number, number, number]

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

/** '#rrggbb' (sRGB) to scene-linear floats. */
export function hex(color: string): Rgb {
  const v = parseInt(color.slice(1), 16)
  return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)]
}

/** Linear mix of two linear colours. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Scale a linear colour (a value below 1 darkens, above 1 lightens). */
export function scaleRgb(a: Rgb, k: number): Rgb {
  return [a[0] * k, a[1] * k, a[2] * k]
}

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
}

/** A solid thing people could bump into, for the keep-clear tests: its footprint (axis-aligned bounds) and its top. */
export interface SolidBox {
  id: string
  x0: number
  x1: number
  z0: number
  z1: number
  y1: number
}

export interface BoxOpts {
  /** Rotation about y around the box centre. */
  ry?: number
  /** Colour of the top face (default: the box colour). */
  top?: Rgb
  /** Draw the bottom face (default false: nothing sees it). */
  bottom?: boolean
}

type V3 = readonly [number, number, number]

export class MeshBuilder {
  private readonly p: number[] = []
  private readonly n: number[] = []
  private readonly c: number[] = []

  get triangleCount(): number {
    return this.p.length / 9
  }

  /** One triangle, wound to face `hint` (any vector on its front side). */
  face(a: V3, b: V3, c: V3, color: Rgb, hint: V3): void {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-12) return // degenerate: nothing to draw
    nx /= len
    ny /= len
    nz /= len
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0
    const q = flip ? c : b
    const r = flip ? b : c
    if (flip) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    this.p.push(a[0], a[1], a[2], q[0], q[1], q[2], r[0], r[1], r[2])
    for (let i = 0; i < 3; i++) {
      this.n.push(nx, ny, nz)
      this.c.push(color[0], color[1], color[2])
    }
  }

  /** A planar quad (a, b, c, d in order around it), as two triangles facing `hint`. */
  quad(a: V3, b: V3, c: V3, d: V3, color: Rgb, hint: V3): void {
    this.face(a, b, c, color, hint)
    this.face(a, c, d, color, hint)
  }

  /** A flat rectangle facing up at height y. */
  flat(x0: number, x1: number, z0: number, z1: number, y: number, color: Rgb): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], color, [0, 1, 0])
  }

  /** A flat convex polygon (x, z points in order) facing up at height y. */
  flatPoly(points: readonly (readonly [number, number])[], y: number, color: Rgb): void {
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[0]!
      const b = points[i]!
      const c = points[i + 1]!
      this.face([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], color, [0, 1, 0])
    }
  }

  /** A flat rectangle of length `len` (along the heading) and width `w`, centred at (cx, cz), heading `ry`, facing up. */
  flatRot(cx: number, cz: number, len: number, w: number, ry: number, y: number, color: Rgb): void {
    const cs = Math.cos(ry)
    const sn = Math.sin(ry)
    const pt = (lx: number, lz: number): V3 => [cx + lx * cs + lz * sn, y, cz - lx * sn + lz * cs]
    const hl = len / 2
    const hw = w / 2
    this.quad(pt(-hl, -hw), pt(-hl, hw), pt(hl, hw), pt(hl, -hw), color, [0, 1, 0])
  }

  /** An axis-aligned box between (x0, y0, z0) and (x1, y1, z1), optionally rotated about its own centre. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: Rgb, o: BoxOpts = {}): void {
    const cx = (x0 + x1) / 2
    const cz = (z0 + z1) / 2
    const cs = Math.cos(o.ry ?? 0)
    const sn = Math.sin(o.ry ?? 0)
    const pt = (x: number, y: number, z: number): V3 => {
      const lx = x - cx
      const lz = z - cz
      return [cx + lx * cs + lz * sn, y, cz - lx * sn + lz * cs]
    }
    const rot = (nx: number, nz: number): V3 => [nx * cs + nz * sn, 0, -nx * sn + nz * cs]
    const top = o.top ?? color
    const A = pt(x0, y1, z0)
    const B = pt(x1, y1, z0)
    const C = pt(x1, y1, z1)
    const D = pt(x0, y1, z1)
    const E = pt(x0, y0, z0)
    const F = pt(x1, y0, z0)
    const G = pt(x1, y0, z1)
    const H = pt(x0, y0, z1)
    this.quad(A, D, C, B, top, [0, 1, 0])
    if (o.bottom) this.quad(E, F, G, H, color, [0, -1, 0])
    this.quad(E, F, B, A, color, rot(0, -1)) // north (-z)
    this.quad(H, G, C, D, color, rot(0, 1)) // south (+z)
    this.quad(E, H, D, A, color, rot(-1, 0)) // west (-x)
    this.quad(F, G, C, B, color, rot(1, 0)) // east (+x)
  }

  /** A vertical rectangle from (ax, az) to (bx, bz) between heights y0 and y1, facing (hx, hz). */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, color: Rgb, hx: number, hz: number): void {
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], color, [hx, 0, hz])
  }

  /** A box by centre and size, rotated about its centre. `y` is the BOTTOM. */
  boxC(cx: number, y: number, cz: number, w: number, h: number, d: number, color: Rgb, o: BoxOpts = {}): void {
    this.box(cx - w / 2, y, cz - d / 2, cx + w / 2, y + h, cz + d / 2, color, o)
  }

  /** A vertical prism with `sides` flat sides (a post, a pole, a trunk), open at the bottom, capped on top when `cap`. */
  prism(cx: number, y0: number, cz: number, r: number, h: number, sides: number, color: Rgb, cap = true, rTop = r): void {
    const y1 = y0 + h
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2
      const a1 = ((i + 1) / sides) * Math.PI * 2
      const am = (a0 + a1) / 2
      const b0: V3 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r]
      const b1: V3 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r]
      const t0: V3 = [cx + Math.cos(a0) * rTop, y1, cz + Math.sin(a0) * rTop]
      const t1: V3 = [cx + Math.cos(a1) * rTop, y1, cz + Math.sin(a1) * rTop]
      this.quad(b0, b1, t1, t0, color, [Math.cos(am), 0, Math.sin(am)])
      if (cap) this.face([cx, y1, cz], t0, t1, color, [0, 1, 0])
    }
  }

  /**
   * A low-poly blob: an icosphere (detail 0 = 20 faces, 1 = 80) scaled to radii (rx, ry, rz) at a centre, with every vertex pushed in or out
   * by up to `jitter` (a fraction of its radius) through `rand`, so a tree reads as foliage rather than a ball.
   */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, detail: 0 | 1, color: Rgb, rand: () => number, jitter = 0.12): void {
    const t = (1 + Math.sqrt(5)) / 2
    const raw: V3[] = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ] // prettier-ignore
    const norm = (v: V3): V3 => {
      const l = Math.hypot(v[0], v[1], v[2])
      return [v[0] / l, v[1] / l, v[2] / l]
    }
    let verts = raw.map(norm)
    let tris: [number, number, number][] = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ] // prettier-ignore
    if (detail === 1) {
      const mid = new Map<string, number>()
      const midpoint = (a: number, b: number): number => {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`
        const got = mid.get(k)
        if (got !== undefined) return got
        const va = verts[a]!
        const vb = verts[b]!
        verts = [...verts, norm([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2])]
        mid.set(k, verts.length - 1)
        return verts.length - 1
      }
      const next: [number, number, number][] = []
      for (const [a, b, c] of tris) {
        const ab = midpoint(a, b)
        const bc = midpoint(b, c)
        const ca = midpoint(c, a)
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
      }
      tris = next
    }
    // one displacement per vertex (shared by every face that uses it, so the surface stays closed)
    const moved: V3[] = verts.map((v) => {
      const k = 1 + (rand() * 2 - 1) * jitter
      return [cx + v[0] * rx * k, cy + v[1] * ry * k, cz + v[2] * rz * k]
    })
    for (const [a, b, c] of tris) {
      const va = verts[a]!
      const vb = verts[b]!
      const vc = verts[c]!
      this.face(moved[a]!, moved[b]!, moved[c]!, color, [va[0] + vb[0] + vc[0], va[1] + vb[1] + vc[1], va[2] + vb[2] + vc[2]])
    }
  }

  /** A truncated pyramid (a car's cabin): a rectangle (w0 x d0) at y0 narrowing to (w1 x d1) at y1, centred on (cx, cz); no bottom. */
  frustum(cx: number, y0: number, cz: number, w0: number, d0: number, y1: number, w1: number, d1: number, side: Rgb, top: Rgb): void {
    const lo = (sx: number, sz: number): V3 => [cx + (sx * w0) / 2, y0, cz + (sz * d0) / 2]
    const hi = (sx: number, sz: number): V3 => [cx + (sx * w1) / 2, y1, cz + (sz * d1) / 2]
    this.quad(hi(-1, -1), hi(-1, 1), hi(1, 1), hi(1, -1), top, [0, 1, 0])
    this.quad(lo(-1, -1), lo(1, -1), hi(1, -1), hi(-1, -1), side, [0, 0.4, -1])
    this.quad(lo(-1, 1), lo(1, 1), hi(1, 1), hi(-1, 1), side, [0, 0.4, 1])
    this.quad(lo(-1, -1), lo(-1, 1), hi(-1, 1), hi(-1, -1), side, [-1, 0.4, 0])
    this.quad(lo(1, -1), lo(1, 1), hi(1, 1), hi(1, -1), side, [1, 0.4, 0])
  }

  /** Append another builder's triangles (already in world space). */
  append(other: MeshBuilder): void {
    for (const v of other.p) this.p.push(v)
    for (const v of other.n) this.n.push(v)
    for (const v of other.c) this.c.push(v)
  }

  build(): MeshData {
    return { positions: Float32Array.from(this.p), normals: Float32Array.from(this.n), colors: Float32Array.from(this.c) }
  }
}

/** Triangles in a mesh. */
export const trianglesOf = (m: MeshData): number => m.positions.length / 9
