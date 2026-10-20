/**
 * R3: CT, MRI and X-ray of the synthetic body follow the physics that real images show: Hounsfield units by tissue and contrast phase, MR
 * contrast from T1/T2 (CSF dark on T1 and bright on T2, fat suppressed by fat-sat), bone white on a radiograph. Deterministic.
 */
import { describe, expect, it } from 'vitest'
import { BodyBuilder, labelAt, type V3 } from '../phantom/body'
import { patientParams } from '../phantom/params'
import { buildRegions } from '../phantom/regions'
import { tissue } from '../phantom/tissues'
import { CtRenderer } from './ct'
import { MriRenderer, mriSignal } from './mri'
import { plane } from './raster'
import { XrayRenderer } from './xray'

const p = patientParams(12345)
const b = new BodyBuilder()
const lm = buildRegions(b, p, ['abdomen'])
const ph = b.compile()

/** The output pixel of a patient point on an axial plane at its height (fov 400, size 256). */
function axialPixel(pt: V3, size: number, fov: number, c: V3): number {
  const x = Math.floor(((pt[0] - c[0]) / fov + 0.5) * size)
  const y = Math.floor(((pt[1] - c[1]) / fov + 0.5) * size)
  return y * size + x
}

describe('CT', () => {
  const at = (z: number): V3 => [0, 6, z]
  const req = (z: number, phase: 'plain' | 'arterial' | 'portal') => ({ plane: plane(at(z), [1, 0, 0], [0, 1, 0], 400, 1.25), phase, level: 50, width: 400, kernel: 'soft' as const, noiseHu: 1, seed: 1, slice: 0, size: 256 })
  it('is deterministic', () => {
    const r = new CtRenderer()
    const a = Buffer.from(r.render(ph, req(240, 'portal')))
    const c = Buffer.from(new CtRenderer().render(ph, req(240, 'portal')))
    expect(a.equals(c)).toBe(true)
  })
  it('shows the aorta brighter in the arterial phase and the liver brighter in the portal phase; bone, fat and air where they belong', () => {
    const r = new CtRenderer()
    const z = 300 * p.height
    const ao: V3 = [10 * p.width, 20 * p.depth, z]
    expect(labelAt(ph, ...ao) >= 0 && ph.partTissue[labelAt(ph, ...ao)]).toBe(tissue('blood'))
    r.render(ph, req(z, 'arterial'))
    const art = r.lastHu[axialPixel(ao, 256, 400, at(z))]
    r.render(ph, req(z, 'portal'))
    const port = r.lastHu[axialPixel(ao, 256, 400, at(z))]
    expect(art).toBeGreaterThan(port + 60)
    const liver: V3 = [p.liver.c[0], p.liver.c[1], z]
    const lp = r.lastHu[axialPixel(liver, 256, 400, at(z))]
    r.render(ph, req(z, 'plain'))
    expect(lp).toBeGreaterThan(r.lastHu[axialPixel(liver, 256, 400, at(z))] + 30)
    // the vertebral body (marrow) is bone, the subcutaneous fat is fat, outside is air
    const l3 = lm.vertL3
    r.render(ph, req(l3[2], 'plain'))
    expect(r.lastHu[axialPixel(l3, 256, 400, at(l3[2]))]).toBeGreaterThan(150)
    expect(r.lastHu[axialPixel([0, -170, l3[2]], 256, 400, at(l3[2]))]).toBeLessThan(-800)
  })
})

describe('MRI', () => {
  it('derives the contrasts from T1 and T2', () => {
    const csf = tissue('csf')
    const fat = tissue('fat')
    const wm = tissue('whiteMatter')
    const gm = tissue('greyMatter')
    expect(mriSignal(csf, 'T2')).toBeGreaterThan(mriSignal(wm, 'T2') * 2)
    expect(mriSignal(csf, 'T1')).toBeLessThan(mriSignal(wm, 'T1') * 0.6)
    // FLAIR nulls the fluid; fat-sat and STIR take the fat down
    expect(mriSignal(csf, 'FLAIR')).toBeLessThan(mriSignal(gm, 'FLAIR') * 0.5)
    expect(mriSignal(fat, 'PDFS')).toBeLessThan(mriSignal(fat, 'PD') * 0.2)
    expect(mriSignal(fat, 'STIR')).toBeLessThan(mriSignal(fat, 'T1') * 0.3)
    // grey matter brighter than white on T2, darker on T1; flowing blood is a void on spin echo
    expect(mriSignal(gm, 'T2')).toBeGreaterThan(mriSignal(wm, 'T2'))
    expect(mriSignal(gm, 'T1')).toBeLessThan(mriSignal(wm, 'T1'))
    expect(mriSignal(tissue('blood'), 'T2')).toBeLessThan(0.05)
    // diffusion: cellular tissue stays, fluid is dark
    expect(mriSignal(csf, 'DWI')).toBeLessThan(mriSignal(wm, 'DWI'))
  })
  it('renders the lumbar spine with bright CSF on T2 and dark CSF on T1, deterministically', () => {
    const l3 = lm.vertL3
    const pl = plane([0, l3[1] + 20, l3[2] - 20], [0, 1, 0], [0, 0, -1], 320, 4)
    const canal: V3 = [0, l3[1] + 30, l3[2]]
    expect(ph.partTissue[labelAt(ph, ...canal)]).toBe(tissue('csf'))
    const px = Math.floor(((canal[1] - (l3[1] + 20)) / 320 + 0.5) * 256)
    const py = Math.floor((-(canal[2] - (l3[2] - 20)) / 320 + 0.5) * 256)
    const r = new MriRenderer()
    const t2 = r.render(ph, { plane: pl, seq: 'T2', coil: 'spine', snr: 1000, seed: 1, slice: 0, size: 256 })[py * 256 + px]
    const t1 = new MriRenderer().render(ph, { plane: pl, seq: 'T1', coil: 'spine', snr: 1000, seed: 1, slice: 0, size: 256 })[py * 256 + px]
    expect(t2).toBeGreaterThan(t1 + 60)
    const again = new MriRenderer().render(ph, { plane: pl, seq: 'T2', coil: 'spine', snr: 30, seed: 1, slice: 0, size: 256 })
    const twice = new MriRenderer().render(ph, { plane: pl, seq: 'T2', coil: 'spine', snr: 30, seed: 1, slice: 0, size: 256 })
    expect(Buffer.from(again).equals(Buffer.from(twice))).toBe(true)
  })
})

describe('X-ray', () => {
  it('shows bone whiter than soft tissue on an AP pelvis, black outside the collimation, deterministically', () => {
    const proj = { sx: 0, sy: -1000, sz: 60, dx: 0, dy: 160, dz: 60, ux: 1, uy: 0, uz: 0, vx: 0, vy: 0, vz: -1, width: 430, height: 430 }
    const req = { proj, kv: 75, spr: 1.6, photons: 1e6, fieldW: 0.9, fieldH: 0.7, seed: 3, size: 128 }
    const r = new XrayRenderer()
    const g = r.render(ph, req)
    // the femoral head versus the soft tissue between the hips
    const at = (l: number, s: number): number => {
      const x = Math.floor((l / 430 + 0.5) * 128)
      const y = Math.floor((-(s - 60) / 430 + 0.5) * 128)
      return g[y * 128 + x]
    }
    expect(at(96 * p.width, 0)).toBeGreaterThan(at(45 * p.width, -60) + 20)
    expect(g[2 * 128 + 2]).toBe(0)
    expect(Buffer.from(new XrayRenderer().render(ph, req)).equals(Buffer.from(g))).toBe(true)
  })
})
