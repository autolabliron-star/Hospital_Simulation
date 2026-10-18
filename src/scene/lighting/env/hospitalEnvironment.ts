/**
 * The hospital environment (W3): what a shiny thing in a hospital corridor reflects, and the soft light a wall picks up from the room around
 * it. A small box room built the way three's RoomEnvironment is (a scene the PMREM generator looks at once from the middle), but made of the
 * things this building has: a ceiling of warm-white tiles with a grid of bright light panels, warm white walls, a pale floor, and a cool
 * strip of daylight along one glass side. No HDRI file: nothing to download, the demo runs offline.
 *
 * It is rendered ONCE into a 256 PMREM, the same size as RoomEnvironment's, so the lit materials' programs do not change when the scene's
 * environment is swapped (the same cube-UV layout and height). The overview keeps RoomEnvironment; Lighting.tsx swaps `scene.environment`
 * when the daylight driver says the indoor blend has crossed half way (during the Tab flight), the driver having already written the
 * intensity for the environment that is bound.
 *
 * The materials here are unlit (MeshBasicMaterial) with a colour that IS the radiance in that direction, as the PMREM wants it: the panels
 * are far above 1. They are only ever drawn into the PMREM, once, offscreen (manifest.ts says `offline`).
 *
 * The room is 24 m x 3.2 m x 10 m and the middle of the PMREM (the viewer) stands 1.5 m above its floor, like a person in a hall; the
 * panels match the ceiling's own 3 m pitch, so what the floors reflect and what the walls see overhead agree.
 */
import { BackSide, BoxGeometry, Color, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Scene, type Material } from 'three'

/** Radiance, linear (what the environment holds): the numbers that make the room. */
export const HOSPITAL_ENV = {
  /** Room extents (m), and where the viewer's eye is above the floor. */
  size: { x: 24, y: 3.2, z: 10 },
  eye: 1.5,
  /** Face radiances in BoxGeometry's order: +x, -x, +y (ceiling), -y (floor), +z (the glass side's wall), -z. */
  faces: [
    [0.6, 0.58, 0.53],
    [0.6, 0.58, 0.53],
    [0.78, 0.74, 0.68],
    [0.42, 0.4, 0.36],
    [0.55, 0.56, 0.55],
    [0.62, 0.6, 0.55],
  ],
  /** The light panels: size (m), pitch (m), radiance (they are far above 1: that is what a lit panel is next to a wall). */
  panel: { w: 1.8, d: 0.6, pitch: 3, columns: 8, rows: 3, radiance: [9, 8.4, 7.4] },
  /** The strip of daylight along the +z wall: height range above the floor (m), width (m) and radiance. */
  daylight: { y0: 0.5, y1: 2.7, width: 14, radiance: [1.7, 1.95, 2.3] },
} as const

/** One unlit material of a given radiance. The only place this file builds a material. */
function flat(radiance: readonly number[], side: 'front' | 'back'): MeshBasicMaterial {
  const m = new MeshBasicMaterial()
  m.color = new Color().setRGB(radiance[0], radiance[1], radiance[2])
  m.toneMapped = false
  if (side === 'back') m.side = BackSide
  return m
}

/** The scene the PMREM generator looks at from the origin. Build it, hand it to `fromScene`, then `disposeEnvironment` it. */
export function buildHospitalEnvironment(): Scene {
  const e = HOSPITAL_ENV
  const scene = new Scene()
  scene.name = 'HospitalEnvironment'
  // the viewer is at the origin: the room's middle is raised so the floor is `eye` below the origin
  const cy = -e.eye + e.size.y / 2
  const geometry = new BoxGeometry()
  geometry.deleteAttribute('uv')

  const room = new Mesh(geometry, e.faces.map((f) => flat(f, 'back')))
  room.name = 'env-room'
  room.position.set(0, cy, 0)
  room.scale.set(e.size.x, e.size.y, e.size.z)
  scene.add(room)

  // the light panels: a flat box under the ceiling on the ceiling's 3 m grid
  const p = e.panel
  const panelGeometry = new BoxGeometry(p.w, 0.04, p.d)
  const panels = new InstancedMesh(panelGeometry, flat(p.radiance, 'front'), p.columns * p.rows)
  panels.name = 'env-panels'
  const t = new Object3D()
  const ceiling = -e.eye + e.size.y - 0.02
  let n = 0
  for (let r = 0; r < p.rows; r++) {
    for (let c = 0; c < p.columns; c++) {
      t.position.set((c - (p.columns - 1) / 2) * p.pitch, ceiling, (r - (p.rows - 1) / 2) * p.pitch)
      t.updateMatrix()
      panels.setMatrixAt(n++, t.matrix)
    }
  }
  scene.add(panels)

  // the strip of daylight: a thin emissive plate just in front of the +z wall
  const d = e.daylight
  const strip = new Mesh(new BoxGeometry(d.width, d.y1 - d.y0, 0.04), flat(d.radiance, 'front'))
  strip.name = 'env-daylight'
  strip.position.set(-2, -e.eye + (d.y0 + d.y1) / 2, e.size.z / 2 - 0.03)
  scene.add(strip)
  return scene
}

/** Free the geometries and materials of a scene `buildHospitalEnvironment` made (after the PMREM has been rendered from it). */
export function disposeEnvironment(scene: Scene): void {
  const resources = new Set<{ dispose(): void }>()
  scene.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    resources.add(mesh.geometry)
    const m = mesh.material as Material | Material[]
    for (const mat of Array.isArray(m) ? m : [m]) resources.add(mat)
  })
  for (const r of resources) r.dispose()
}

/**
 * A rough figure for tests and for tuning HOSPITAL_ENV_MATCH: the cosine-weighted irradiance an upward-facing point in the middle of the room
 * would see, assuming the ceiling fills the upper hemisphere (it does, to within the walls' low rim): pi times the ceiling's mean radiance.
 */
export function ceilingMeanRadiance(): [number, number, number] {
  const e = HOSPITAL_ENV
  const panelArea = e.panel.w * e.panel.d * e.panel.columns * e.panel.rows
  const ceilingArea = e.size.x * e.size.z
  const share = panelArea / ceilingArea
  return [0, 1, 2].map((i) => e.faces[2][i] * (1 - share) + e.panel.radiance[i] * share) as [number, number, number]
}
