/**
 * The uniforms every patched material shares (W3). One object per uniform, the SAME object in every material's shader (a patched
 * `onBeforeCompile` assigns `shader.uniforms.uLvX = lvUniforms.uLvX`), so writing a value here is the whole update: no material is touched, no
 * `needsUpdate`, no recompile. The daylight driver writes them when the look or the hour changes (a handful of numbers, at most once a frame
 * and only on change); texture.ts replaces the volume's contents once, after the bake.
 *
 *   uLvTex        the baked light volume (RGBA8 3D): R panel light, G window light, B walk AO, A overview AO
 *   uLvOrigin     the volume's low corner, uLvSize its extent (metres)
 *   uLvOn         1 when the shader should sample the volume at all (0 in the overview: it costs nothing there)
 *   uLvIndoor     the indoor blend, 0 (overview) .. 1 (walking): crossfades the AO channels and scales the light added
 *   uLvAo         how strongly the AO darkens the indirect light (the look table's `ao`)
 *   uLvPanel      the irradiance one unit of panel light adds: the panels' colour x the look's gain x the room-light level of the hour
 *   uLvSky        the same for the sky through windows (and the open air): the sky's colour x gain x the daylight
 *   uLvReflect    strength of the ceiling-panel reflection on the floors (0 = off); uLvPanelRad the panels' radiance for it
 *   uLvCeil...    the ceiling map (RG8, 0.1 m texels): the texture, its plan placement (x0, z0, 1/width, 1/depth), the ceiling height, texels/m
 *   uLvGlass      how far glass climbs toward opaque at grazing angles
 */
import { Color, DataTexture, Data3DTexture, LinearFilter, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType, Vector3, Vector4, type Texture } from 'three'
import { BUILDING, WALL } from '@/sim/places'
import { CEILING_MAP_HEIGHT, CEILING_MAP_WIDTH, CEILING_TEXELS_PER_METRE, createCeilingTexture } from '../ceilingMap'
import { VOLUME_GRID, gridSize } from './input'

/** One uniform: three's own shape, written here so this module does not need the type. */
export interface Uni<T> {
  value: T
}

const u = <T>(value: T): Uni<T> => ({ value })

/** What the volume holds before the bake finishes, and outside every area: no light, no occlusion. */
export const NEUTRAL_TEXEL = [0, 0, 255, 255] as const

/** A volume texture filled with the neutral texel (so the shader never samples an empty texture). */
export function createVolumeTexture(): Data3DTexture {
  const g = VOLUME_GRID
  const data = new Uint8Array(g.nx * g.nz * g.ny * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = NEUTRAL_TEXEL[0]
    data[i + 1] = NEUTRAL_TEXEL[1]
    data[i + 2] = NEUTRAL_TEXEL[2]
    data[i + 3] = NEUTRAL_TEXEL[3]
  }
  const t = new Data3DTexture(data, g.nx, g.nz, g.ny)
  t.format = RGBAFormat
  t.type = UnsignedByteType
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping
  t.generateMipmaps = false
  t.unpackAlignment = 4
  t.name = 'light-volume'
  t.needsUpdate = true
  return t
}

const size = gridSize(VOLUME_GRID)

/** The volume's texture: one object for the page's life, its bytes replaced in place when the bake lands. */
export const volumeTexture: Data3DTexture = createVolumeTexture()

export const lvUniforms = {
  uLvTex: u<Texture>(volumeTexture),
  uLvOrigin: u(new Vector3(VOLUME_GRID.x0, VOLUME_GRID.y0, VOLUME_GRID.z0)),
  uLvSize: u(new Vector3(size.x, size.y, size.z)),
  uLvOn: u(0),
  uLvIndoor: u(0),
  uLvAo: u(0),
  uLvPanel: u(new Color(0, 0, 0)),
  uLvSky: u(new Color(0, 0, 0)),
  uLvReflect: u(0),
  uLvPanelRad: u(new Color(0, 0, 0)),
  uLvCeil: u<Texture>(createCeilingTexture() as DataTexture),
  uLvCeilGeom: u(new Vector4(BUILDING.x0, BUILDING.z0, 1 / (CEILING_MAP_WIDTH / CEILING_TEXELS_PER_METRE), 1 / (CEILING_MAP_HEIGHT / CEILING_TEXELS_PER_METRE))),
  uLvCeilY: u(WALL.height),
  uLvCeilTexels: u(CEILING_TEXELS_PER_METRE),
  uLvGlass: u(0),
}

export type LvUniformName = keyof typeof lvUniforms
