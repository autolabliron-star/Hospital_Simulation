/**
 * The ultrasound room's "Start a cryoablation" while the room is busy with the morning list: it books the cryoablation next (a demo
 * goes to the front of the queue), the viewer says so, and the cryoablation is the very next exam in the room.
 */
import { describe, expect, it } from 'vitest'
import { CONFIG } from '@/sim/config'
import { buildSimulation } from '@/sim/index'
import { imagingOf, scannerView } from './roomSnapshot'

const DT = CONFIG.sim.step

describe('a cryoablation booked while the ultrasound is busy', () => {
  it('shows as booked, then runs right after the current patient', { timeout: 300_000 }, () => {
    const sim = buildSimulation(CONFIG.sim.worldSeed, undefined, 0, 'showcase')
    const img = imagingOf(sim)!
    const us = sim.imaging.scanners.us
    expect(scannerView(img, 'us', sim.t).busy).toBe(true)
    const current = us.exam?.patientName
    expect(current).toBeTruthy()

    expect(img.startDemoScan('us', 'us-cryo-breast')).toBe(true)
    for (let i = 0; i < Math.round((CONFIG.imaging.demoArrivalSeconds + 5) / DT); i++) sim.step(DT)
    const view = scannerView(img, 'us', sim.t)
    expect(view.cryoQueued).toBe(true)
    expect(view.cryo).toBe(false)

    // run until the next exam starts in the room: it must be the cryoablation
    let next: string | null = null
    for (let i = 0; i < Math.round(1800 / DT) && next === null; i++) {
      sim.step(DT)
      if (us.exam && us.exam.patientName !== current) next = us.exam.protocol
    }
    expect(next).toMatch(/cryoablation/i)
    const during = scannerView(img, 'us', sim.t)
    expect(during.cryo).toBe(true)
    expect(during.cryoQueued).toBe(false)
  })
})
