import { describe, expect, it } from 'vitest'
import { PROTOCOLS } from '@/content/imaging'
import { mulberry32 } from '@/sim/rng'
import { BREAST_TUMOUR_MM, TUMOUR_EXTENT, US_APEX_Y, US_MAX_BLOBS, createUsScene, nthRandom, usScene, usViewOf, US_VIEWS, type UsScene } from './ultrasound'

const snapshot = (s: UsScene): string => JSON.stringify(s.blobs.slice(0, s.count))

describe('ultrasound geometry', () => {
  it('every sweep of every protocol maps to a view with the structure its name asks for', () => {
    const sweeps = Object.values(PROTOCOLS)
      .filter((p) => p.modality === 'us')
      .flatMap((p) => p.sequences.map((s) => ({ name: s.name, part: p.bodyPart })))
    expect(sweeps.length).toBeGreaterThan(6)
    for (const s of sweeps) expect(US_VIEWS).toContain(usViewOf(s.name, s.part))
    expect(usViewOf('Gallbladder sweep')).toBe('gallbladder')
    expect(usViewOf('Right kidney sweep')).toBe('kidneyR')
    expect(usViewOf('Left kidney sweep')).toBe('kidneyL')
    expect(usViewOf('Bladder sweep')).toBe('bladder')
    expect(usViewOf('Spleen sweep')).toBe('spleen')
    expect(usViewOf('Liver sweep')).toBe('liver')
    expect(usViewOf('Pancreas sweep')).toBe('pancreas')
    expect(usViewOf('Pancreas')).toBe('pancreas')
  })

  it('is deterministic for the same seed, phase and time', () => {
    for (const view of US_VIEWS) {
      const a = usScene(createUsScene(), view, 77, 0.4, 3.2)
      const b = usScene(createUsScene(), view, 77, 0.4, 3.2)
      expect(snapshot(a), view).toBe(snapshot(b))
      expect(a.count, view).toBeGreaterThan(2)
      expect(a.count, view).toBeLessThanOrEqual(US_MAX_BLOBS)
    }
  })

  it('the picture shifts as the probe moves (phase) and breathes (time)', () => {
    for (const view of US_VIEWS) {
      const start = usScene(createUsScene(), view, 5, 0.05, 1)
      const end = usScene(createUsScene(), view, 5, 0.95, 1)
      expect(snapshot(start), `${view}: phase`).not.toBe(snapshot(end))
      const t0 = usScene(createUsScene(), view, 5, 0.5, 0)
      const t1 = usScene(createUsScene(), view, 5, 0.5, 1.1)
      expect(snapshot(t0), `${view}: time`).not.toBe(snapshot(t1))
    }
  })

  it('stays inside the picture and reuses its scene object (no allocation per frame)', () => {
    const scene = createUsScene()
    const blobs = scene.blobs
    for (const view of US_VIEWS) {
      for (let i = 0; i <= 20; i++) {
        usScene(scene, view, 9, i / 20, i * 0.37)
        expect(scene.blobs).toBe(blobs)
        for (let k = 0; k < scene.count; k++) {
          const b = scene.blobs[k]
          expect(Math.abs(b.cx)).toBeLessThan(0.75)
          expect(b.cy).toBeGreaterThan(0)
          expect(b.cy).toBeLessThan(1.05)
          expect(b.echo).toBeGreaterThanOrEqual(0)
          expect(b.echo).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('fluid-filled structures are black with enhancement behind, a stone casts a shadow', () => {
    // the gallbladder view with a stone: some seed has one
    let found = false
    for (let seed = 1; seed < 60 && !found; seed++) {
      const s = usScene(createUsScene(), 'gallbladder', seed, 0.5, 0)
      const fluid = s.blobs.slice(0, s.count).find((b) => b.echo === 0 && b.behind > 0)
      expect(fluid).toBeDefined()
      if (s.blobs.slice(0, s.count).some((b) => b.behind < 0)) found = true
    }
    expect(found).toBe(true)
  })

  it('draws the same numbers as mulberry32, without a generator per frame', () => {
    for (const seed of [0, 1, 77, 0x9e3779b1, 123456789]) {
      const r = mulberry32(seed)
      for (let k = 0; k < 20; k++) expect(nthRandom(seed, k)).toBe(r())
    }
  })

  it('breast: a linear picture, the same for the same seed, with a ~1.2 cm dark tumour at about 2 cm in the gland', () => {
    expect(usViewOf('Probe placement', 'breast')).toBe('breast')
    expect(usViewOf('Freeze 1', 'breast')).toBe('breast')
    const tumourMm: number[] = []
    for (const seed of [3, 41, 977, 31337]) {
      const a = usScene(createUsScene(), 'breast', seed, 0.5, 2.5)
      const b = usScene(createUsScene(), 'breast', seed, 0.5, 2.5)
      expect(snapshot(a)).toBe(snapshot(b))
      expect(a.linear).toBe(true)
      expect(a.depthCm).toBe(5)
      expect(a.count).toBeGreaterThan(15)
      // the tumour: the scene's target, a dark blob there
      expect(a.tr).toBeGreaterThan(0)
      const d = (2 * a.tr) / TUMOUR_EXTENT / a.mm
      expect(d).toBeGreaterThanOrEqual(BREAST_TUMOUR_MM[0] - 0.01)
      expect(d).toBeLessThanOrEqual(BREAST_TUMOUR_MM[1] + 0.01)
      tumourMm.push(d)
      const depthMm = (a.ty - US_APEX_Y) / a.mm
      expect(depthMm).toBeGreaterThan(17)
      expect(depthMm).toBeLessThan(24)
      expect(Math.abs(a.tx)).toBeLessThan(0.1)
      const core = a.blobs.slice(0, a.count).find((k) => Math.abs(k.cx - a.tx) < 1e-9 && Math.abs(k.cy - a.ty) < 1e-9)
      expect(core?.echo).toBeLessThan(0.15)
      // ribs deep with their shadows, a bright layer (the gland) brighter than the fat
      const blobs = a.blobs.slice(0, a.count)
      expect(blobs.filter((k) => k.behind < 0 && k.cy > 0.75).length).toBe(2)
      expect(Math.max(...blobs.filter((k) => k.rx > 0.5 && k.cy < 0.5).map((k) => k.echo))).toBeGreaterThan(0.55)
      // the other views keep a zero target
      expect(usScene(createUsScene(), 'liver', seed, 0.5, 2.5).tr).toBe(0)
    }
    expect(new Set(tumourMm.map((x) => x.toFixed(2))).size).toBeGreaterThan(1)
  })
})
