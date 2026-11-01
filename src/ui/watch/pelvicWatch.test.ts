/**
 * R5 wave 2: the watch UI offers the two pelvic operations as it offers the gallbladder's: the room panel's picker lists all three robotic operations with their
 * length as watched (each from its own script), and the caption bar and the step list read each script's steps ("Step k of n: ..."), their "why" lines and every
 * step in order.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { scriptFor } from '@/content/procedures'
import { WATCH } from '@/content/watch'
import { watchTotalSeconds, compiledFor } from '@/sim/procedure'
import type { ProcedureId } from '@/sim/types'
import { pickerItems, WatchPickerView, type WatchPickerViewProps } from './WatchPicker'
import { captionModel, stepRows } from './watchView'

const PELVIC = ['or-hysterectomy', 'or-prostatectomy'] as const satisfies readonly ProcedureId[]
const noop = () => undefined

describe('the picker offers the pelvic operations', () => {
  const items = pickerItems('or')

  it('lists the three robotic operations of the theatre, each with its own title, detail and watch length', () => {
    expect(items.map((i) => i.id)).toEqual(['or-cholecystectomy', 'or-hysterectomy', 'or-prostatectomy'])
    for (const id of PELVIC) {
      const item = items.find((i) => i.id === id)!
      expect(item.title).toBe(WATCH.procedures[id].title)
      expect(item.detail).toBe(WATCH.procedures[id].detail)
      // (about 11 minutes: 600-900 s)
      expect(item.minutes).toBe(`about ${Math.round(watchTotalSeconds(compiledFor(id)!) / 60)} min`)
      expect(Number(/\d+/.exec(item.minutes)![0])).toBeGreaterThanOrEqual(10)
      expect(Number(/\d+/.exec(item.minutes)![0])).toBeLessThanOrEqual(15)
    }
  })

  it('shows a button for each when the panel is open', () => {
    const base: WatchPickerViewProps = { room: 'or', open: true, items, answer: null, onToggle: noop, onPick: noop, onFollow: noop, onFromStart: noop, onBack: noop }
    const html = renderToStaticMarkup(createElement(WatchPickerView, base))
    expect((html.match(/<button/g) ?? []).length).toBe(1 + items.length)
    for (const id of PELVIC) expect(html).toContain(WATCH.procedures[id].title)
  })
})

describe.each(PELVIC)('the caption and the step list of %s', (id) => {
  const script = scriptFor(id)!
  const n = script.steps.length

  it('says "Step k of n: caption" with the step\'s why, for every step', () => {
    script.steps.forEach((step, i) => {
      const m = captionModel({ status: 'case', mode: 'watch', procedureId: id, view: { procedureId: id, stepIndex: i, stepCount: n, stepId: step.id, repeat: null }, startsAt: null, now: 0 })
      expect(m.title, step.id).toBe(`Step ${i + 1} of ${n}: ${step.caption}`)
      expect(m.why, step.id).toBe(step.why)
    })
  })

  it('lists every step, in order, done before the current one and upcoming after it', () => {
    const rows = stepRows(id, 9)
    expect(rows.map((r) => r.label)).toEqual(script.steps.map((s) => s.caption))
    expect(rows.filter((r) => r.state === 'done')).toHaveLength(9)
    expect(rows[9].state).toBe('current')
    expect(rows.filter((r) => r.state === 'upcoming')).toHaveLength(n - 10)
  })
})
