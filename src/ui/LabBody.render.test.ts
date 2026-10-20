/**
 * The lab panel as markup, in node (react-dom/server): what the Lab room panel shows for the hospital as it starts (the live sim's lab; S1: the showcase
 * opening may already have tubes on the belt). No effects run here; the view model's behaviour with tubes in the lab is in labView.test.ts.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LAB_MODULE_IDS, LAB_UI } from '@/content/labUi'
import { sim } from '@/sim'
import { LabBody } from './LabBody'
import { labView } from './labView'

const out = renderToStaticMarkup(createElement(LabBody))

describe('the lab panel', () => {
  it('says "Simulated", the four numbers, the five sections and the button', () => {
    expect(out).toContain('Simulated, not real patient data')
    for (const k of Object.values(LAB_UI.kpi)) expect(out, k).toContain(k)
    for (const s of Object.values(LAB_UI.sections)) expect(out, s).toContain(s)
    expect(out).toContain(`>${LAB_UI.send.button}<`)
    expect(out).not.toContain('disabled')
  })

  it('draws the track board with a box for every module, named for a screen reader and a tooltip', () => {
    expect(out).toContain('class="lb-board"')
    expect(out).toContain('role="img"')
    for (const id of LAB_MODULE_IDS) {
      expect(out, id).toContain(`<title>${LAB_UI.module[id]}: `)
      expect(out, id).toContain(`>${LAB_UI.moduleShort[id].replace(' °C', '')}`)
    }
    expect(out.match(/class="lb-module"/g)!.length).toBe(LAB_MODULE_IDS.length)
    expect(out).toContain('d="M ')
  })

  // S1: the showcase opening may already have tubes in the lab, so the empty notes follow the live lab's view model
  it('says so when the lab is empty, and only then', () => {
    const v = labView(sim.lab, sim.t)
    const shows = (text: string, empty: boolean) => (empty ? expect(out).toContain(text) : expect(out).not.toContain(text))
    shows(LAB_UI.empty.samples, v.samples.length === 0)
    shows(LAB_UI.empty.results, v.results.length === 0)
    shows(LAB_UI.empty.track, v.track.empty)
  })
})
