/** R5: the skip targets while you watch a procedure step by step (skipModel.ts). */
import { describe, expect, it } from 'vitest'
import { fillWatch, WATCH } from '@/content/watch'
import { CONFIG } from '@/sim/config'
import { clockText } from '@/sim/events'
import { DEFAULT_SKIP_CTX, contextTarget, requestFor, rowModel, skipTargets, watchTarget, type SkipView } from './skipModel'

const LIMIT = (CONFIG.day.endHour - CONFIG.sim.startHour) * 3600
const LEAD = CONFIG.skip.milestoneLeadSeconds

const view = (over: Partial<SkipView> = {}): SkipView => ({
  nowT: 3600,
  limitT: LIMIT,
  playerArea: 'l2Corridor',
  overviewLevel: null,
  panelArea: null,
  cases: [],
  scanners: {},
  ...over,
})

describe('skips while watching (R5)', () => {
  it('only the live steps, and no day milestone: a rebuild would drop the watch case', () => {
    const watching = skipTargets(view({ watching: true }))
    for (const t of watching) expect(t.toT - 3600).toBeLessThanOrEqual(CONFIG.skip.liveMaxSeconds)
    expect(watching.some((t) => t.kind === 'surgery')).toBe(false)
    // not watching: the long steps are back
    expect(skipTargets(view()).some((t) => t.toT - 3600 > CONFIG.skip.liveMaxSeconds)).toBe(true)
  })

  it('offers the booked watch case\'s start, a lead before it, as the context target', () => {
    const at = 3600 + 1500
    const targets = skipTargets(view({ watching: true, watchStartsAt: at }))
    const w = contextTarget(targets)!
    expect(w.kind).toBe('watch')
    expect(w.toT).toBe(at - LEAD)
    expect(w.label).toBe(fillWatch(WATCH.overlay.skipLabel, { time: clockText(at) }))
    expect(w.caption).toBe(WATCH.overlay.skipCaption)
    expect(rowModel(targets).context).toEqual({ label: w.label, kind: 'watch' })
    // far off it rebuilds (the watch flow books the case again), near it runs live
    expect(requestFor(w, 3600).mode).toBe('rebuild')
    const near = watchTarget(view({ watching: true, watchStartsAt: 3600 + 120 }))!
    expect(requestFor(near, 3600).mode).toBe('live')
  })

  it('nothing to skip to when none is booked, it is about to start, or nobody is watching', () => {
    expect(watchTarget(view({ watching: true, watchStartsAt: null }))).toBeNull()
    expect(watchTarget(view({ watching: true, watchStartsAt: 3600 + LEAD + 2 }))).toBeNull()
    expect(skipTargets(view({ watchStartsAt: 3600 + 1500 })).some((t) => t.kind === 'watch')).toBe(false)
    expect(DEFAULT_SKIP_CTX.leadSeconds).toBe(LEAD)
  })

  it('names the room being watched in the skip\'s caption (R5 wave 3): the CT suite and the ultrasound room get ready; the theatre\'s words are unchanged', () => {
    const at = 3600 + 1500
    const caption = (watchRoom?: 'or' | 'cryo' | 'us' | null) => watchTarget(view({ watching: true, watchStartsAt: at, watchRoom }))!.caption
    expect(caption()).toBe(WATCH.overlay.skipCaption)
    expect(caption(null)).toBe(WATCH.overlay.skipCaption)
    expect(caption('or')).toBe(WATCH.overlay.skipCaption)
    expect(caption('cryo')).toBe(WATCH.overlayRooms.cryo.skipCaption)
    expect(caption('us')).toBe(WATCH.overlayRooms.us.skipCaption)
    expect(caption('cryo')).not.toBe(caption('or'))
    // the target itself (when, how) is the same whichever room it is
    const a = watchTarget(view({ watching: true, watchStartsAt: at, watchRoom: 'cryo' }))!
    const b = watchTarget(view({ watching: true, watchStartsAt: at }))!
    expect([a.toT, a.label, a.kind]).toEqual([b.toT, b.label, b.kind])
  })
})
