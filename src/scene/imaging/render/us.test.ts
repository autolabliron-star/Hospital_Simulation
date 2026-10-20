/**
 * R3: the ultrasound renderer on the synthetic body. The picture is deterministic, a kidney looks like a kidney (bright sinus, darker cortex,
 * darker still pyramids), fluid is black, and a probe off the skin sees only its own reverberation.
 */
import { describe, expect, it } from 'vitest'
import { BodyBuilder } from '../phantom/body'
import { patientParams } from '../phantom/params'
import { buildRegions, regionsFor } from '../phantom/regions'
import { tissue } from '../phantom/tissues'
import { newProbeFrame, viewFrame, viewSpec, type UsViewId } from '../phantom/usViews'
import { US_FULL, US_LITE, UsRenderer, type UsFrame } from './us'

const p = patientParams(12345)
const b = new BodyBuilder()
buildRegions(b, p, regionsFor('us', 'kidneys'))
const ph = b.compile()

function frame(view: UsViewId, detail = 0.5, contact = 1, lite = true, n = 1): UsFrame {
  const spec = viewSpec(view, p)
  const f = viewFrame(spec, p, detail, 0, contact, newProbeFrame())
  // out of contact the face is lifted off the skin (motion.ts does the same)
  const lift = 30 * (1 - contact)
  f.ox -= f.bx * lift
  f.oy -= f.by * lift
  f.oz -= f.bz * lift
  return new UsRenderer().render(ph, p, { frame: f, depth: spec.depth, focus: spec.depth * 0.55, t: 1.2, n, preset: lite ? US_LITE : US_FULL, size: 256 })
}

describe('the ultrasound renderer', () => {
  it('gives the same bytes for the same request, and new noise for a new frame number', () => {
    const a = frame('kidneyR', 0.5, 1, true, 3)
    const c = frame('kidneyR', 0.5, 1, true, 3)
    const d = frame('kidneyR', 0.5, 1, true, 4)
    expect(Buffer.from(a.grey).equals(Buffer.from(c.grey))).toBe(true)
    expect(Buffer.from(a.grey).equals(Buffer.from(d.grey))).toBe(false)
  })

  it('shows the right kidney under the flank probe: bright sinus, darker cortex, darkest pyramids', () => {
    const f = frame('kidneyR', 0.5, 1, false)
    const share = (t: string) => f.tissueShare[tissue(t)]
    expect(share('kidneyCortex') + share('kidneyMedulla') + share('sinusFat')).toBeGreaterThan(0.12)
    const g = (t: string) => f.tissueGrey[tissue(t)]
    expect(g('sinusFat')).toBeGreaterThan(g('kidneyCortex') + 25)
    expect(g('kidneyMedulla')).toBeLessThan(g('kidneyCortex'))
    expect(g('perirenalFat')).toBeGreaterThan(g('kidneyCortex'))
  })

  it('shows fluid black: the full bladder and the gallbladder', () => {
    const bl = frame('bladder')
    expect(bl.tissueShare[tissue('urine')]).toBeGreaterThan(0.08)
    expect(bl.tissueGrey[tissue('urine')]).toBeLessThan(45)
    const gb = frame('gallbladder')
    expect(gb.tissueShare[tissue('bile')]).toBeGreaterThan(0.03)
    expect(gb.tissueGrey[tissue('bile')]).toBeLessThan(gb.tissueGrey[tissue('liver')] - 40)
  })

  it('a probe off the skin sees nothing below its own ring-down', () => {
    const f = frame('kidneyR', 0.5, 0)
    // the lower half of the fan is black
    let sum = 0
    let n = 0
    for (let y = 160; y < 230; y++)
      for (let x = 60; x < 196; x++) {
        sum += f.grey[y * 256 + x]
        n++
      }
    expect(sum / n).toBeLessThan(12)
  })
})
