/**
 * R5 fix K6: the Scan viewer's device card follows the case. During a fibroadenoma case it is the benign lump's card (the company's statement of
 * clearance for fibroadenomas, "lump"); during the breast cancer's it keeps the FDA authorisation of October 2025 and "tumour".
 * (A .test.ts, like the other render tests: vite.config.ts collects only `*.test.ts`, so the .tsx it was first written as never ran.)
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { Simulation } from '@/sim/Simulation'
import { imagingOf, scannerView } from './roomSnapshot'
import { CryoCard } from './ScanViewer'

const DT = CONFIG.sim.step

describe('the device card per case', () => {
  it('renders the breast cancer\'s card by default and the fibroadenoma\'s on request', () => {
    const cancer = renderToStaticMarkup(createElement(CryoCard))
    expect(cancer).toContain('FDA authorised October 2025')
    expect(cancer).toContain('tumour')
    const benign = renderToStaticMarkup(createElement(CryoCard, { kind: 'fibroadenoma' }))
    expect(benign).toContain('IceCure states FDA clearance for fibroadenomas')
    expect(benign).toContain('benign lump')
    expect(benign).not.toMatch(/tumour|breast cancer|70 and over|hormone therapy/)
    expect(benign).toContain('Synthetic patient')
    expect(cancer).toContain('Synthetic patient')
  })

  it.each([
    ['us-cryo-breast', 'breastCancer'],
    ['us-cryo-fibroadenoma', 'fibroadenoma'],
  ] as const)('the viewer snapshot of a %s case says which card (%s), and none when the room is empty or scanning', { timeout: 300_000 }, (protocol, kind) => {
    const sim = new Simulation(7, { startHour: 10, inFlight: false })
    const img = imagingOf(sim)!
    expect(scannerView(img, 'us', sim.t).cryoKind).toBeNull()
    expect(img.startDemoScan('us', protocol)).toBe(true)
    for (let i = 0; i < Math.round(30 / DT); i++) sim.step(DT)
    const view = scannerView(img, 'us', sim.t)
    expect(view.cryo).toBe(true)
    expect(view.cryoKind).toBe(kind)
    // an ordinary scan (the rotation's next ultrasound demo) has no card
    const plain = new Simulation(7, { startHour: 10, inFlight: false })
    expect(imagingOf(plain)!.startDemoScan('us')).toBe(true)
    for (let i = 0; i < Math.round(30 / DT); i++) plain.step(DT)
    const v = scannerView(imagingOf(plain)!, 'us', plain.t)
    expect(v.cryo).toBe(false)
    expect(v.cryoKind).toBeNull()
  })
})
