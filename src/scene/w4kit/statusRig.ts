/**
 * The W4 status screens as three.js objects, with no React: ONE canvas atlas (4 x 4 tiles of 320 x 200, the layout of the bedside atlas, so
 * the screens share the bedside material's shader program) and ONE InstancedMesh of 16 quads, one per tile. A quad stays hidden (a zero
 * matrix) until a feature registers its tile in the registry (src/scene/w4kit/tiles.ts); then it sits at the tile's anchor and shows the tile.
 *
 * The rules are the ward rig's (src/scene/meals/ward/wardRig.ts): the registry is looked at 4 Hz, a tile is repainted ONLY when its `version()`
 * moved (or its registration changed), and the canvas is re-uploaded to the GPU at most twice a second. A Jump (a new `generation`) snaps
 * every tile. Nothing is allocated in `step` except by the painters themselves, which run at most 2 Hz and never inside a frame callback of
 * their own: they are called from here, from the 4 Hz check.
 */
import { CanvasTexture, InstancedBufferAttribute, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, type MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace, Group } from 'three'
import { registerDimmable } from '@/scene/daylight/dim'
import { atlasCell, BEDSIDE_ATLAS, createBedsideMaterial } from '@/scene/meals/ward/wardParts'
import { w4Tiles, W4_TILE_COUNT, W4_TILE_PX, type W4Tile } from './tiles'

/** Look for a changed tile version this often (seconds), and upload the canvas at most this often. */
export const STATUS_CHECK = 0.25
export const STATUS_UPLOAD = 0.5

/** The atlas has the bedside atlas's grid, which the shared material's UV maths assumes. */
export const STATUS_ATLAS = { cols: BEDSIDE_ATLAS.cols, rows: BEDSIDE_ATLAS.rows, tileW: W4_TILE_PX.w, tileH: W4_TILE_PX.h } as const

export type TilePainter = W4Tile['paint']

export interface StatusAtlas {
  /** The canvas texture (null for a test double). */
  texture: { needsUpdate: boolean; dispose(): void }
  /** Paint tile `i` with `painter`, or blank it (the dark panel) when `painter` is null. */
  paint(i: number, painter: TilePainter | null): void
}

/** The real atlas (browser only: it makes a canvas). */
export function createStatusAtlas(): (StatusAtlas & { texture: CanvasTexture }) | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = STATUS_ATLAS.tileW * STATUS_ATLAS.cols
  canvas.height = STATUS_ATLAS.tileH * STATUS_ATLAS.rows
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#10282a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = 8
  return {
    texture,
    paint(i, painter) {
      const { col, row } = atlasCell(i)
      ctx.save()
      ctx.translate(col * STATUS_ATLAS.tileW, row * STATUS_ATLAS.tileH)
      ctx.beginPath()
      ctx.rect(0, 0, STATUS_ATLAS.tileW, STATUS_ATLAS.tileH)
      ctx.clip()
      if (painter) painter(ctx, STATUS_ATLAS.tileW, STATUS_ATLAS.tileH)
      else {
        ctx.fillStyle = '#10282a'
        ctx.fillRect(0, 0, STATUS_ATLAS.tileW, STATUS_ATLAS.tileH)
      }
      ctx.restore()
    },
  }
}

/** A unit quad (facing +z) with the atlas cell of each of its 16 instances in `aCell`, which the shared bedside material reads. */
export function statusQuadGeometry(): PlaneGeometry {
  const g = new PlaneGeometry(1, 1)
  const cells = new Float32Array(W4_TILE_COUNT * 2)
  for (let i = 0; i < W4_TILE_COUNT; i++) {
    const c = atlasCell(i)
    cells[i * 2] = c.u
    cells[i * 2 + 1] = c.v
  }
  g.setAttribute('aCell', new InstancedBufferAttribute(cells, 2))
  return g
}

const dummy = new Object3D()
dummy.rotation.order = 'YXZ'

export interface StatusStep {
  /** Changes when the hospital is rebuilt (a Jump): every tile snaps (repaints from scratch). */
  generation: number
  /** Real clock seconds (for the 4 Hz check and the 2 Hz upload). */
  now: number
}

