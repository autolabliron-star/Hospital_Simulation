import { BackSide, InstancedMesh, Mesh, MeshBasicMaterial, type Material } from 'three'
import { describe, expect, it } from 'vitest'
import { HOSPITAL_ENV_MATCH } from '../look'
import { HOSPITAL_ENV, buildHospitalEnvironment, ceilingMeanRadiance, disposeEnvironment } from './hospitalEnvironment'

type V = [number, number, number]
interface Box {
  min: V
  max: V
  radiance?: number
  inside?: boolean
}

/** Ray against an axis-aligned box from the origin: the exit point for the room (`inside`), the entry for the others. */
function rayBox(d: V, b: Box): { t: number; face: number } | null {
  let tmin = -Infinity
  let tmax = Infinity
  let faceMin = -1
  let faceMax = -1
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (0 < b.min[i] || 0 > b.max[i]) return null
      continue
    }
    let t1 = b.min[i] / d[i]
    let t2 = b.max[i] / d[i]
    let f1 = i * 2 + 1 // the face at min is the -axis face (BoxGeometry order +x -x +y -y +z -z: index 2i is +, 2i+1 is -)
    let f2 = i * 2
    if (t1 > t2) {
      ;[t1, t2] = [t2, t1]
      ;[f1, f2] = [f2, f1]
    }
    if (t1 > tmin) {
      tmin = t1
      faceMin = f1
    }
    if (t2 < tmax) {
      tmax = t2
      faceMax = f2
    }
    if (tmin > tmax) return null
  }
  if (b.inside) return tmax > 0 ? { t: tmax, face: faceMax } : null
  return tmin > 1e-6 ? { t: tmin, face: faceMin } : null
}

/** The irradiance a surface facing `normal` gets from the environment seen from the origin: pi times the mean radiance over cosine-weighted directions. */
function irradiance(normal: V, samples = 6000): number {
  const e = HOSPITAL_ENV
  const room: Box = { min: [-e.size.x / 2, -e.eye, -e.size.z / 2], max: [e.size.x / 2, -e.eye + e.size.y, e.size.z / 2], inside: true }
  const emitters: Box[] = []
  const y = -e.eye + e.size.y - 0.02
  for (let r = 0; r < e.panel.rows; r++) {
    for (let c = 0; c < e.panel.columns; c++) {
      const cx = (c - (e.panel.columns - 1) / 2) * e.panel.pitch
      const cz = (r - (e.panel.rows - 1) / 2) * e.panel.pitch
      emitters.push({ min: [cx - e.panel.w / 2, y - 0.02, cz - e.panel.d / 2], max: [cx + e.panel.w / 2, y + 0.02, cz + e.panel.d / 2], radiance: e.panel.radiance[1] })
    }
  }
  emitters.push({
    min: [-2 - e.daylight.width / 2, -e.eye + e.daylight.y0, e.size.z / 2 - 0.05],
    max: [-2 + e.daylight.width / 2, -e.eye + e.daylight.y1, e.size.z / 2 - 0.01],
    radiance: e.daylight.radiance[1],
  })
  const up: V = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const tx: V = [normal[1] * up[2] - normal[2] * up[1], normal[2] * up[0] - normal[0] * up[2], normal[0] * up[1] - normal[1] * up[0]]
  const tl = Math.hypot(...tx)
  tx[0] /= tl
  tx[1] /= tl
  tx[2] /= tl
  const ty: V = [normal[1] * tx[2] - normal[2] * tx[1], normal[2] * tx[0] - normal[0] * tx[2], normal[0] * tx[1] - normal[1] * tx[0]]
  let sum = 0
  for (let i = 0; i < samples; i++) {
    const u = (i + 0.5) / samples
    const v = (i * 0.6180339887) % 1
    const r = Math.sqrt(u)
    const phi = 2 * Math.PI * v
    const px = r * Math.cos(phi)
    const py = r * Math.sin(phi)
    const pz = Math.sqrt(Math.max(0, 1 - u))
    const d: V = [tx[0] * px + ty[0] * py + normal[0] * pz, tx[1] * px + ty[1] * py + normal[1] * pz, tx[2] * px + ty[2] * py + normal[2] * pz]
    let best = Infinity
    let value = 0
    for (const b of emitters) {
      const h = rayBox(d, b)
      if (h && h.t < best) {
        best = h.t
        value = b.radiance ?? 0
      }
    }
    const wall = rayBox(d, room)
    if (wall && wall.t < best) value = e.faces[wall.face][1]
    sum += value
  }
  return Math.PI * (sum / samples)
}

