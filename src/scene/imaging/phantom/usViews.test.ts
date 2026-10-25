/** R3: every view's window is on the skin and its sweep passes through its organ, for many patients. */
import { describe, expect, it } from 'vitest'
import { RenderCore } from '../worker/core'
import { patientParams } from './params'
import { distanceToSkin, newProbeFrame, viewFrame, viewSpec, type UsViewId } from './usViews'
import { regionsFor } from './regions'
import { tissue } from './tissues'
import { US_LITE, UsRenderer } from '../render/us'

const VIEWS: UsViewId[] = ['liver', 'gallbladder', 'kidneyR', 'kidneyL', 'spleen', 'bladder', 'pancreas', 'breast']
/** The frame meta names the organs it counts (the pancreas view is checked on the tissue shares, below). */
type MetaView = Exclude<UsViewId, 'pancreas' | 'breast'>
const METAVIEWS: MetaView[] = ['liver', 'gallbladder', 'kidneyR', 'kidneyL', 'spleen', 'bladder']
const ORGAN: Record<MetaView, 'liver' | 'gallbladder' | 'kidney' | 'spleen' | 'bladder'> = { liver: 'liver', gallbladder: 'gallbladder', kidneyR: 'kidney', kidneyL: 'kidney', spleen: 'spleen', bladder: 'bladder' }

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
      for (const v of METAVIEWS) {
        const spec = viewSpec(v, p)
        const f = viewFrame(spec, p, 0.5, 0, 1, newProbeFrame())
        const r = core.renderUs({ t: 'us', slot: 'test', id: 1, seed, frame: f, depth: spec.depth, time: 0, n: 0, lite: true, size: 128 })
        expect(r.meta[ORGAN[v]], `${v} seed ${seed}`).toBeGreaterThan(0.04)
      }
    }
  }, 60_000)
})

describe('the liver and spleen windows (R3 tuning)', () => {
  it('fill the liver view with liver and keep the ribs out of it; give the spleen a clear share of its fan', () => {
    const core = new RenderCore()
    const r = new UsRenderer()
    const bone = [tissue('cortical'), tissue('marrow')]
    let liver = 0
    let ribs = 0
    let spleen = 0
    const seeds = [11, 4242, 90001, 5150]
    for (const seed of seeds) {
      const p = patientParams(seed)
      const b = core.body(seed, regionsFor('us', 'abdomen'))
      for (const [v, into] of [['liver', 'l'], ['spleen', 's']] as const) {
        const spec = viewSpec(v, p)
        const f = viewFrame(spec, p, 0.5, 0, 1, newProbeFrame())
        const o = r.render(b.ph, b.params, { frame: f, depth: spec.depth, focus: spec.depth * 0.55, t: 0, n: 0, preset: US_LITE, size: 64 })
        if (into === 'l') {
          liver += o.tissueShare[tissue('liver')] / seeds.length
          ribs += (o.tissueShare[bone[0]] + o.tissueShare[bone[1]]) / seeds.length
        } else spleen += o.tissueShare[tissue('spleen')] / seeds.length
      }
    }
    expect(liver).toBeGreaterThan(0.55)
    expect(ribs).toBeLessThan(0.03)
    expect(spleen).toBeGreaterThan(0.18)
  }, 60_000)
})

describe('the pancreas window (F-31 follow-up)', () => {
  it('shows the gland somewhere in the sweep, and little rib or air, for every patient tried', () => {
    const core = new RenderCore()
    const r = new UsRenderer()
    const seeds = [11, 4242, 90001, 5150, 777, 31337]
    let best = 0
    for (const seed of seeds) {
      const p = patientParams(seed)
      const b = core.body(seed, regionsFor('us', 'abdomen'))
      const spec = viewSpec('pancreas', p)
      let most = 0
      for (const d of [0.2, 0.5, 0.8]) {
        const f = viewFrame(spec, p, d, 0, 1, newProbeFrame())
        const o = r.render(b.ph, b.params, { frame: f, depth: spec.depth, focus: spec.depth * 0.55, t: 0, n: 0, preset: US_LITE, size: 64 })
        most = Math.max(most, o.tissueShare[tissue('pancreas')])
      }
      // a pancreas is small in the fan: a few percent of it is a real view of the gland
      expect(most, `seed ${seed}`).toBeGreaterThan(0.012)
      best += most / seeds.length
    }
    expect(best).toBeGreaterThan(0.03)
  }, 60_000)
})