export interface StatusStats {
  /** How many tile paints happened, how many uploads, and how many registry checks. */
  paints: number
  uploads: number
  checks: number
}

export interface StatusRig {
  group: Group
  mesh: InstancedMesh
  material: MeshBasicMaterial
  stats: StatusStats
  /** Which tiles are shown (registered and placed), for tests and the probe. */
  shown(): number[]
  step(s: StatusStep): void
  /** Register with the night dimming (idempotent); `dispose` unregisters, so a remount calls it again. */
  attach(): void
  dispose(): void
}

export interface StatusOptions {
  /** A test double for the canvas atlas (or null to run without one). Default: the real atlas. */
  atlas?: StatusAtlas | null
  /** Where the tiles come from. Default: the W4 tile registry. */
  tiles?: () => ReadonlyMap<number, W4Tile>
}

export function createStatusRig(opts: StatusOptions = {}): StatusRig {
  const real = opts.atlas === undefined ? createStatusAtlas() : null
  const atlas: StatusAtlas | null = opts.atlas === undefined ? real : opts.atlas
  const tiles = opts.tiles ?? w4Tiles
  const geometry = statusQuadGeometry()
  const material = createBedsideMaterial(real?.texture ?? null)
  const mesh = new InstancedMesh(geometry, material, W4_TILE_COUNT)
  mesh.name = 'w4-status-screens'
  mesh.frustumCulled = false
  mesh.instanceMatrix.array.fill(0)
  mesh.instanceMatrix.needsUpdate = true
  const group = new Group()
  group.name = 'w4-status'
  group.add(mesh)

  const stats: StatusStats = { paints: 0, uploads: 0, checks: 0 }
  const known: (W4Tile | null)[] = new Array<W4Tile | null>(W4_TILE_COUNT).fill(null)
  const version = new Float64Array(W4_TILE_COUNT).fill(Number.NaN)
  const st = { generation: Number.NaN, snap: true, lastCheck: -9, lastUpload: -9, uploadDue: false }
  let off: (() => void) | null = null

  const place = (i: number, tile: W4Tile | null): void => {
    if (!tile) {
      mesh.instanceMatrix.array.fill(0, i * 16, i * 16 + 16)
    } else {
      const a = tile.anchor
      dummy.position.set(a.at.x, a.at.y, a.at.z)
      dummy.rotation.set(-(a.tilt ?? 0), a.heading, 0)
      dummy.scale.set(a.w, a.h, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  return {
    group,
    mesh,
    material,
    stats,
    shown() {
      const out: number[] = []
      for (let i = 0; i < W4_TILE_COUNT; i++) if (known[i]) out.push(i)
      return out
    },
    step({ generation, now }) {
      if (st.generation !== generation) {
        st.generation = generation
        st.snap = true
        version.fill(Number.NaN)
      }
      if (st.snap || now - st.lastCheck >= STATUS_CHECK) {
        st.snap = false
        st.lastCheck = now
        stats.checks++
        const registry = tiles()
        for (let i = 0; i < W4_TILE_COUNT; i++) {
          const tile = registry.get(i) ?? null
          if (tile !== known[i]) {
            known[i] = tile
            version[i] = Number.NaN
            place(i, tile)
            if (!tile && atlas) {
              atlas.paint(i, null)
              st.uploadDue = true
            }
          }
          if (!tile) continue
          const v = tile.version()
          if (v === version[i]) continue
          version[i] = v
          if (atlas) {
            try {
              atlas.paint(i, tile.paint)
            } catch {
              // a painter that throws leaves its tile as it was: the next version change tries again
            }
            st.uploadDue = true
          }
          stats.paints++
        }
      }
      if (st.uploadDue && atlas && now - st.lastUpload >= STATUS_UPLOAD) {
        st.uploadDue = false
        st.lastUpload = now
        atlas.texture.needsUpdate = true
        stats.uploads++
      }
    },
    attach() {
      off ??= registerDimmable(material.color, 1.1, 1)
    },
    dispose() {
      off?.()
      off = null
      geometry.dispose()
      material.dispose()
      atlas?.texture.dispose()
    },
  }
}
