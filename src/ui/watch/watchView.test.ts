import { describe, expect, it } from 'vitest'
import { scriptFor } from '@/content/procedures'
import { fillWatch, WATCH } from '@/content/watch'
import { captionModel, mmss, scriptCaption, scriptStepOf, stepRows, type CaptionView } from './watchView'

const ID = 'or-cholecystectomy' as const
const script = scriptFor(ID)!
const n = script.steps.length

function view(i: number): CaptionView {
  return { procedureId: ID, stepIndex: i, stepCount: n, stepId: script.steps[i].id, repeat: null }
}

describe('the watch caption', () => {
  it('says "Step k of n: caption" with the step\'s why, from the script', () => {
    const i = script.steps.findIndex((s) => s.id === 'placeClips')
    const m = captionModel({ status: 'case', mode: 'watch', procedureId: ID, view: view(i), startsAt: null, now: 0 })
    expect(m.title).toBe(`Step ${i + 1} of ${n}: ${script.steps[i].caption}`)
    expect(m.why).toBe(script.steps[i].why)
    expect(m.badge).toBe(WATCH.overlay.watchCase)
    expect(m.canSkip).toBe(false)
  })

  it('lists every step, done before the current one and upcoming after it', () => {
    const m = captionModel({ status: 'case', mode: 'follow', procedureId: null, view: view(5), startsAt: null, now: 0 })
    expect(m.badge).toBe(WATCH.overlay.live)
    expect(m.steps).toHaveLength(n)
    expect(m.steps.filter((s) => s.state === 'done')).toHaveLength(5)
    expect(m.steps[5].state).toBe('current')
    expect(m.steps.filter((s) => s.state === 'upcoming')).toHaveLength(n - 6)
    expect(m.steps.map((s) => s.label)).toEqual(script.steps.map((s) => s.caption))
  })

  it('counts down to a booked case and offers a skip only when it is far enough off', () => {
    const far = captionModel({ status: 'waiting', mode: 'watch', procedureId: ID, view: null, startsAt: 1000 + 252, now: 1000 })
    expect(far.title).toBe(fillWatch(WATCH.overlay.startsIn, { time: '4:12' }))
    expect(far.startsIn).toBe('4:12')
    expect(far.canSkip).toBe(true)
    expect(far.steps.every((s) => s.state === 'upcoming')).toBe(true)
    const near = captionModel({ status: 'waiting', mode: 'watch', procedureId: ID, view: null, startsAt: 1030, now: 1000 })
    expect(near.canSkip).toBe(false)
    const now = captionModel({ status: 'waiting', mode: 'watch', procedureId: ID, view: null, startsAt: 1000, now: 1000 })
    expect(now.title).toBe(WATCH.overlay.startingNow)
    const unknown = captionModel({ status: 'waiting', mode: 'follow', procedureId: null, view: null, startsAt: null, now: 0 })
    expect(unknown.title).toBe(WATCH.overlay.waiting)
    expect(unknown.steps).toEqual([])
  })

  it('while waiting, another case in the room is not captioned as ours', () => {
    const m = captionModel({ status: 'waiting', mode: 'watch', procedureId: ID, view: view(3), startsAt: 1200, now: 1000 })
    expect(m.title).not.toContain(script.steps[3].caption)
  })

  it('says the operation is over, with every step done', () => {
    const m = captionModel({ status: 'ended', mode: 'watch', procedureId: ID, view: null, startsAt: null, now: 0 })
    expect(m.title).toBe(WATCH.overlay.ended)
    expect(m.why).toBe(WATCH.overlay.endedWhy)
    expect(m.steps.every((s) => s.state === 'done')).toBe(true)
  })

  it('maps a flat step to its script step (the da Vinci has no repeats: the same index)', () => {
    for (let i = 0; i < n; i++) expect(scriptStepOf(ID, i)).toBe(i)
    expect(scriptStepOf(ID, n)).toBeNull()
    expect(scriptStepOf(ID, -1)).toBeNull()
    expect(stepRows(ID, 0)[0].state).toBe('current')
  })

  it('writes m:ss', () => {
    expect(mmss(0)).toBe('0:00')
    expect(mmss(59.2)).toBe('1:00')
    expect(mmss(605)).toBe('10:05')
    expect(mmss(-3)).toBe('0:00')
  })
})

describe('the watch caption of a repeated cryo step', () => {
  const CRYO = 'cryo-lung' as const
  const lung = scriptFor(CRYO)!
  const push = lung.steps.findIndex((s) => s.id === 'pushNeedle')
  const caption = lung.steps[push].caption

  it('fills the caption\'s own needle count, with no "(k of n)" after it and no raw brace', () => {
    expect(caption).toMatch(/\{k\}/)
    // needle 2 of 3: the flat index of the second play of the run (the run is the three repeat steps)
    const run = lung.steps.filter((s) => s.repeat === true).length
    const flat = push + run
    const v: CaptionView = { procedureId: CRYO, stepIndex: flat, stepCount: lung.steps.length + 2 * run, stepId: 'pushNeedle', repeat: { k: 2, n: 3 } }
    const m = captionModel({ status: 'case', mode: 'watch', procedureId: CRYO, view: v, startsAt: null, now: 0 })
    expect(m.title).toBe(`Step ${flat + 1} of ${v.stepCount}: ${caption.replace('{k}', '2').replace('{n}', '3')}`)
    expect(m.title).not.toMatch(/[{}]/)
    for (const row of m.steps) expect(row.label).not.toMatch(/[{}]/)
  })

  it('says 1 of 1 when a case has one needle (the view has no repeat marker then)', () => {
    const v: CaptionView = { procedureId: CRYO, stepIndex: push, stepCount: lung.steps.length, stepId: 'pushNeedle', repeat: null }
    const m = captionModel({ status: 'case', mode: 'watch', procedureId: CRYO, view: v, startsAt: null, now: 0 })
    expect(m.title).toContain(scriptCaption(caption, 1, 1))
    expect(m.title).not.toMatch(/[{}]/)
  })
})
