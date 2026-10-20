/**
 * R3 live patient monitors: the three.js side. ONE `DataTexture` atlas (2048 x 1848, flipY false, sRGB, mipmapped: about 19 MB on the GPU; the pump
 * copies painted rectangles into it, nothing is uploaded per frame) and, per level, ONE merged mesh of every monitor face on that level, on a
 * material built exactly like the live
 * strip's (`MeshBasicMaterial({ map, toneMapped: false, vertexColors: true })`, a colour attribute of item size 3, a normal attribute like its
 * PlaneGeometry quads, no `onBeforeCompile`), so it shares that shader program: +1 draw call per shown level and no new program.
 *
 * Every frame `write` moves the quads: a static per quad over its painted region (or the standby face while its row is empty), and three quads per
 * band following the sweep (sweep.ts). Positions and UVs only; allocation-free.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three'
import type { LevelId } from '@/sim/levels'
import { faceFrame, faceNormal, type FaceFrame } from './anchors'
import type { AtlasPlan, Region } from './atlas'
import type { MonitorHub, MonitorState } from './hub'
import { GAP, SWEEP } from './layouts'
import { bandQuads, entryOf, Q, sweepAt, type SweepAt } from './sweep'

/** The atlas texture: black until the pump paints into it. Upload it once at mount (`renderer.initTexture`). */
export function createAtlasTexture(plan: Pick<AtlasPlan, 'width' | 'height'>): DataTexture {
  const tex = new DataTexture(new Uint8Array(plan.width * plan.height * 4), plan.width, plan.height, RGBAFormat, UnsignedByteType)
  tex.colorSpace = SRGBColorSpace
  tex.flipY = false
  tex.generateMipmaps = true
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  tex.anisotropy = 4
  tex.name = 'patient-monitors-atlas'
  tex.needsUpdate = true
  return tex
}

/** The faces' material: the live strip's settings exactly (so the program is shared). Single sided: the back of a monitor stays dark. */
export function createMonitorMaterial(map: Texture): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ map, toneMapped: false, vertexColors: true })
  m.name = 'patient-monitors'
  return m
}

/** Quads a monitor needs: one per static, three per band. */
export function quadsOf(m: Pick<MonitorState, 'layout'>): number {
  return m.layout.statics.length + 3 * m.layout.bands.length
}

/** The merged mesh of one level's monitor faces. */
export class LevelMonitors {
  readonly geometry: BufferGeometry
  readonly mesh: Mesh
  readonly monitors: MonitorState[]
  readonly quads: number
  private readonly pos: Float32Array
  private readonly uv: Float32Array
  private readonly frames: FaceFrame[]
  private readonly aw: number
  private readonly ah: number
  private readonly q = new Float32Array(9)
  private readonly sw: SweepAt = { k: 0, c: 0 }

