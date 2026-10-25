/**
 * The bake-matched light's shared uniforms (step 2 of the realism pass). Like `lvUniforms` (../volume/uniforms.ts) these are ONE object per
 * uniform, handed to every material the light-volume patch reaches (`applyLightVolume`: the palette, the crowd, the machines, the meal bots, the
 * authored building's movable kit), so a write here is the whole update: no material is touched and nothing recompiles.
 *
 *   uBkField   the field (./field.ts): SH9 + weight per cell and storey, RGBA16F, all zero (weight 0: nothing changes) until the probes are in
 *   uBkGeom    the field's plan placement: (x0, z0, 1 / width, 1 / depth) in drawn metres
 *   uBkSplitY  fragments above this read level 2's page
 *   uBkOn      0..1: how far the bake's light replaces the live light on live objects (the daylight driver: the indoor blend once the field is
 *              ready, 0 in the overview, with `?bakelight=0`, with `?look=model` and with the procedural building)
 *   uBkGain    the irradiance scale (look.ts BAKE_LIGHT.gain: 1 = the bake's own units)
 *   uBkSpec    the environment's specular gain on live objects inside the bake: THE SAME uniform object as the baked materials' own
 *              (src/scene/building/model/reflections.ts `uReflGain`, written by Effects.tsx), so a live bed and a baked one next to it reflect the
 *              probe equally: at the driver's environment intensity while walking, at the probe's true radiance while presenting
 *   uBkKey     the share of the live sun kept on live objects inside the bake (look.ts BAKE_LIGHT.key)
 *   uBkAo      how much of the light volume's ambient occlusion darkens the bake's ambient (look.ts BAKE_LIGHT.ao)
 */
import { ClampToEdgeWrapping, Data3DTexture, HalfFloatType, LinearFilter, RGBAFormat, Vector4, type Texture } from 'three'
import { reflectionUniforms } from '@/scene/building/model/reflections'
import { BAKE_GRID, BAKE_SPLIT_Y, SLICES, toHalfFloats, type BakeField } from './field'

export interface Uni<T> {
  value: T
}

const u = <T>(value: T): Uni<T> => ({ value })

function createFieldTexture(): Data3DTexture {
  const g = BAKE_GRID
  const t = new Data3DTexture(new Uint16Array(g.nx * g.nz * SLICES * 4), g.nx, g.nz, SLICES)
  t.name = 'bake-light-field'
  t.format = RGBAFormat
  t.type = HalfFloatType
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping
  t.generateMipmaps = false
  t.unpackAlignment = 1
  t.needsUpdate = true
  return t
}

/** One texture for the page's life; its contents are replaced in place when the probes are in. */
export const bakeFieldTexture: Data3DTexture = createFieldTexture()

export const bakeUniforms = {
  uBkField: u<Texture>(bakeFieldTexture),
  uBkGeom: u(new Vector4(BAKE_GRID.x0, BAKE_GRID.z0, 1 / (BAKE_GRID.nx * BAKE_GRID.cell), 1 / (BAKE_GRID.nz * BAKE_GRID.cell))),
  uBkSplitY: u(BAKE_SPLIT_Y),
  uBkOn: u(0),
  uBkGain: u(1),
  uBkSpec: reflectionUniforms.uReflGain as Uni<number>,
  uBkKey: u(0),
  uBkAo: u(0.5),
}

export type BakeUniformName = keyof typeof bakeUniforms

/** What the field holds now (the probe hook and the daylight driver read it). */
export const bakeState = {
  /** A field with at least one owned cell is in the texture. */
  ready: false,
  /** The zones (and fallbacks) that made it, in order: `lobby`, `imaging<-lobby`, ... */
  sources: [] as string[],
  /** Cells owned per storey (before growing). */
  owned: [0, 0] as [number, number],
  /** The field as built (float, for the probe's `at`). */
  field: null as BakeField | null,
  /** `?probe=1` A/B: a pinned `uBkOn` (the daylight driver writes this instead of its own value), or null. */
  force: null as number | null,
}

/** Put a built field into the texture (once, behind the loading screen). */
export function setBakeField(field: BakeField, sources: readonly string[]): void {
  const image = bakeFieldTexture.image as { data: Uint16Array }
  if (field.data.length !== image.data.length) throw new Error(`setBakeField: a ${field.grid.nx} x ${field.grid.nz} field does not fit the texture`)
  toHalfFloats(field.data, image.data)
  bakeFieldTexture.needsUpdate = true
  bakeState.owned = [field.owned[0], field.owned[1]]
  bakeState.sources = [...sources]
  bakeState.field = field
  bakeState.ready = field.owned[0] + field.owned[1] > 0
}

/** Back to nothing (weight 0 everywhere): the live light everywhere. */
export function clearBakeField(): void {
  ;(bakeFieldTexture.image as { data: Uint16Array }).data.fill(0)
  bakeFieldTexture.needsUpdate = true
  bakeState.ready = false
  bakeState.sources = []
  bakeState.owned = [0, 0]
  bakeState.field = null
}
