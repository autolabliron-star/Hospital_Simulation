/**
 * The light volume bake (W3): one RGBA8 3D texture of the building's indoor light, computed once at load from the layout (volume/input.ts),
 * with nothing but arithmetic: no rays, no GPU, no randomness, so it is deterministic, takes about a tenth of a second and runs in node.
 * `VolumeBaker.step(budget)` does it in slices (texture.ts runs them behind the loading screen, at most 8 ms at a time, a frame between).
 *
 * Channels (0..1 in 8 bits; texel (ix, iz, iy) is at data[((iy * nz + iz) * nx + ix) * 4], x across, z down the rows, y up the layers):
 *
 *   R  the light of the ceiling panels. A roofed area's own panels only (a wall stops the light: the next room's panels never leak in), each
 *      a downward-facing patch: S = sum of area * h / (d^2 + h^2 + soft^2)^1.5, where h is the drop from the panel to the point and d the
 *      distance on the plan. That is the scalar irradiance of a Lambertian emitter, so it does not depend on which way a surface faces
 *      (the shader has one number per point, not per normal). R = S / PANEL_REF, clamped. 0 in an area with no ceiling.
 *   G  the light from outside. The sky through the glazing (the sum over a window run's sample points of cos / r^2, the same way) in a room;
 *      1 in the open atrium; 0 for a texel outside every area. The shader treats everything outside the volume as open sky (G = 1).
 *   B  ambient occlusion in walk mode: the floor, the walls in full height and the ceiling.
 *   A  ambient occlusion in the overview: the floor and the walls only up to the architect's section cut, no ceiling.
 *      In an area with no ceiling B equals A (walking in the atrium looks like the overview).
 *
 * R2: two storeys. The volume is 13 layers tall (0..7.8 m): layers 0..5 are level 1 as before; 6 is a buffer (the plenum under level 2's floor); 7..11 are level 2
 * (its floor at 4.2 m, so a layer is the same 0.6 m step, 0.3 m above its floor for the first, as level 1's layers 0..4), baked from level 2's own areas, walls, windows and
 * panels in DRAWN coordinates (shifted by -150 in x, since the shader samples world positions); 12 is a buffer above its ceiling. A buffer layer is open sky, except in the
 * columns of a level-2 area, where it repeats its neighbour on the level-2 side (a floor or a ceiling of level 2 samples 0.2 m off its surface, which for the first and the
 * last layer reaches into the buffer: it must read its own room, not the sky). The two storeys never share a column's data: each has its own area map and wall index.
 *
 * The AO is a distance-limited analytic one: each occluding plane within RADIUS blocks K * (1 - smoothstep(0, RADIUS, distance)) of the light
 * (a wall is a box, so it stops at a door opening), the planes combine as a product, and the strongest one is divided out. The strongest plane
 * is the one the sampled surface lies on (the shader samples 0.2 m in front of it), and a surface is not occluded by its own plane: what is
 * left is the corner term, how much the OTHER planes close in (a floor beside a wall, a wall under a ceiling). Glass occludes little.
 */
import type { VolumeArea, VolumeInput, WallBox, WindowRun } from './input'

/** The panel sum that reads as 1. Tuned so a floor in the middle of a 3 m panel grid reads about 0.65 and the air just under a panel reaches 1. */
export const PANEL_REF = 0.65
/** The window sum that reads as 1 (a point 0.5 m behind the middle of a tall, long window). */
export const WINDOW_REF = 4
/** Softening (m) of the 1/r^2 near a source, so the light under a panel is bright, not infinite. */
const PANEL_SOFT = 0.6
const WINDOW_SOFT = 0.2
/** Panels and window samples farther than this on the plan add nothing visible. */
const REACH = 9

/** AO: how much one plane at distance 0 blocks, and the distance (m) at which it stops. */
export const AO_STRENGTH = 0.55
export const AO_RADIUS = 1.6
/** The top of the walls in the overview AO fades out between these heights (the architect's section cut is 1.3). */
const CUT_FADE_FROM = 1.0
const CUT_FADE_TO = 1.6

/** Samples per window run: spaced this far along it, at three heights. */
const WINDOW_STEP = 0.5
const WINDOW_ROWS = 3

const MAX_WALLS_PER_COLUMN = 48
const BUCKET = 4

/** What a buffer layer holds over open air: no panel light, the sky at full, no occlusion (what the shader reads outside the volume). */
export const SKY_TEXEL = [0, 255, 255, 255] as const

