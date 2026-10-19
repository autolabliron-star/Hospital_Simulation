import { describe, expect, it } from 'vitest'
import type { DrawPhase } from '@/sim/types'
import {
  CALL_CHIME_S,
  CALL_NOTES_HZ,
  CALL_NOTE_GAP_S,
  DRAW_SOUND_AREA,
  DrawSoundTracker,
  alertBeeps,
  callChime,
  createDrawSoundSource,
  doneChime,
  gripperClick,
  needleClick,
  printerWhirr,
  registerDrawSounds,
  servoWhir,
  soundViewOf,
  tourniquetHiss,
  type DeviceSoundSource,
  type DrawSoundView,
  type DrawVoice,
} from './drawPatterns'

type St = DrawSoundView['stations'][number]
const st = (o: Partial<St> = {}): St => ({ phase: 'idle', scan: 0, needle: 0, cuff: 0, ...o })
const prep = (o: Partial<DrawSoundView['prep']> = {}): DrawSoundView['prep'] => ({ phase: 'idle', bin: -1, held: null, progress: 0, ...o })
const view = (s: [St, St, St] = [st(), st(), st()], p = prep(), calling: DrawSoundView['calling'] = null): DrawSoundView => ({ stations: s, prep: p, calling })
const kinds = (v: readonly DrawVoice[]): string[] => v.map((x) => x.kind)

describe('the voices', () => {
  it('every voice has finite, sensible numbers (level 0..1, positive duration, audible pitch)', () => {
    const all: DrawVoice[] = [
      ...servoWhir('robot0', 0.5, 0.3),
      ...servoWhir('robot0', 5, 0.3),
      ...tourniquetHiss('robot1', true, 1),
      ...tourniquetHiss('robot1', false, 0.7),
      ...needleClick('robot2', true),
      ...needleClick('robot2', false),
      ...doneChime('robot0'),
      ...alertBeeps('robot0'),
      ...gripperClick('prep'),
      ...printerWhirr('prep', 1.1),
      ...callChime(),
    ]
    for (const v of all) {
      expect(v.t).toBeGreaterThanOrEqual(0)
      expect(v.level).toBeGreaterThan(0)
      expect(v.level).toBeLessThanOrEqual(0.5)
      expect(v.source.length).toBeGreaterThan(0)
      if (v.kind === 'tone') {
        expect(v.freq).toBeGreaterThan(100)
        expect(v.freq).toBeLessThan(4000)
        expect(v.dur).toBeGreaterThan(0)
      } else if (v.kind === 'noise') {
        expect(v.highHz).toBeGreaterThan(v.lowHz)
        expect(v.dur).toBeGreaterThan(0)
      } else expect(v.freq).toBeGreaterThan(500)
    }
  })

  it('the servo whine rises with speed', () => {
    const slow = servoWhir('r', 0.1, 0.2)[0]
    const fast = servoWhir('r', 0.9, 0.2)[0]
    expect(fast.kind === 'tone' && slow.kind === 'tone' && fast.freq > slow.freq).toBe(true)
  })

  it('the queue call is a three-note rising chime, a little apart, with the voice due after it', () => {
    const c = callChime()
    expect(c.length).toBe(3)
    expect(CALL_NOTES_HZ[0]).toBeLessThan(CALL_NOTES_HZ[1])
    expect(CALL_NOTES_HZ[1]).toBeLessThan(CALL_NOTES_HZ[2])
    c.forEach((v, i) => {
      expect(v.kind).toBe('tone')
      expect(v.t).toBeCloseTo(i * CALL_NOTE_GAP_S, 9)
      if (v.kind === 'tone') expect(v.freq).toBe(CALL_NOTES_HZ[i])
    })
    expect(CALL_CHIME_S).toBeGreaterThan(2 * CALL_NOTE_GAP_S + 0.55)
    expect(callChime('queue', 2)[0].t).toBe(2)
  })

  it('the printer whirr has a tick for every few millimetres of label', () => {
    const w = printerWhirr('prep', 1.1)
    expect(w.filter((v) => v.kind === 'click').length).toBe(10)
    expect(w.filter((v) => v.kind === 'noise').length).toBe(1)
  })
})

