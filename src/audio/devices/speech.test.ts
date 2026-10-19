import { describe, expect, it } from 'vitest'
import { CALL_CHIME_S } from './drawPatterns'
import { callPhrase, createCallAnnouncer, pickLocalVoice, spokenTicket, type AnnouncerDeps, type CallRead, type SynthLike, type VoiceLike } from './speech'

const voice = (name: string, lang: string, localService: boolean): VoiceLike => ({ name, lang, localService })

describe('which voice', () => {
  it('uses ONLY local voices: a network voice is never chosen, even when it is the only one that matches', () => {
    expect(pickLocalVoice([voice('Cloud English', 'en-US', false)], 'en')).toBeNull()
    expect(pickLocalVoice([voice('Cloud English', 'en-US', false), voice('Local French', 'fr-FR', true)], 'en')).toBeNull()
    expect(pickLocalVoice([], 'en')).toBeNull()
  })

  it('prefers a local voice in the language, whatever the order', () => {
    const list = [voice('Cloud', 'en-GB', false), voice('Local DE', 'de-DE', true), voice('Local EN', 'en-US', true)]
    expect(pickLocalVoice(list, 'en')?.name).toBe('Local EN')
    expect(pickLocalVoice(list, 'en-GB')?.name).toBe('Local EN')
    expect(pickLocalVoice(list, 'de')?.name).toBe('Local DE')
  })
})

describe('what is said', () => {
  it('spells a ticket as letters and digits and builds the sentence from the content', () => {
    expect(spokenTicket('P023')).toBe('P 0 2 3')
    expect(spokenTicket('V004')).toBe('V 0 0 4')
    expect(callPhrase('P023', 2)).toBe('Number P 0 2 3, please go to robot 2')
  })
})

describe('the announcer', () => {
  function setup(o: Partial<AnnouncerDeps> = {}, voices: VoiceLike[] = [voice('Local EN', 'en-US', true)]) {
    let call: CallRead | null = null
    let t = 1000
    const spoken: string[] = []
    let cancels = 0
    const synth: SynthLike = { speak: (u) => spoken.push(String(u)), cancel: () => cancels++, getVoices: () => voices }
    const a = createCallAnnouncer({
      read: () => call,
      audible: () => true,
      blocked: () => false,
      audio: () => ({ muted: false, unlocked: true }),
      synth: () => synth,
      utterance: (text, v) => `${v.name}: ${text}`,
      now: () => t,
      ...o,
    })
    return {
      a,
      spoken,
      cancels: () => cancels,
      call: (c: CallRead | null) => {
        call = c
      },
      wait: (ms: number) => {
        t += ms
      },
    }
  }

  it('speaks a new call once, after the chime, with a local voice', () => {
    const s = setup()
    s.a.poll() // primes on an empty screen
    s.call({ ticket: 'P023', station: 1 })
    s.a.poll()
    expect(s.spoken).toEqual([]) // the chime is still playing
    s.wait(CALL_CHIME_S * 1000 - 100)
    s.a.poll()
    expect(s.spoken).toEqual([])
    s.wait(200)
    s.a.poll()
    expect(s.spoken).toEqual(['Local EN: Number P 0 2 3, please go to robot 2'])
    s.wait(5000)
    s.a.poll()
    expect(s.spoken.length).toBe(1) // the same call is not said twice
  })

  it('does not announce a call that is already on the screen at load', () => {
    const s = setup()
    s.call({ ticket: 'P001', station: 0 })
    s.a.poll()
    s.wait(5000)
    s.a.poll()
    expect(s.spoken).toEqual([])
  })

  it('says the next call too, and cancels what it was saying', () => {
    const s = setup()
    s.a.poll()
    s.call({ ticket: 'P001', station: 0 })
    s.a.poll()
    s.wait(1500)
    s.a.poll()
    s.call({ ticket: 'P002', station: 2 })
    const before = s.cancels()
    s.a.poll()
    expect(s.cancels()).toBeGreaterThan(before)
    s.wait(1500)
    s.a.poll()
    expect(s.spoken).toEqual(['Local EN: Number P 0 0 1, please go to robot 1', 'Local EN: Number P 0 0 2, please go to robot 3'])
  })

  it('stays silent with no local voice (the chime alone), with no speech synthesis, when muted, locked, hidden, paused or out of the room', () => {
    const cases: [string, Partial<AnnouncerDeps>, VoiceLike[]][] = [
      ['no local voice', {}, [voice('Cloud', 'en-US', false)]],
      ['no voices at all', {}, []],
      ['no synthesis', { synth: () => null }, [voice('Local EN', 'en-US', true)]],
      ['muted', { audio: () => ({ muted: true, unlocked: true }) }, [voice('Local EN', 'en-US', true)]],
      ['audio locked', { audio: () => ({ muted: false, unlocked: false }) }, [voice('Local EN', 'en-US', true)]],
      ['hidden or paused', { blocked: () => true }, [voice('Local EN', 'en-US', true)]],
      ['out of the room', { audible: () => false }, [voice('Local EN', 'en-US', true)]],
    ]
    for (const [name, deps, voices] of cases) {
      const s = setup(deps, voices)
      s.a.poll()
      s.call({ ticket: 'P023', station: 1 })
      s.a.poll()
      s.wait(CALL_CHIME_S * 1000 + 100)
      s.a.poll()
      expect(s.spoken, name).toEqual([])
    }
  })

  it('drops a call that went stale (the tab was hidden for a while)', () => {
    const s = setup()
    s.a.poll()
    s.call({ ticket: 'P023', station: 1 })
    s.a.poll()
    s.wait(60_000)
    s.a.poll()
    expect(s.spoken).toEqual([])
  })

  it('stop() cancels speech and forgets a pending call', () => {
    const s = setup()
    s.a.poll()
    s.call({ ticket: 'P023', station: 1 })
    s.a.poll()
    s.a.stop()
    expect(s.cancels()).toBeGreaterThan(0)
    s.wait(2000)
    s.a.poll()
    expect(s.spoken).toEqual([])
  })
})
