/**
 * Your health card and the lobby panel's kiosk section as markup, in node (react-dom/server, no browser): the card fills in live while your session runs, then
 * is the printed slip; the section says who is on each kiosk. The views take plain view models, so no store or sim is needed.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { KIOSK_UI } from '@/content/kioskUi'
import type { HealthKioskPhase, HealthKioskState, VitalsReading } from '@/sim/types'
import { KioskSectionView } from '../KioskSection'
import { readCard, readKioskSection, resetKioskMemory, trackKiosk, type KioskSim } from '../kioskView'
import { HealthCardView } from './HealthCard'
import { useHealthCard } from './healthCard.store'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el)
const noop = (): void => undefined

function reading(over: Partial<VitalsReading> = {}): VitalsReading {
  return { id: 'r1', personId: 'player', personName: 'You', at: 0, source: 'player', station: 0, sys: null, dia: null, pulse: null, spo2: null, tempC: null, heightCm: null, weightKg: null, bmi: null, bodyFatPct: null, bp: [], partial: true, ...over }
}

function kiosk(index: number, phase: HealthKioskPhase, over: Partial<HealthKioskState> = {}): HealthKioskState {
  return { index, phase, phaseTime: 0, progress: 0.5, kind: phase === 'idle' ? null : 'player', userId: null, userName: null, bpRound: 0, cuff: 0, reading: null, assisted: false, sessionsToday: 0, version: 0, ...over }
}

const sim = (kiosks: HealthKioskState[], mine: VitalsReading[] = []): KioskSim => ({ vitals: { kiosks, readingsFor: (id) => (id === 'player' ? mine : []) } })

beforeEach(resetKioskMemory)

describe('the health card store', () => {
  it('opens on a kiosk and closes', () => {
    useHealthCard.getState().show(1)
    expect(useHealthCard.getState()).toMatchObject({ open: true, kiosk: 1 })
    useHealthCard.getState().close()
    expect(useHealthCard.getState().open).toBe(false)
  })
})

describe('your health card', () => {
  it('while your session runs: the step, a progress bar, the dots and the eight values with a dash for each one not measured yet', () => {
    const k = kiosk(0, 'bodyFat', { progress: 0.4, reading: reading({ heightCm: 180.2, weightKg: 80.1, bmi: 24.7 }) })
    const out = html(createElement(HealthCardView, { v: readCard(sim([k, kiosk(1, 'idle')]), 0), onClose: noop }))
    expect(out).toContain('Your health check')
    expect(out).toContain('Step: Body fat')
    expect(out).toContain('Hold both handles')
    expect(out).toContain('aria-valuenow="40"')
    expect(out).toContain('width:40%')
    for (const label of ['Height', 'Weight', 'BMI', 'Body fat', 'SpO₂', 'Pulse', 'Blood pressure', 'Temperature']) expect(out).toContain(label)
    expect(out).toContain('180')
    expect(out).toContain('80.1')
    expect(out).toContain('24.7')
    expect(out).toContain('—') // not measured yet
    expect(out).toContain('data-measured="false"')
    expect(out).toContain('data-current="true"') // the body-fat row
    expect(out).toContain('data-state="running"')
    expect(out).not.toContain('walk-health--slip')
    expect(out).not.toContain('Sent to triage')
    expect(out).toContain('Simulated')
    expect(out.match(/<li data-state=/g)?.length).toBe(9) // the dots
    expect(out).toContain(KIOSK_UI.card.close)
  })

  it('a value outside its usual range is marked, never worded', () => {
    const k = kiosk(0, 'bpRest', { reading: reading({ spo2: 90, bp: [[160, 100]], sys: 160, dia: 100 }) })
    const out = html(createElement(HealthCardView, { v: readCard(sim([k, kiosk(1, 'idle')]), 0), onClose: noop }))
    expect(out).toContain('data-out="true"')
    expect(out).not.toMatch(/\b(low|high|normal|abnormal|warning)\b/i)
  })

  it('after the session it is the thermal slip: every value, the cuff readings, "Sent to triage · Simulated"', () => {
    const full = reading({ heightCm: 172, weightKg: 71.4, bmi: 24.1, bodyFatPct: 22, spo2: 98, pulse: 72, tempC: 36.6, bp: [[124, 79], [126, 80]], sys: 125, dia: 80, partial: false })
    const out = html(createElement(HealthCardView, { v: readCard(sim([kiosk(0, 'idle'), kiosk(1, 'idle')], [full]), 0), onClose: noop }))
    expect(out).toContain('walk-health--slip')
    expect(out).toContain('data-state="done"')
    expect(out).toContain('Health report')
    expect(out).toContain('Sent to triage · Simulated')
    expect(out).toContain('125/80')
    expect(out).toContain('36.6')
    expect(out).toContain('Reading 1: 124/79')
    expect(out).toContain('Reading 2: 126/80')
    expect(out).not.toContain('role="progressbar"')
    expect(out).not.toContain('—')
    expect(out).toContain('Simulated, not real patient data')
  })

  it('a session cut short is a partial slip that says so', () => {
    const out = html(createElement(HealthCardView, { v: readCard(sim([kiosk(0, 'idle'), kiosk(1, 'idle')], [reading({ heightCm: 175, weightKg: 77, partial: true })]), 0), onClose: noop }))
    expect(out).toContain('data-state="stopped"')
    expect(out).toContain(KIOSK_UI.card.stopped)
    expect(out).not.toContain('Sent to triage')
    expect(out).toContain('—')
  })

  it('has an accessible close button', () => {
    const out = html(createElement(HealthCardView, { v: readCard(sim([kiosk(0, 'idle'), kiosk(1, 'idle')]), 0), onClose: noop }))
    expect(out).toContain('aria-label="Close"')
    expect(out).toContain('title="Close the health report"')
  })
})

describe('the lobby panel\'s kiosk section', () => {
  it('lists both kiosks: who is on, the step, the sessions today, the last result, and the disclaimer', () => {
    const busy = kiosk(0, 'temp', { kind: 'full', userName: 'Ana Reyes', sessionsToday: 12, assisted: true })
    const free = kiosk(1, 'idle', { sessionsToday: 4 })
    const s = sim([busy, free])
    free.reading = reading({ spo2: 97, tempC: 36.5, bp: [[118, 76]], sys: 118, dia: 76, partial: false })
    trackKiosk(free)
    free.reading = null
    trackKiosk(free)
    const out = html(createElement(KioskSectionView, { v: readKioskSection(s) }))
    expect(out).toContain('Health kiosks')
    expect(out).toContain('Ana Reyes · Temperature')
    expect(out).toContain('with the guide')
    expect(out).toContain('12 today')
    expect(out).toContain('Free')
    expect(out).toContain('Last: BP 118/76 · SpO₂ 97% · 36.5 °C')
    expect(out).toContain('No sessions yet')
    expect(out).toContain('Simulated, not real patient data')
  })
})
