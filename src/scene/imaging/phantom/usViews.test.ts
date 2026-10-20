/** R3: every view's window is on the skin and its sweep passes through its organ, for many patients. */
import { describe, expect, it } from 'vitest'
import { RenderCore } from '../worker/core'
import { patientParams } from './params'
import { distanceToSkin, newProbeFrame, viewFrame, viewSpec, type UsViewId } from './usViews'

const VIEWS: UsViewId[] = ['liver', 'gallbladder', 'kidneyR', 'kidneyL', 'spleen', 'bladder']
const ORGAN: Record<UsViewId, 'liver' | 'gallbladder' | 'kidney' | 'spleen' | 'bladder'> = { liver: 'liver', gallbladder: 'gallbladder', kidneyR: 'kidney', kidneyL: 'kidney', spleen: 'spleen', bladder: 'bladder' }

describe('ultrasound views', () => {
  it('put the face on the skin for every patient', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const p = patientParams(seed * 7919)
      for (const v of VIEWS) {
        const f = viewFrame(viewSpec(v, p), p, 0.5, 0, 1, newProbeFrame())
        // from just inside the face, the skin is a few millimetres back along the beam
        const back = distanceToSkin(p, [f.ox + f.bx * 2, f.oy + f.by * 2, f.oz + f.bz * 2], [f.bx, f.by, f.bz])
        expect(back, `${v} seed ${seed}`).toBeGreaterThan(0.5)
        expect(back, `${v} seed ${seed}`).toBeLessThan(8)
      }
    }
  })

  it('show their organ in the middle of the sweep', () => {
    const core = new RenderCore()
    for (const seed of [11, 4242, 90001]) {
      const p = patientParams(seed)
      for (const v of VIEWS) {
        const spec = viewSpec(v, p)
        const f = viewFrame(spec, p, 0.5, 0, 1, newProbeFrame())
        const r = core.renderUs({ t: 'us', slot: 'test', id: 1, seed, frame: f, depth: spec.depth, time: 0, n: 0, lite: true, size: 128 })
        expect(r.meta[ORGAN[v]], `${v} seed ${seed}`).toBeGreaterThan(0.04)
      }
    }
  }, 60_000)
})
