/**
 * The record on the tablet as markup, in node (react-dom/server): the banner with the allergy badge, the three sections, the filters, an empty bed,
 * and the tablet's Record tab itself. The record comes from a real hospital at 07:30 (no steps needed: the days before are drawn).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/Simulation'
import { recordForRoom, type PatientRecordData } from '@/sim/records/record'
import { useRx } from '../../walk/rx.store'
import { PrescribePanel } from '../PrescribePanel'
import { RecordBodyView } from './RecordPanel'
import { recordView, RECORD_FILTERS, type RecordSection } from './recordView'

const noop = (): void => undefined
const html = (data: PatientRecordData | null, section: RecordSection = 'summary', filter: Parameters<typeof recordView>[1] = 'all') =>
  renderToStaticMarkup(createElement(RecordBodyView, { view: recordView(data, filter), section, onSection: noop, onFilter: noop }))

let sim: Simulation

beforeAll(() => {
  sim = new Simulation(2026)
}, 120_000)

describe('the record view', () => {
  it('shows the allergy badge in the banner, prominently, with the reaction (A2: penicillin)', () => {
    const out = html(recordForRoom(sim, 'A2'))
    expect(out).toContain('Bruno Varga')
    expect(out).toMatch(/class="rec-allergy" data-on="true"[^>]*><span class="rec-allergy__title">Allergies<\/span><span class="rec-allergy__items">Penicillin \(rash\)/)
    expect(out).toMatch(/SYN-\d{3}-\d{4}/)
    expect(out).toContain('Day 3 of stay')
    expect(out).toContain('Cardiology · Dr. Levi')
    expect(out).toContain('Synthetic demo patient')
  })

  it('says "No known drug allergies" for a patient without any (A4)', () => {
    const out = html(recordForRoom(sim, 'A4'))
    expect(out).toContain('No known drug allergies')
    expect(out).toContain('data-on="false"')
    // an anticoagulant and a high falls risk are flagged
    expect(out).toContain('On an anticoagulant (Apixaban)')
    expect(out).toContain('High falls risk')
  })

  it('summary: latest observations with NEWS2 (display only), problems, medicines with their next dose, plan', () => {
    const out = html(recordForRoom(sim, 'B3'))
    expect(out).toMatch(/NEWS2 \d+/)
    expect(out).toContain('Display only')
    expect(out).toContain('rec-spark')
    expect(out).toContain('Furosemide')
    expect(out).toMatch(/next \d\d:\d\d/)
    expect(out).toContain('Daily weights and fluid balance chart')
  })

  it('this stay: the timeline, newest first, with a filter per kind', () => {
    const data = recordForRoom(sim, 'B3')!
    const out = html(data, 'stay')
    for (const label of ['All', 'Meds', 'Obs', 'Results', 'Imaging', 'Notes', 'Movements']) expect(out).toContain(label)
    expect(out).toContain('Arrived at the ER')
    for (const f of RECORD_FILTERS) {
      if (f === 'all') continue
      const v = recordView(data, f)
      expect(v.entries.every((e) => e.kind === f)).toBe(true)
    }
    expect(recordView(data, 'all').entries.length).toBe(data.entries.length)
  })

  it('history: allergies, past conditions and procedures, home medicines, social and immunisations', () => {
    const out = html(recordForRoom(sim, 'B8'), 'history')
    for (const h of ['Allergies and intolerances', 'Past medical history', 'Past procedures', 'Usual (home) medicines', 'Social', 'Immunisations']) expect(out).toContain(h)
    expect(out).toContain('Trimethoprim')
  })

  it('says so for an empty bed', () => {
    expect(html(null)).toContain('No patient in this bed right now.')
  })

  it('is the tablet\'s Record tab, next to Prescribe', () => {
    const out = renderToStaticMarkup(createElement(PrescribePanel, { onClose: noop, initialRoom: 'A2', walk: true, tab: 'record' }))
    expect(out).toContain('data-tab="record"')
    expect(out).toContain('role="tablist"')
    expect(out).toContain('rec-banner')
    expect(out).toContain('Penicillin (rash)')
    const rx = renderToStaticMarkup(createElement(PrescribePanel, { onClose: noop, initialRoom: 'A2', walk: true, tab: 'prescribe' }))
    expect(rx).toContain('hud-meds__list')
    expect(rx).not.toContain('rec-banner')
    // the medicine A2 is allergic to carries the tag in the list
    expect(rx).toMatch(/Amoxicillin<span class="hud-med__allergy"[^>]*>Allergy<\/span>/)
  })

  it('every bedside opening starts on Record; the tab picked is kept only within one opening', () => {
    useRx.getState().openFor('B3')
    expect(useRx.getState().tab).toBe('record')
    useRx.getState().setTab('prescribe')
    expect(useRx.getState().tab).toBe('prescribe')
    useRx.getState().close()
    expect(useRx.getState().tab).toBe('prescribe')
    // the next bedside E starts on Record again, whatever tab was left
    useRx.getState().openFor('B4')
    expect(useRx.getState().tab).toBe('record')
    // an explicit tab wins; opened without a room (P, the pill) it is Prescribe
    useRx.getState().openFor('B4', 'prescribe')
    expect(useRx.getState().tab).toBe('prescribe')
    useRx.getState().close()
    useRx.getState().setTab('record')
    useRx.getState().toggle()
    expect(useRx.getState().tab).toBe('prescribe')
    useRx.getState().close()
  })

  it('the Record tab has its own height and a sticky header: the banner and section buttons sit outside the scroll area', () => {
    const out = html(recordForRoom(sim, 'A2'))
    expect(out.indexOf('rec-banner')).toBeLessThan(out.indexOf('rec-scroll'))
    expect(out.indexOf('rec-sections')).toBeLessThan(out.indexOf('rec-scroll'))
    expect(out.indexOf('class="rec-banner"')).toBeGreaterThanOrEqual(0)
    // the banner is not inside the scroll container
    const scroll = out.slice(out.indexOf('class="rec-scroll"'))
    expect(scroll).not.toContain('rec-banner')
  })
})