describe('the tracker', () => {
  it('makes no sound at load and none in a quiet room, however long it looks', () => {
    const t = new DrawSoundTracker()
    for (let i = 0; i < 200; i++) expect(t.step(view(), 0.05)).toEqual([])
  })

  it('is deterministic: the same looks give the same sounds', () => {
    const run = (): DrawVoice[] => {
      const t = new DrawSoundTracker()
      const out: DrawVoice[] = []
      const script: DrawSoundView[] = [
        view(),
        view([st({ phase: 'cuff', cuff: 0.3 }), st(), st()]),
        view([st({ phase: 'veinScan', cuff: 1, scan: 0.1 }), st(), st()]),
        view([st({ phase: 'veinScan', cuff: 1, scan: 0.3 }), st(), st()]),
        view([st({ phase: 'needleIn', cuff: 1, scan: 0.3, needle: 0.3 }), st(), st()]),
      ]
      for (const v of script) out.push(...t.step(v, 0.5))
      return out
    }
    expect(run()).toEqual(run())
  })

  it('whirs while the head moves along the arm and not while it holds still', () => {
    const t = new DrawSoundTracker()
    t.step(view([st({ phase: 'veinScan', scan: 0 }), st(), st()]), 0.05)
    t.step(view([st({ phase: 'veinScan', scan: 0 }), st(), st()]), 0.05)
    let moving = 0
    let scan = 0
    for (let i = 0; i < 40; i++) {
      scan += 0.01
      const v = t.step(view([st({ phase: 'veinScan', scan }), st(), st()]), 0.05)
      moving += v.filter((x) => x.kind === 'tone' && x.source === 'robot0').length
    }
    expect(moving).toBeGreaterThan(3)
    let still = 0
    for (let i = 0; i < 40; i++) still += t.step(view([st({ phase: 'veinScan', scan }), st(), st()]), 0.05).length
    expect(still).toBe(0)
  })

  it('hisses when the cuff pumps up and lets go, once each', () => {
    const t = new DrawSoundTracker()
    t.step(view(), 0.1)
    t.step(view(), 0.1)
    const out: DrawVoice[] = []
    for (let c = 0; c <= 1.0001; c += 0.1) out.push(...t.step(view([st({ phase: 'cuff', cuff: Math.min(1, c) }), st(), st()]), 0.1))
    for (let c = 1; c >= -0.0001; c -= 0.1) out.push(...t.step(view([st({ phase: 'release', cuff: Math.max(0, c) }), st(), st()]), 0.1))
    const hiss = out.filter((v) => v.kind === 'noise' && v.source === 'robot0')
    expect(hiss.length).toBe(2)
    expect(hiss[0].kind === 'noise' && hiss[1].kind === 'noise' && hiss[0].dur > hiss[1].dur).toBe(true)
  })

  it('clicks when the needle goes in and again when it comes out', () => {
    const t = new DrawSoundTracker()
    t.step(view(), 0.1)
    t.step(view(), 0.1)
    const out: DrawVoice[] = []
    for (let n = 0; n <= 1.0001; n += 0.1) out.push(...t.step(view([st({ phase: 'needleIn', needle: Math.min(1, n) }), st(), st()]), 0.1))
    const clicksIn = out.filter((v) => v.kind === 'click').length
    for (let n = 1; n >= -0.0001; n -= 0.1) out.push(...t.step(view([st({ phase: 'needleOut', needle: Math.max(0, n) }), st(), st()]), 0.1))
    const clicks = out.filter((v) => v.kind === 'click').length
    expect(clicksIn).toBe(1)
    expect(clicks).toBe(2)
  })

  it('chimes softly once when the draw is finished and the bandage goes on, and beeps when a person is needed', () => {
    const t = new DrawSoundTracker()
    t.step(view(), 0.1)
    t.step(view(), 0.1)
    const out: DrawVoice[] = []
    for (const phase of ['filling', 'needleOut', 'bandage', 'bandage', 'release'] as DrawPhase[]) out.push(...t.step(view([st(), st({ phase }), st()]), 0.1))
    const chimes = out.filter((v) => v.kind === 'tone' && v.source === 'robot1' && v.wave === 'sine' && v.freq > 600)
    expect(chimes.length).toBe(2) // two notes, once
    const beeps = new DrawSoundTracker()
    beeps.step(view(), 0.1)
    beeps.step(view(), 0.1)
    const alert = beeps.step(view([st(), st(), st({ phase: 'armMoved' })]), 0.1)
    expect(alert.filter((v) => v.kind === 'tone' && v.wave === 'square').length).toBe(2)
    expect(beeps.step(view([st(), st(), st({ phase: 'armMoved' })]), 0.1)).toEqual([]) // once, on entering
  })

  it('clicks the gripper on a pick, a bin change and a drop, and whirrs the printer when the label prints', () => {
    const t = new DrawSoundTracker()
    t.step(view(), 0.1)
    t.step(view(), 0.1)
    const pick = t.step(view(undefined, prep({ phase: 'picking', bin: 3 })), 0.1)
    expect(kinds(pick)).toEqual(['click']) // moved to a bin
    const grab = t.step(view(undefined, prep({ phase: 'picking', bin: 3, held: 'serum', progress: 0.6 })), 0.1)
    expect(kinds(grab)).toEqual(['click'])
    const label = t.step(view(undefined, prep({ phase: 'labelling', bin: 3, held: 'serum' })), 0.1)
    expect(label.some((v) => v.kind === 'noise' && v.source === 'prep')).toBe(true)
    const out = t.step(view(undefined, prep({ phase: 'output', bin: 3, held: 'serum' })), 0.1)
    expect(kinds(out)).toEqual(['click'])
    const drop = t.step(view(undefined, prep({ phase: 'output', bin: 3, held: null })), 0.1)
    expect(kinds(drop)).toEqual(['click'])
  })

  it('rings the queue chime for each NEW call, and not for one that is already up at load or repeats', () => {
    const t = new DrawSoundTracker()
    const first = t.step(view(undefined, prep(), { ticket: 'P001', station: 0 }), 0.1)
    expect(first).toEqual([]) // already on the screen when we first looked
    expect(t.step(view(undefined, prep(), { ticket: 'P001', station: 0 }), 0.1)).toEqual([])
    const next = t.step(view(undefined, prep(), { ticket: 'P002', station: 1 }), 0.1)
    expect(next.length).toBe(3)
    expect(next.every((v) => v.source === 'queue')).toBe(true)
    expect(t.step(view(undefined, prep(), null), 0.1)).toEqual([])
    expect(t.step(view(undefined, prep(), { ticket: 'P002', station: 1 }), 0.1).length).toBe(3) // called again after the screen cleared
  })
})