describe('the hospital environment', () => {
  it('is a room with six faces, a grid of 24 panels under the ceiling and a strip of daylight, all unlit', () => {
    const scene = buildHospitalEnvironment()
    const room = scene.getObjectByName('env-room') as Mesh
    const panels = scene.getObjectByName('env-panels') as InstancedMesh
    const strip = scene.getObjectByName('env-daylight') as Mesh
    expect(room).toBeDefined()
    expect(Array.isArray(room.material)).toBe(true)
    expect((room.material as Material[]).length).toBe(6)
    for (const m of room.material as MeshBasicMaterial[]) {
      expect(m.isMeshBasicMaterial).toBe(true)
      expect(m.side).toBe(BackSide)
      expect(m.toneMapped).toBe(false)
    }
    expect(panels.count).toBe(HOSPITAL_ENV.panel.columns * HOSPITAL_ENV.panel.rows)
    expect(strip).toBeDefined()
    // the panels are much brighter than anything else in the room (that is what a lit panel is), the daylight strip brighter than the walls
    const maxFace = Math.max(...HOSPITAL_ENV.faces.flat())
    expect(Math.min(...HOSPITAL_ENV.panel.radiance)).toBeGreaterThan(maxFace * 5)
    expect(Math.min(...HOSPITAL_ENV.daylight.radiance)).toBeGreaterThan(maxFace)
    // warm white walls and ceiling (red above blue), a cool daylight strip (blue above red)
    for (const f of HOSPITAL_ENV.faces.slice(0, 4)) expect(f[0]).toBeGreaterThan(f[2])
    expect(HOSPITAL_ENV.daylight.radiance[2]).toBeGreaterThan(HOSPITAL_ENV.daylight.radiance[0])
    expect(HOSPITAL_ENV.panel.radiance[0]).toBeGreaterThan(HOSPITAL_ENV.panel.radiance[2])
    disposeEnvironment(scene)
  })

  it('has the ceiling the viewer sees overhead: closer than the walls, panels on the 3 m pitch the ceiling texture uses', () => {
    expect(HOSPITAL_ENV.size.y - HOSPITAL_ENV.eye).toBeLessThan(2)
    expect(HOSPITAL_ENV.eye).toBeGreaterThan(1.2)
    expect(HOSPITAL_ENV.panel.pitch).toBe(3)
    const mean = ceilingMeanRadiance()
    expect(mean[0]).toBeGreaterThan(HOSPITAL_ENV.faces[2][0])
    expect(mean[0]).toBeGreaterThan(1)
  })

  it('lights a surface about as much as RoomEnvironment does, which is what HOSPITAL_ENV_MATCH = 1 says (measured with the same estimator)', () => {
    // RoomEnvironment, from a cosine-weighted Monte Carlo of its walls (lit by its point light) and its six emissive panels: up 5.19, mean 3.18
    const ROOM_UP = 5.19
    const ROOM_MEAN = 3.18
    const dirs: V[] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
    const e = dirs.map((n) => irradiance(n))
    const up = e[0]
    const mean = e.reduce((a, b) => a + b, 0) / e.length
    expect(up * HOSPITAL_ENV_MATCH).toBeGreaterThan(ROOM_UP * 0.88)
    expect(up * HOSPITAL_ENV_MATCH).toBeLessThan(ROOM_UP * 1.12)
    expect(mean * HOSPITAL_ENV_MATCH).toBeGreaterThan(ROOM_MEAN * 0.88)
    expect(mean * HOSPITAL_ENV_MATCH).toBeLessThan(ROOM_MEAN * 1.12)
    // a floor sees more than a ceiling-facing-down surface: it is lit from above
    expect(e[0]).toBeGreaterThan(e[1] * 2)
  })

  it('disposes everything it built', () => {
    const scene = buildHospitalEnvironment()
    let disposed = 0
    scene.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.geometry.addEventListener('dispose', () => disposed++)
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.addEventListener('dispose', () => disposed++)
    })
    disposeEnvironment(scene)
    expect(disposed).toBeGreaterThanOrEqual(8) // three geometries, six face materials, the panel and strip materials
  })
})
