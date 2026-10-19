/**
 * The voice of the draw centre's queue: after the three-note chime (drawPatterns.ts `callChime`), "Number P 0 2 3, please go to robot 2" through
 * the browser's speech synthesis. ONLY voices with `localService === true` are used: a network voice would send the words to a remote service, and the
 * demo runs offline. With no local voice (or no speech synthesis at all) the chime alone is the call.
 *
 * `createCallAnnouncer` watches the call on the queue screen (the caller polls it about 4 Hz) and speaks each NEW call once, when you are in the room
 * (`audible`), audio is unlocked and not muted, and the page is not hidden or paused. The words come from src/content/drawUi.json.
 */
import { DRAW_UI, fillDraw } from '@/content/drawUi'
import { useAudio } from '@/audio/audio.store'
import { CALL_CHIME_S } from './drawPatterns'

/** The slice of a speech voice the picker reads. */
export interface VoiceLike {
  readonly name: string
  readonly lang: string
  readonly localService: boolean
}

/** The slice of `speechSynthesis` the announcer uses, so tests can inject a recorder. */
export interface SynthLike {
  speak(u: unknown): void
  cancel(): void
  getVoices(): readonly VoiceLike[]
}

/** A local voice only (a language match preferred), or null. */
export function pickLocalVoice<V extends VoiceLike>(voices: readonly V[], lang = 'en'): V | null {
  const local = voices.filter((v) => v.localService === true)
  if (local.length === 0) return null
  const base = lang.toLowerCase().split('-')[0]
  return local.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null
}

/** "P023" is read as letters and digits: "P 0 2 3". */
export function spokenTicket(id: string): string {
  return id.split('').join(' ')
}

/** The sentence spoken for a call; `robot` is 1-based. */
export function callPhrase(ticket: string, robot: number): string {
  return fillDraw(DRAW_UI.speech.call, { ticket: spokenTicket(ticket), robot })
}

export interface CallRead {
  ticket: string
  /** The robot (0-based), or null. */
  station: number | null
}

export interface AnnouncerDeps {
  /** The ticket on the queue screen now, or null. */
  read: () => CallRead | null
  /** You are in the room (or it is the focused one). */
  audible: () => boolean
  /** The page is hidden or the demo is paused. */
  blocked?: () => boolean
  audio?: () => { muted: boolean; unlocked: boolean }
  synth?: () => SynthLike | null
  utterance?: (text: string, voice: VoiceLike) => unknown
  /** The page clock in ms. */
  now?: () => number
  lang?: string
}

export interface Announcer {
  /** Look at the queue screen (call about 4 Hz). */
  poll(): void
  /** Cancel anything being said and stop watching. */
  stop(): void
}

/** A call that was not spoken within this long of its chime is dropped (the tab was hidden, the sim paused). */
const STALE_MS = 4000

function defaultSynth(): SynthLike | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  return window.speechSynthesis as unknown as SynthLike
}

function defaultUtterance(text: string, voice: VoiceLike): unknown {
  const u = new SpeechSynthesisUtterance(text)
  u.voice = voice as SpeechSynthesisVoice
  u.lang = voice.lang
  u.rate = 0.95
  u.volume = 0.85
  return u
}

export function createCallAnnouncer(deps: AnnouncerDeps): Announcer {
  const now = deps.now ?? ((): number => performance.now())
  const blocked = deps.blocked ?? ((): boolean => typeof document !== 'undefined' && document.hidden)
  const audio = deps.audio ?? ((): { muted: boolean; unlocked: boolean } => useAudio.getState())
  const synth = deps.synth ?? defaultSynth
  const utter = deps.utterance ?? defaultUtterance
  let primed = false
  let lastKey: string | null = null
  let pending: { text: string; at: number } | null = null

  return {
    poll() {
      const call = deps.read()
      const key = call ? `${call.ticket}:${call.station ?? -1}` : null
      if (!primed) {
        // a call that is already on the screen at load is not announced
        primed = true
        lastKey = key
        return
      }
      if (key !== lastKey) {
        lastKey = key
        if (call) {
          // the chime plays first; the voice follows it
          pending = { text: callPhrase(call.ticket, (call.station ?? 0) + 1), at: now() + CALL_CHIME_S * 1000 }
          synth()?.cancel()
        } else pending = null
      }
      if (!pending || now() < pending.at) return
      const p = pending
      pending = null
      if (now() - p.at > STALE_MS) return
      const a = audio()
      if (!deps.audible() || blocked() || a.muted || !a.unlocked) return
      const s = synth()
      if (!s) return
      const voice = pickLocalVoice(s.getVoices(), deps.lang ?? 'en')
      if (!voice) return
      s.speak(utter(p.text, voice))
    },
    stop() {
      pending = null
      synth()?.cancel()
    },
  }
}
