/**
 * Realism step 2: the SH9 projection of a probe (./sh.ts) on images whose answer is known, its orientation against three's equirect mapping,
 * three's own irradiance formula, and the real lobby probe (units: the bake's radiance).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DataUtils, SphericalHarmonics3, Vector3 } from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { describe, expect, it } from 'vitest'
import { projectEquirectSH, shDigest, shIrradiance, SH_FLOATS } from './sh'

const W = 256
const H = 128

/** An RGBA float equirect image where radiance(direction) is given (three's mapping: row 0 up, column centre +x, right quarter +z). */
function image(radiance: (x: number, y: number, z: number) => number): { width: number; height: number; data: Float32Array } {
  const data = new Float32Array(W * H * 4)
  for (let r = 0; r < H; r++) {
    const el = (0.5 - (r + 0.5) / H) * Math.PI
    for (let c = 0; c < W; c++) {
      const phi = ((c + 0.5) / W - 0.5) * 2 * Math.PI
      const L = radiance(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el))
      const i = (r * W + c) * 4
      data[i] = data[i + 1] = data[i + 2] = L
      data[i + 3] = 1
    }
  }
  return { width: W, height: H, data }
}

const E = (sh: Float32Array, x: number, y: number, z: number): number => {
  const out = [0, 0, 0]
  shIrradiance(sh, x, y, z, out)
  return out[0]
}

describe('projectEquirectSH', () => {
  it('a uniform sky of radiance 1 gives irradiance PI from every side', () => {
    const sh = projectEquirectSH(image(() => 1))
    for (const [x, y, z] of [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, -1],
      [0.6, 0.48, 0.64],
    ])
      expect(E(sh, x, y, z)).toBeCloseTo(Math.PI, 2)
  })

  it('a bright upper hemisphere: PI facing up, nothing facing down, PI / 2 sideways (exact for L0 + L1)', () => {
    const sh = projectEquirectSH(image((_, y) => (y > 0 ? 1 : 0)))
    expect(E(sh, 0, 1, 0)).toBeCloseTo(Math.PI, 1)
    expect(Math.abs(E(sh, 0, -1, 0))).toBeLessThan(0.03)
    expect(E(sh, 1, 0, 0)).toBeCloseTo(Math.PI / 2, 2)
    expect(E(sh, 0, 0, 1)).toBeCloseTo(Math.PI / 2, 2)
  })

  it('reads the image the way three maps it: the centre column looks along +x, the right quarter along +z', () => {
    // light in the image's middle half of the columns (u 0.25..0.75: atan(z, x) within +-90 degrees) = the +x hemisphere
    const xs = projectEquirectSH(image((x) => (x > 0 ? 1 : 0)))
    expect(E(xs, 1, 0, 0)).toBeCloseTo(Math.PI, 1)
    expect(Math.abs(E(xs, -1, 0, 0))).toBeLessThan(0.03)
    const zs = projectEquirectSH(image((_, __, z) => (z > 0 ? 1 : 0)))
    expect(E(zs, 0, 0, 1)).toBeCloseTo(Math.PI, 1)
    expect(Math.abs(E(zs, 0, 0, -1))).toBeLessThan(0.03)
  })

  it('half floats (HDRLoader\'s default) give the same coefficients as floats', () => {
    const f = image((x, y) => 0.3 + 2 * Math.max(0, y) + 0.5 * Math.max(0, x))
    const h = { width: f.width, height: f.height, data: Uint16Array.from(f.data, (v) => DataUtils.toHalfFloat(v)) }
    const a = projectEquirectSH(f)
    const b = projectEquirectSH(h)
    for (let k = 0; k < SH_FLOATS; k++) expect(b[k]).toBeCloseTo(a[k], 2)
  })

  it('ignores negative and non-finite texels', () => {
    const img = image(() => 1)
    img.data[0] = NaN
    img.data[5] = -4
    img.data[10] = Infinity
    const sh = projectEquirectSH(img)
    for (let k = 0; k < SH_FLOATS; k++) expect(Number.isFinite(sh[k])).toBe(true)
  })
})

describe('shIrradiance', () => {
  it('is three\'s own irradiance formula (SphericalHarmonics3.getIrradianceAt, the twin of the GLSL shGetIrradianceAt)', () => {
    const sh = new Float32Array(SH_FLOATS)
    for (let k = 0; k < SH_FLOATS; k++) sh[k] = Math.sin(k * 1.7) * 0.8
    const three = new SphericalHarmonics3()
    for (let i = 0; i < 9; i++) three.coefficients[i].set(sh[i * 3], sh[i * 3 + 1], sh[i * 3 + 2])
    const out = [0, 0, 0]
    const ref = new Vector3()
    for (const n of [new Vector3(0, 1, 0), new Vector3(1, 2, 3).normalize(), new Vector3(-0.3, -0.9, 0.31).normalize()]) {
      shIrradiance(sh, n.x, n.y, n.z, out)
      three.getIrradianceAt(n, ref)
      expect(out[0]).toBeCloseTo(ref.x, 5)
      expect(out[1]).toBeCloseTo(ref.y, 5)
      expect(out[2]).toBeCloseTo(ref.z, 5)
    }
  })
})

describe('the real lobby probe (public/assets/building/zones/lobby/env_lobby.hdr)', () => {
  const file = join(process.cwd(), 'public/assets/building/zones/lobby/env_lobby.hdr')
  const buf = readFileSync(file)
  const parsed = new HDRLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer) as unknown as { width: number; height: number; data: Uint16Array }

  it('is lit from above like a room under ceiling panels, in the bake\'s units', () => {
    const sh = projectEquirectSH(parsed)
    const d = shDigest(sh)
    // what a white surface reflects (E / PI): the lobby measured 0.64 up, about 0.45 sideways, 0.33 down when this was written
    expect(d.up).toBeGreaterThan(0.3)
    expect(d.up).toBeLessThan(1.5)
    expect(d.up).toBeGreaterThan(d.side)
    expect(d.side).toBeGreaterThan(d.down)
    expect(d.down).toBeGreaterThan(0.05)
    // self-consistency of the units: the floor the probe sees below it (its radiance) over what a white floor would reflect there (E_up / PI)
    // is the floor's albedo: a light terrazzo, between 0.3 and 0.9
    let below = 0
    let weight = 0
    for (let r = Math.floor(parsed.height * 0.75); r < parsed.height; r++) {
      const el = (0.5 - (r + 0.5) / parsed.height) * Math.PI
      for (let c = 0; c < parsed.width; c += 4) {
        const i = (r * parsed.width + c) * 4
        const L = 0.2126 * DataUtils.fromHalfFloat(parsed.data[i]) + 0.7152 * DataUtils.fromHalfFloat(parsed.data[i + 1]) + 0.0722 * DataUtils.fromHalfFloat(parsed.data[i + 2])
        below += L * Math.cos(el)
        weight += Math.cos(el)
      }
    }
    const albedo = below / weight / d.up
    expect(albedo).toBeGreaterThan(0.3)
    expect(albedo).toBeLessThan(0.9)
  })
})
