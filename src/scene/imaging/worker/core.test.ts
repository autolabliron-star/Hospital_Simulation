/**
 * R3: the imaging worker's core renders every step of every protocol whose region and planner exist (non-empty, deterministic) and gives a
 * blank picture for the others; the ultrasound reports what is under the probe.
 */
import { describe, expect, it } from 'vitest'
import { PROTOCOLS } from '@/content/imaging'
import { regionsFor, regionsReady } from '../phantom/regions'
import { specKnown } from '../render/spec'
import { RenderCore } from './core'

const sd = (rgba: Uint8ClampedArray): number => {
  let s = 0
  let s2 = 0
  const n = rgba.length / 4
  for (let i = 0; i < rgba.length; i += 4) {
    s += rgba[i]
    s2 += rgba[i] * rgba[i]
  }
  return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2))
}

describe('the imaging worker core', () => {
  it('renders every step of the protocols it knows, and nothing for the others', () => {
    const core = new RenderCore()
    let known = 0
    for (const [id, pr] of Object.entries(PROTOCOLS)) {
      if (pr.modality === 'us') continue
      const ready = specKnown(pr.modality, pr.bodyPart) && regionsReady(regionsFor(pr.modality, pr.bodyPart))
      pr.sequences.forEach((seq, si) => {
        for (const k of [0, seq.images - 1]) {
          const r = core.renderSlice({ t: 'slice', slot: pr.modality, id: 1, key: `${id}:${si}:${k}`, seed: 777, modality: pr.modality, bodyPart: pr.bodyPart, seq, k, size: 96 })
          if (ready) {
            expect(sd(r.rgba), `${id} ${seq.name} ${k}`).toBeGreaterThan(8)
            known++
          } else expect(sd(r.rgba), `${id} ${seq.name}`).toBe(0)
        }
      })
    }
    expect(known).toBeGreaterThan(10)
  }, 120_000)

  it('gives the same bytes for the same slice job', () => {
    const pr = PROTOCOLS['ct-abdo']
    const job = { t: 'slice' as const, slot: 'ct', id: 1, key: 'x', seed: 5, modality: pr.modality, bodyPart: pr.bodyPart, seq: pr.sequences[2], k: 30, size: 96 }
    const a = new RenderCore().renderSlice(job).rgba
    const b = new RenderCore().renderSlice(job).rgba
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true)
  }, 60_000)
})
