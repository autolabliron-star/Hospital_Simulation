/**
 * A tiny indexed-mesh builder for the rail geometry (positions and normals only; the rail materials need no UVs).
 * Every triangle is wound to face the way its vertex normals point, so a face can never come out inside-out whatever
 * order its corners are given in (the node test checks it for every triangle).
 */
import { BufferGeometry, Float32BufferAttribute } from 'three'

export class MeshBuilder {
  private readonly pos: number[] = []
  private readonly nrm: number[] = []
  private readonly idx: number[] = []

  get vertexCount(): number {
    return this.pos.length / 3
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.pos.push(x, y, z)
    this.nrm.push(nx, ny, nz)
    return this.vertexCount - 1
  }

  /** A triangle, wound so its geometric normal agrees with the sum of its vertex normals. */
  tri(a: number, b: number, c: number): void {
    const p = this.pos
    const n = this.nrm
    const ux = p[b * 3] - p[a * 3]
    const uy = p[b * 3 + 1] - p[a * 3 + 1]
    const uz = p[b * 3 + 2] - p[a * 3 + 2]
    const vx = p[c * 3] - p[a * 3]
    const vy = p[c * 3 + 1] - p[a * 3 + 1]
    const vz = p[c * 3 + 2] - p[a * 3 + 2]
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    const nx = n[a * 3] + n[b * 3] + n[c * 3]
    const ny = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1]
    const nz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]
    if (cx * nx + cy * ny + cz * nz < 0) this.idx.push(a, c, b)
    else this.idx.push(a, b, c)
  }

  /** A quad given its four corners in order round the edge. */
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c)
    this.tri(a, c, d)
  }

  /**
   * An axis-aligned-in-its-own-frame box: centred on (cx, cz) in plan, turned to `heading` (0 faces +z), `halfAcross`
   * either side of the centre line and `halfAlong` either way along it, from y0 up to y1. Six flat-shaded faces.
   */
  box(cx: number, cz: number, heading: number, halfAcross: number, halfAlong: number, y0: number, y1: number): void {
    const fx = Math.sin(heading)
    const fz = Math.cos(heading)
    const rx = Math.cos(heading)
    const rz = -Math.sin(heading)
    const corner = (a: number, f: number, y: number): [number, number, number] => [cx + rx * a * halfAcross + fx * f * halfAlong, y, cz + rz * a * halfAcross + fz * f * halfAlong]
    // [across sign, along sign] of the four plan corners in order round the box
    const ring: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    const face = (pts: [number, number, number][], nx: number, ny: number, nz: number): void => {
      const v = pts.map((q) => this.vertex(q[0], q[1], q[2], nx, ny, nz))
      this.quad(v[0], v[1], v[2], v[3])
    }
    face(ring.map(([a, f]) => corner(a, f, y0)), 0, -1, 0)
    face(ring.map(([a, f]) => corner(a, f, y1)), 0, 1, 0)
    for (let i = 0; i < 4; i++) {
      const [a0, f0] = ring[i]
      const [a1, f1] = ring[(i + 1) % 4]
      // outward normal of the side between two neighbouring corners, in plan
      const mx = (a0 + a1) / 2
      const mf = (f0 + f1) / 2
      face([corner(a0, f0, y0), corner(a1, f1, y0), corner(a1, f1, y1), corner(a0, f0, y1)], rx * mx + fx * mf, 0, rz * mx + fz * mf)
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3))
    g.setIndex(this.idx)
    return g
  }
}
