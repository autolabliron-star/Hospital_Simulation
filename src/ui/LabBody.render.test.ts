/**
 * The lab panel as markup, in node (react-dom/server): what the Lab room panel shows for the hospital as it starts (the live sim's lab, nothing on
 * the belt yet). No effects run here; the view model's behaviour with tubes in the lab is in labView.test.ts.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LAB_MODULE_IDS, LAB_UI } from '@/content/labUi'
import { LabBody } from './LabBody'

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

  it('says so when the lab is empty', () => {
    expect(out).toContain(LAB_UI.empty.samples)
    expect(out).toContain(LAB_UI.empty.results)
    expect(out).toContain(LAB_UI.empty.track)
  })
})