/** One storey's slice of the volume: its own areas, walls and windows, the layers it owns and its floor height. */
interface Storey {
  areas: readonly VolumeArea[]
  walls: readonly WallBox[]
  windows: readonly WindowRun[]
  /** First layer and how many. */
  first: number
  count: number
  /** Floor height (m): the heights the maths reads are relative to it. */
  floorY: number
  /** The area of every column's centre (-1 = none). */
  areaOf: Int16Array
  buckets: number[][]
  /** Columns outside every area read as: the lower storey keeps its old "no light, no occlusion"; an upper one is open air. */
  outside: readonly [number, number, number, number]
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
const to8 = (v: number): number => Math.round(clamp01(v) * 255)

export class VolumeBaker {
  /** The texels, filled in as `step` runs. Untouched texels are 0 (a finished bake touches every one). */
  readonly data: Uint8Array
  private col = 0
  private readonly nx: number
  private readonly nz: number
  private readonly ny: number
  private readonly total: number
  private readonly lower: Storey
  private readonly upper: Storey | null
  private readonly bucketsX: number
  private readonly bucketsZ: number
  private readonly wallD = new Float64Array(MAX_WALLS_PER_COLUMN)
  private readonly wallW = new Float64Array(MAX_WALLS_PER_COLUMN)
  /** How many of the wallD / wallW entries belong to the column being baked. */
  private near = 0

  constructor(private readonly input: VolumeInput) {
    const g = input.grid
    this.nx = g.nx
    this.nz = g.nz
    this.ny = g.ny
    this.total = g.nx * g.nz
    this.data = new Uint8Array(g.nx * g.nz * g.ny * 4)
    this.bucketsX = Math.ceil((g.nx * g.cell) / BUCKET)
    this.bucketsZ = Math.ceil((g.nz * g.cell) / BUCKET)
    this.lower = this.makeStorey(input.areas, input.walls, input.windows, 0, input.lowerLayers ?? g.ny, 0, [0, 0, 255, 255])
    const u = input.upper
    this.upper = u ? this.makeStorey(u.areas, u.walls, u.windows, u.firstLayer, u.layers, u.floorY, SKY_TEXEL) : null
  }

  /** 0..1. */
  get progress(): number {
    return this.col / this.total
  }

  get done(): boolean {
    return this.col >= this.total
  }

  /** Bake columns until `budgetMs` has passed on `now()` (checked every 16 columns) or the volume is done. Returns `done`. */
  step(budgetMs: number, now: () => number): boolean {
    const t0 = now()
    while (this.col < this.total) {
      for (let n = 0; n < 16 && this.col < this.total; n++) this.bakeColumn(this.col++)
      if (now() - t0 >= budgetMs) break
    }
    return this.done
  }

  /** Run to the end in one go (the tests, and a node tool). */
  runAll(): Uint8Array {
    while (this.col < this.total) this.bakeColumn(this.col++)
    return this.data
  }

  // --- set-up ----------------------------------------------------------------------------------------

  private makeStorey(
    areas: readonly VolumeArea[],
    walls: readonly WallBox[],
    windows: readonly WindowRun[],
    first: number,
    count: number,
    floorY: number,
    outside: readonly [number, number, number, number],
  ): Storey {
    const storey: Storey = {
      areas,
      walls,
      windows,
      first,
      count,
      floorY,
      areaOf: new Int16Array(this.total).fill(-1),
      buckets: Array.from({ length: this.bucketsX * this.bucketsZ }, () => []),
      outside,
    }
    this.indexAreas(storey)
    this.indexWalls(storey)
    return storey
  }

  /** The area of every column's centre: the first nested area that holds it, else the first area that does (`areaAt`'s rule). */
  private indexAreas(st: Storey): void {
    const g = this.input.grid
    for (let iz = 0; iz < this.nz; iz++) {
      const z = g.z0 + (iz + 0.5) * g.cell
      for (let ix = 0; ix < this.nx; ix++) {
        const x = g.x0 + (ix + 0.5) * g.cell
        let best = -1
        for (let i = 0; i < st.areas.length; i++) {
          const a = st.areas[i]
          if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) {
            if (a.nested) {
              best = i
              break
            }
            if (best < 0) best = i
          }
        }
        st.areaOf[iz * this.nx + ix] = best
      }
    }
  }

