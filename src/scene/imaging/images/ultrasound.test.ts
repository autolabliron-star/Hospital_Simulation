import { describe, expect, it } from 'vitest'
import { PROTOCOLS } from '@/content/imaging'
import { US_MAX_BLOBS, createUsScene, usScene, usViewOf, US_VIEWS, type UsScene } from './ultrasound'

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
})