describe('the sound view of the sim', () => {
  it('reads the stations and the prep state in place and turns the called ticket into the call', () => {
    const stations = [st(), st(), st()]
    const p = prep()
    const v = soundViewOf({ stations, prep: p, calling: { id: 'P023', station: 1 } })
    expect(v.stations).toBe(stations)
    expect(v.prep).toBe(p)
    expect(v.calling).toEqual({ ticket: 'P023', station: 1 })
    expect(soundViewOf({ stations, prep: p, calling: null }).calling).toBeNull()
  })
})

describe('registration', () => {
  it('is a source for the draw centre area with a step the engine can call', () => {
    let current: DrawSoundView | null = null
    const src = createDrawSoundSource(() => current)
    expect(src.id).toBe('draw')
    expect(src.area).toBe(DRAW_SOUND_AREA)
    expect(DRAW_SOUND_AREA).toBe('diagnostics')
    expect(src.step(0.05)).toEqual([]) // no sim yet
    current = view()
    expect(src.step(0.05)).toEqual([])
  })

  it('hands the source to the engine and returns the engine\'s remover', () => {
    const added: DeviceSoundSource[] = []
    let removed = false
    const undo = registerDrawSounds(
      (s) => {
        added.push(s)
        return () => {
          removed = true
        }
      },
      () => null,
    )
    expect(added.length).toBe(1)
    expect(added[0].area).toBe('diagnostics')
    undo()
    expect(removed).toBe(true)
  })
})
