/**
 * Step 2 of the realism pass (docs/handover/realism-lighting.md): the diffuse light of a zone's Cycles reflection probe as order-2 spherical
 * harmonics (SH9, three's basis and order), so live objects (people, robots, devices) can be lit by the very light the static building was baked
 * with. Pure and allocation-free after the call's own output, so node tests run it on synthetic and real HDRs.
 *
 * Units. A probe (public/assets/building/zones/<id>/env_<id>.hdr) is the radiance of the baked scene seen from its eye, linear, exposure 0; a
 * lightmap is the outgoing radiance of a white diffuse surface (src/scene/building/model/lightmaps.ts). The coefficients here are the plain
 * projection c_i = integral L(w) Y_i(w) dw; `shIrradiance` is three's own `shGetIrradianceAt` (the cosine-lobe convolution, lights_pars_begin),
 * so `shIrradiance / PI` of a white surface facing n is exactly what the bake would have stored for a white surface facing n at the probe's eye.
 * No exposure fudge is needed: the tone mapping sees both the same way.
 *
 * Orientation (three's equirectangular mapping, `equirectUv`): u = atan(z, x) / 2PI + 0.5, v = asin(y) / PI + 0.5; HDRLoader returns the rows top
 * first with `flipY` set, so data row 0 is straight up (v = 1) and the image centre looks along +x (east), the right quarter along +z (south).
 */
import { DataUtils } from 'three'

/** Floats in one SH9 RGB set: coefficient i, channel c at [i * 3 + c]. */
export const SH_FLOATS = 27

/** three's SH9 basis (SphericalHarmonics3.getBasisAt), written into `out[0..8]`. */
export function shBasis(x: number, y: number, z: number, out: Float64Array | Float32Array | number[]): void {
  out[0] = 0.282095
  out[1] = 0.488603 * y
  out[2] = 0.488603 * z
  out[3] = 0.488603 * x
  out[4] = 1.092548 * x * y
  out[5] = 1.092548 * y * z
  out[6] = 0.315392 * (3 * z * z - 1)
  out[7] = 1.092548 * x * z
  out[8] = 0.546274 * (x * x - y * y)
}

export interface EquirectImage {
  width: number
  height: number
  /** RGBA or RGB, Float32 or half floats (HDRLoader's default HalfFloatType gives a Uint16Array). */
  data: ArrayLike<number>
  /** Floats per pixel (4 for HDRLoader's RGBA). Default: data.length / (width x height). */
  channels?: number
}

const basis = new Float64Array(9)
const acc = new Float64Array(SH_FLOATS)

/**
 * Project an equirectangular radiance image onto SH9: `out` (27 floats) gets c_i per channel. Every pixel is integrated with its solid angle
 * (2PI / W) (PI / H) cos(elevation), so small bright sources (the LED lines, the downlights) count for what they are. Non-finite or negative texels
 * count as 0. Returns `out`.
 */
export function projectEquirectSH(img: EquirectImage, out: Float32Array = new Float32Array(SH_FLOATS)): Float32Array {
  const { width: W, height: H, data } = img
  const ch = img.channels ?? Math.round(data.length / (W * H))
  if (W <= 0 || H <= 0 || ch < 3 || data.length < W * H * ch) throw new Error(`projectEquirectSH: bad image ${W} x ${H} x ${ch} (${data.length} values)`)
  const half = data instanceof Uint16Array
  acc.fill(0)
  const cosPhi = new Float64Array(W)
  const sinPhi = new Float64Array(W)
  for (let c = 0; c < W; c++) {
    const phi = ((c + 0.5) / W - 0.5) * 2 * Math.PI
    cosPhi[c] = Math.cos(phi)
    sinPhi[c] = Math.sin(phi)
  }
  const dPhi = (2 * Math.PI) / W
  const dEl = Math.PI / H
  for (let r = 0; r < H; r++) {
    const el = (0.5 - (r + 0.5) / H) * Math.PI
    const y = Math.sin(el)
    const ce = Math.cos(el)
    const dw = dPhi * dEl * ce
    for (let c = 0; c < W; c++) {
      const i = (r * W + c) * ch
      let R = half ? DataUtils.fromHalfFloat(data[i]) : data[i]
      let G = half ? DataUtils.fromHalfFloat(data[i + 1]) : data[i + 1]
      let B = half ? DataUtils.fromHalfFloat(data[i + 2]) : data[i + 2]
      if (!(R > 0) || !Number.isFinite(R)) R = 0
      if (!(G > 0) || !Number.isFinite(G)) G = 0
      if (!(B > 0) || !Number.isFinite(B)) B = 0
      if (R === 0 && G === 0 && B === 0) continue
      shBasis(cosPhi[c] * ce, y, sinPhi[c] * ce, basis)
      for (let k = 0; k < 9; k++) {
        const w = basis[k] * dw
        acc[k * 3] += R * w
        acc[k * 3 + 1] += G * w
        acc[k * 3 + 2] += B * w
      }
    }
  }
  for (let k = 0; k < SH_FLOATS; k++) out[k] = acc[k]
  return out
}

/**
 * The irradiance E(n) of a unit normal n from SH9 radiance coefficients: three's `shGetIrradianceAt`, term for term (the GLSL in the light chunk
 * calls that very function). A white Lambert surface facing n reflects E / PI. Writes RGB into `out`; allocation-free.
 */
export function shIrradiance(sh: ArrayLike<number>, x: number, y: number, z: number, out: Float32Array | number[]): void {
  for (let c = 0; c < 3; c++) {
    out[c] =
      sh[c] * 0.886227 +
      2 * 0.511664 * (sh[3 + c] * y + sh[6 + c] * z + sh[9 + c] * x) +
      2 * 0.429043 * (sh[12 + c] * x * y + sh[15 + c] * y * z + sh[21 + c] * x * z) +
      sh[18 + c] * (0.743125 * z * z - 0.247708) +
      sh[24 + c] * 0.429043 * (x * x - y * y)
  }
}

/** Luminance (Rec. 709) of an RGB triple. */
export const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** A readable digest of a set (what a white surface reflects, E / PI, facing up, down and the four sides; luminance): for logs, tests and the report. */
export function shDigest(sh: ArrayLike<number>): { up: number; down: number; side: number; px: number; nx: number; pz: number; nz: number } {
  const e: number[] = [0, 0, 0]
  const at = (x: number, y: number, z: number): number => {
    shIrradiance(sh, x, y, z, e)
    return luminance(e[0], e[1], e[2]) / Math.PI
  }
  const px = at(1, 0, 0)
  const nx = at(-1, 0, 0)
  const pz = at(0, 0, 1)
  const nz = at(0, 0, -1)
  return { up: at(0, 1, 0), down: at(0, -1, 0), side: (px + nx + pz + nz) / 4, px, nx, pz, nz }
}