  /** Walls into 4 m buckets, a wall in every bucket within AO_RADIUS of it. */
  private indexWalls(st: Storey): void {
    const g = this.input.grid
    for (let i = 0; i < st.walls.length; i++) {
      const w = st.walls[i]
      const bx0 = Math.max(0, Math.floor((w.x0 - AO_RADIUS - g.x0) / BUCKET))
      const bx1 = Math.min(this.bucketsX - 1, Math.floor((w.x1 + AO_RADIUS - g.x0) / BUCKET))
      const bz0 = Math.max(0, Math.floor((w.z0 - AO_RADIUS - g.z0) / BUCKET))
      const bz1 = Math.min(this.bucketsZ - 1, Math.floor((w.z1 + AO_RADIUS - g.z0) / BUCKET))
      for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) st.buckets[bz * this.bucketsX + bx].push(i)
    }
  }

  // --- one column ------------------------------------------------------------------------------------

  private bakeColumn(index: number): void {
    this.bakeStorey(this.lower, index)
    if (this.upper) this.bakeStorey(this.upper, index)
    this.fillBuffers(index)
  }

  /** One storey's layers of column `index`. */
  private bakeStorey(st: Storey, index: number): void {
    const g = this.input.grid
    const cutHeight = this.input.cutHeight
    const ix = index % this.nx
    const iz = (index - ix) / this.nx
    const x = g.x0 + (ix + 0.5) * g.cell
    const z = g.z0 + (iz + 0.5) * g.cell
    const ai = st.areaOf[index]
    const data = this.data
    const last = st.first + st.count
    if (ai < 0) {
      // outside every area: no panel light, no window light, no occlusion (an upper storey: open air)
      for (let iy = st.first; iy < last; iy++) {
        const o = ((iy * this.nz + iz) * this.nx + ix) * 4
        data[o] = st.outside[0]
        data[o + 1] = st.outside[1]
        data[o + 2] = st.outside[2]
        data[o + 3] = st.outside[3]
      }
      return
    }
    const area = st.areas[ai]
    const roofed = area.ceiling !== null
    const ceil = area.ceiling ?? 0

    // the walls near this column, as horizontal distances to their boxes
    let n = 0
    const bx = Math.min(this.bucketsX - 1, Math.max(0, Math.floor((x - g.x0) / BUCKET)))
    const bz = Math.min(this.bucketsZ - 1, Math.max(0, Math.floor((z - g.z0) / BUCKET)))
    const list = st.buckets[bz * this.bucketsX + bx]
    for (let k = 0; k < list.length && n < MAX_WALLS_PER_COLUMN; k++) {
      const w = st.walls[list[k]]
      const dx = x < w.x0 ? w.x0 - x : x > w.x1 ? x - w.x1 : 0
      const dz = z < w.z0 ? w.z0 - z : z > w.z1 ? z - w.z1 : 0
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d >= AO_RADIUS) continue
      this.wallD[n] = d
      this.wallW[n] = w.weight
      n++
    }
    this.near = n

    for (let iy = st.first; iy < last; iy++) {
      // heights are relative to the storey's floor
      const y = g.y0 + (iy + 0.5) * g.layer - st.floorY
      // above the ceiling (the top layer's centre is over a 3 m storey) the light of the highest point under it carries on, so the filtered
      // value at the ceiling's own height does not fade toward a layer that holds nothing
      const yc = roofed ? Math.min(y, ceil - 0.1) : y
      let r = 0
      if (roofed) {
        const drop = ceil - yc
        let s = 0
        for (let p = 0; p < area.panels.length; p++) {
          const pl = area.panels[p]
          const dx = pl.x - x
          const dz = pl.z - z
          const d2 = dx * dx + dz * dz
          if (d2 > REACH * REACH) continue
          const r2 = d2 + drop * drop + PANEL_SOFT * PANEL_SOFT
          s += (pl.area * drop) / (r2 * Math.sqrt(r2))
        }
        r = s / PANEL_REF
      }
      const sky = roofed ? this.windowLight(st.windows, ai, x, z, yc) : 1
      const aoOverview = this.occlusion(y, cutHeight, false, 0)
      const aoWalk = roofed ? this.occlusion(yc, 0, true, ceil) : aoOverview
      const o = ((iy * this.nz + iz) * this.nx + ix) * 4
      data[o] = to8(r)
      data[o + 1] = to8(sky)
      data[o + 2] = to8(aoWalk)
      data[o + 3] = to8(aoOverview)
    }
  }

  /**
   * The layers no storey owns (R2: the buffer under level 2's floor and the one above its ceiling): open sky, except in the columns of a level-2
   * area, where each repeats its neighbour on the level-2 side.
   */
  private fillBuffers(index: number): void {
    const up = this.upper
    const ix = index % this.nx
    const iz = (index - ix) / this.nx
    const data = this.data
    const lowerEnd = this.lower.first + this.lower.count
    const upperFirst = up ? up.first : this.ny
    const upperLast = up ? up.first + up.count : this.ny
    const own = up !== null && up.areaOf[index] >= 0
    for (let iy = lowerEnd; iy < this.ny; iy++) {
      if (iy >= upperFirst && iy < upperLast) continue
      const o = ((iy * this.nz + iz) * this.nx + ix) * 4
      if (own) {
        const from = iy < upperFirst ? upperFirst : upperLast - 1
        const f = ((from * this.nz + iz) * this.nx + ix) * 4
        data[o] = data[f]
        data[o + 1] = data[f + 1]
        data[o + 2] = data[f + 2]
        data[o + 3] = data[f + 3]
      } else {
        data[o] = SKY_TEXEL[0]
        data[o + 1] = SKY_TEXEL[1]
        data[o + 2] = SKY_TEXEL[2]
        data[o + 3] = SKY_TEXEL[3]
      }
    }
  }

  /** The sky through the area's glazing at a point, 0..1. */
  private windowLight(windows: readonly WindowRun[], area: number, x: number, z: number, y: number): number {
    let s = 0
    let any = false
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]
      if (w.area !== area) continue
      const across = w.alongX ? z : x
      const along = w.alongX ? x : z
      const nd = (across - w.c) * w.side
      if (nd < 0.02 || nd > REACH) continue
      any = true
      const len = w.b - w.a
      const steps = Math.max(1, Math.ceil(len / WINDOW_STEP))
      const step = len / steps
      const rowH = w.y1 / WINDOW_ROWS
      const cell = step * rowH
      let sum = 0
      for (let k = 0; k < steps; k++) {
        const da = w.a + (k + 0.5) * step - along
        if (da > REACH || da < -REACH) continue
        for (let j = 0; j < WINDOW_ROWS; j++) {
          const dh = (j + 0.5) * rowH - y
          const r2 = nd * nd + da * da + dh * dh + WINDOW_SOFT * WINDOW_SOFT
          sum += (cell * nd) / (r2 * Math.sqrt(r2))
        }
      }
      s += sum * w.strength
    }
    return any ? s / WINDOW_REF : 0
  }

  /**
   * The AO at height y for the column last prepared: the floor, the nearby walls (limited to the section cut when `cut` > 0 and the wall is a
   * low one in the overview; full height when walking) and, when walking, the ceiling at `ceil`.
   */
  private occlusion(y: number, cut: number, ceiling: boolean, ceil: number): number {
    let fmax = AO_STRENGTH * (1 - smooth(0, AO_RADIUS, y))
    let prod = 1 - fmax
    const hm = cut > 0 ? 1 - smooth(CUT_FADE_FROM, CUT_FADE_TO, y) : 1
    for (let k = 0; k < this.near; k++) {
      const f = AO_STRENGTH * this.wallW[k] * hm * (1 - smooth(0, AO_RADIUS, this.wallD[k]))
      if (f <= 0) continue
      prod *= 1 - f
      if (f > fmax) fmax = f
    }
    if (ceiling) {
      const f = AO_STRENGTH * (1 - smooth(0, AO_RADIUS, ceil - y))
      prod *= 1 - f
      if (f > fmax) fmax = f
    }
    return prod / (1 - fmax)
  }
}

