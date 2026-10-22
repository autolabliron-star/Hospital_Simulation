/**
 * The presenter's overlay: the few things that must stay on the glass when the HUD is hidden (H, or presentation mode) and that the audience
 * should not be surprised by. Mounted by the Hud root next to the HUD, not inside the hideable part.
 *
 *   notice      one sentence at the top ("Sound off. Press M to turn it on.", "Walkthrough on. C or Esc exits...") for a few seconds
 *   sound pill  the speaker state and the M key, while the HUD shows
 *   time pill   "Paused" or "30×" while the HUD is hidden, so a stray Space or digit never looks like a frozen demo (F-07)
 *
 * The state comes in as props to the views (they render in node); the root reads the stores.
 */
import { useEffect } from 'react'
import { toggleMute, useAudio } from '@/audio/audio.store'
import { fillPresenter, PRESENTER } from '@/content/presenter'
import { useWarmup } from '@/scene/warmup/warmup.store'
import { useWorld } from '@/sim/world.store'
import { useHudPrefs } from './walk/hudPrefs.store'
import { usePresentation } from './present/presentation.store'
import { showNotice, useNotice } from './notice.store'
import '@/styles/presenter.css'

export function soundNotice(muted: boolean): string {
  return muted ? PRESENTER.sound.off : PRESENTER.sound.on
}

/** Mute or unmute and say so (the M key and the pill share this). */
export function toggleMuteWithNotice(): boolean {
  const muted = toggleMute()
  showNotice(soundNotice(muted))
  return muted
}

export function NoticeView({ id, text }: { id: number; text: string | null }) {
  if (!text) return null
  return (
    <p className="hud-card presenter-notice" key={id} role="status">
      {text}
    </p>
  )
}

export function SoundPillView({ muted, onToggle }: { muted: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className="hud-card presenter-sound"
      aria-pressed={!muted}
      title={muted ? PRESENTER.sound.titleOff : PRESENTER.sound.titleOn}
      onClick={(e) => {
        onToggle()
        if (e.detail > 0) e.currentTarget.blur()
      }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M2 6h2.6L8 3v10L4.6 10H2z" fill="currentColor" />
        {muted ? (
          <path d="M10.5 6l3.5 4M14 6l-3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        ) : (
          <path d="M10.4 5.6a3.6 3.6 0 010 4.8M12.2 3.8a6.2 6.2 0 010 8.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        )}
      </svg>
      <span>{muted ? PRESENTER.sound.pillOff : PRESENTER.sound.pillOn}</span>
      <kbd className="hud-kbd">M</kbd>
    </button>
  )
}

/** Shown only when something is off the normal (paused, or not 1×): null otherwise. */
export function TimePillView({ paused, speed }: { paused: boolean; speed: number }) {
  if (!paused && speed === 1) return null
  const text = paused ? PRESENTER.time.pausedShort : fillPresenter(PRESENTER.time.speedShort, { n: speed })
  const title = paused ? PRESENTER.time.pausedTitle : fillPresenter(PRESENTER.time.speedTitle, { n: speed })
  return (
    <p className="hud-card presenter-time" data-paused={paused} title={title} role="status">
      {text}
    </p>
  )
}

export function PresenterOverlay() {
  const id = useNotice((s) => s.id)
  const text = useNotice((s) => s.text)
  const muted = useAudio((s) => s.muted)
  const paused = useWorld((s) => s.paused)
  const speed = useWorld((s) => s.speed)
  const entered = useWarmup((s) => s.entered)
  const presenting = usePresentation((s) => s.on)
  const cleanScreen = useHudPrefs((s) => s.hidden)
  const hudHidden = cleanScreen || presenting

  // the day starts: say what the sound is, so a `?mute=1` or a muted test never surprises the presenter
  useEffect(() => {
    if (entered) showNotice(soundNotice(useAudio.getState().muted))
  }, [entered])

  // F-39: a click on the canvas hides the cursor (pointer lock) and the HUD pills cannot be reached until Esc: say so, the first few times
  useEffect(() => {
    let told = 0
    const onLockChange = (): void => {
      if (document.pointerLockElement && told < 3) {
        told += 1
        showNotice(PRESENTER.pointer.locked)
      }
    }
    document.addEventListener('pointerlockchange', onLockChange)
    return () => document.removeEventListener('pointerlockchange', onLockChange)
  }, [])

  // a reload or Cmd+W in a built demo loses the live day: ask first (not in dev, where reloading is how you work)
  useEffect(() => {
    if (!entered || !import.meta.env.PROD) return
    const onUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [entered])

  return (
    <div className="hud presenter" data-hidden={hudHidden}>
      <NoticeView id={id} text={text} />
      {entered && !hudHidden && <SoundPillView muted={muted} onToggle={toggleMuteWithNotice} />}
      {entered && hudHidden && <TimePillView paused={paused} speed={speed} />}
    </div>
  )
}