  constructor(
    readonly level: LevelId,
    hub: Pick<MonitorHub, 'monitors' | 'plan'>,
    material: MeshBasicMaterial,
  ) {
    this.monitors = hub.monitors.filter((m) => m.def.level === level)
    this.quads = this.monitors.reduce((n, m) => n + quadsOf(m), 0)
    this.aw = hub.plan.width
    this.ah = hub.plan.height
    this.frames = this.monitors.map((m) => faceFrame(m.def.anchor, m.layout.w, m.layout.h))
    const v = this.quads * 4
    this.pos = new Float32Array(v * 3)
    this.uv = new Float32Array(v * 2)
    const colour = new Float32Array(v * 3).fill(1)
    // every vertex of a face has that face's normal: the live strip's quads are PlaneGeometry and carry normals, and three keys the program on
    // whether a geometry has them (`vertexNormals`), so the faces must have them too to share the program
    const normal = new Float32Array(v * 3)
    let nv = 0
    for (const m of this.monitors) {
      const n = faceNormal(m.def.anchor)
      for (let k = 0; k < quadsOf(m) * 4; k++, nv++) {
        normal[nv * 3] = n.x
        normal[nv * 3 + 1] = n.y
        normal[nv * 3 + 2] = n.z
      }
    }
    const index = new Uint16Array(this.quads * 6)
    for (let i = 0; i < this.quads; i++) {
      const a = i * 4
      index.set([a, a + 1, a + 2, a, a + 2, a + 3], i * 6)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage))
    g.setAttribute('uv', new BufferAttribute(this.uv, 2).setUsage(DynamicDrawUsage))
    g.setAttribute('normal', new BufferAttribute(normal, 3))
    g.setAttribute('color', new BufferAttribute(colour, 3))
    g.setIndex(new BufferAttribute(index, 1))
    this.geometry = g
    // every quad stays inside its face, so the faces' bounds are the mesh's bounds for good
    this.write(0, hub.plan)
    g.computeBoundingSphere()
    g.computeBoundingBox()
    this.mesh = new Mesh(g, material)
    this.mesh.name = `patient-monitors-level-${level}`
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
  }

  /** Write every quad for display time `t`. Allocation-free. */
  write(t: number, plan: Pick<AtlasPlan, 'idle'>): void {
    let qi = 0
    const q = this.q
    for (let mi = 0; mi < this.monitors.length; mi++) {
      const m = this.monitors[mi]
      const f = this.frames[mi]
      const layout = m.layout
      const idle = plan.idle[layout.id]
      for (let si = 0; si < layout.statics.length; si++) {
        const s = layout.statics[si]
        const live = s.row < 0 ? m.ownLive : m.rows[s.row].live
        if (live) {
          const r = m.regions.statics[si]
          this.put(qi++, f, s.x, s.y, s.x + s.w, s.y + s.h, r.x, r.y, r.x + r.w, r.y + r.h)
        } else {
          this.put(qi++, f, s.x, s.y, s.x + s.w, s.y + s.h, idle.x + s.x, idle.y + s.y, idle.x + s.x + s.w, idle.y + s.y + s.h)
        }
      }
      for (let bi = 0; bi < layout.bands.length; bi++) {
        const b = layout.bands[bi]
        sweepAt(t, m.phase, SWEEP[b.speed], b.w, this.sw)
        bandQuads(this.sw.c, b.w, GAP, layout.labelW, q)
        const y0 = b.y
        const y1 = b.y + b.h
        if (m.rows[b.row].live) {
          const reg = m.regions.bands[bi]
          const fresh: Region = reg.entries[entryOf(this.sw.k)]
          const old: Region = reg.entries[entryOf(this.sw.k + 1)]
          this.band(qi++, f, b.x, y0, y1, q[Q.newX0], q[Q.newX1], fresh, q[Q.newU0])
          this.band(qi++, f, b.x, y0, y1, q[Q.gapX0], q[Q.gapX1], reg.label, q[Q.gapU0])
          this.band(qi++, f, b.x, y0, y1, q[Q.oldX0], q[Q.oldX1], old, q[Q.oldU0])
        } else {
          this.idleBand(qi++, f, b.x, y0, y1, q[Q.newX0], q[Q.newX1], idle)
          this.idleBand(qi++, f, b.x, y0, y1, q[Q.gapX0], q[Q.gapX1], idle)
          this.idleBand(qi++, f, b.x, y0, y1, q[Q.oldX0], q[Q.oldX1], idle)
        }
      }
    }
    const g = this.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.uv.needsUpdate = true
  }

  /** A band quad from band x0..x1 (face rows y0..y1), showing region `r` from its column `u0`. */
  private band(qi: number, f: FaceFrame, bx: number, y0: number, y1: number, x0: number, x1: number, r: Region, u0: number): void {
    this.put(qi, f, bx + x0, y0, bx + x1, y1, r.x + u0, r.y, r.x + u0 + (x1 - x0), r.y + r.h)
  }

  /** A band quad of an empty row: the standby face at the same face position. */
  private idleBand(qi: number, f: FaceFrame, bx: number, y0: number, y1: number, x0: number, x1: number, idle: Region): void {
    this.put(qi, f, bx + x0, y0, bx + x1, y1, idle.x + bx + x0, idle.y + y0, idle.x + bx + x1, idle.y + y1)
  }

  /**
   * Quad `qi`: face pixels (fx0, fy0)-(fx1, fy1) showing atlas pixels (ax0, ay0)-(ax1, ay1). Corners top-left, bottom-left, bottom-right, top-right
   * (two counter-clockwise triangles seen from the front). The atlas has flipY false: atlas row y is at v = y / height.
   */
  private put(qi: number, f: FaceFrame, fx0: number, fy0: number, fx1: number, fy1: number, ax0: number, ay0: number, ax1: number, ay1: number): void {
    const p = this.pos
    const t = this.uv
    let k = qi * 12
    // top-left
    p[k] = f.ox + f.rx * fx0 + f.dx * fy0
    p[k + 1] = f.oy + f.ry * fx0 + f.dy * fy0
    p[k + 2] = f.oz + f.rz * fx0 + f.dz * fy0
    // bottom-left
    p[k + 3] = f.ox + f.rx * fx0 + f.dx * fy1
    p[k + 4] = f.oy + f.ry * fx0 + f.dy * fy1
    p[k + 5] = f.oz + f.rz * fx0 + f.dz * fy1
    // bottom-right
    p[k + 6] = f.ox + f.rx * fx1 + f.dx * fy1
    p[k + 7] = f.oy + f.ry * fx1 + f.dy * fy1
    p[k + 8] = f.oz + f.rz * fx1 + f.dz * fy1
    // top-right
    p[k + 9] = f.ox + f.rx * fx1 + f.dx * fy0
    p[k + 10] = f.oy + f.ry * fx1 + f.dy * fy0
    p[k + 11] = f.oz + f.rz * fx1 + f.dz * fy0
    k = qi * 8
    const u0 = ax0 / this.aw
    const u1 = ax1 / this.aw
    const v0 = ay0 / this.ah
    const v1 = ay1 / this.ah
    t[k] = u0
    t[k + 1] = v0
    t[k + 2] = u0
    t[k + 3] = v1
    t[k + 4] = u1
    t[k + 5] = v1
    t[k + 6] = u1
    t[k + 7] = v0
  }

  dispose(): void {
    this.geometry.dispose()
  }
}