/** The whole bake in one call. */
export function bakeLightVolume(input: VolumeInput): Uint8Array {
  return new VolumeBaker(input).runAll()
}

/** One texel's four channels (0..1) into `out`. Out-of-range indices clamp. For tests. */
export function texel(data: Uint8Array, input: VolumeInput, ix: number, iz: number, iy: number, out: Float32Array | number[]): void {
  const g = input.grid
  const x = Math.min(g.nx - 1, Math.max(0, ix))
  const z = Math.min(g.nz - 1, Math.max(0, iz))
  const y = Math.min(g.ny - 1, Math.max(0, iy))
  const o = ((y * g.nz + z) * g.nx + x) * 4
  for (let c = 0; c < 4; c++) out[c] = data[o + c] / 255
}

/** What the GPU does: trilinear, clamped to the edge texels, at a world point. For tests. */
export function sampleVolume(data: Uint8Array, input: VolumeInput, wx: number, wy: number, wz: number, out: Float32Array | number[]): void {
  const g = input.grid
  const fx = (wx - g.x0) / g.cell - 0.5
  const fz = (wz - g.z0) / g.cell - 0.5
  const fy = (wy - g.y0) / g.layer - 0.5
  const x0 = Math.floor(fx)
  const z0 = Math.floor(fz)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const tz = fz - z0
  const ty = fy - y0
  out[0] = out[1] = out[2] = out[3] = 0
  const t = [0, 0, 0, 0]
  for (let dy = 0; dy < 2; dy++) {
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? tx : 1 - tx) * (dz ? tz : 1 - tz) * (dy ? ty : 1 - ty)
        texel(data, input, x0 + dx, z0 + dz, y0 + dy, t)
        for (let c = 0; c < 4; c++) out[c] += w * t[c]
      }
    }
  }
}
