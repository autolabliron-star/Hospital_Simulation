/**
 * The loading screen (M5): a DOM overlay in the HUD's look, above everything, that stays up while the warm-up compiles every shader and
 * uploads every texture (src/scene/warmup). It shows the hospital's name, a calm progress line and, once everything is warm, an Enter button.
 *
 *   - While it is up the simulation is paused (see intro.ts), so the day starts when the presenter is ready.
 *   - Enter unlocks audio (a browser rule: it needs a real click or key), starts the day and fades the overlay out over about 0.4 s.
 *   - `?skipIntro=1` has no button: it enters by itself when ready. `?present=1` and `?probe=1` still show the screen.
 *   - A watchdog calls the warm-up ready after GIVE_UP_MS, so a warm-up that never starts or never ends cannot keep the presenter out.
 *
 * Mount once in App.tsx, after the HUD (it sits at z-index 100). Words are in src/content/loading.json.
 */
import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { LOADING } from '@/content/loading'
import { useWarmup } from '@/scene/warmup/warmup.store'
import { enterHospital, holdSim, introFlags } from './intro'
import { FADE_MS, GIVE_UP_MS, loadingView, type LoadingView } from './loadingModel'
import { realPorts } from './ports'
import './loading.css'

/** The card, from a view model (no stores, no effects: the markup is what the tests read). */
export function LoadingCard({ view, onEnter, buttonRef }: { view: LoadingView; onEnter: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <div
      className={`loading${view.leaving ? ' loading--leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="loading-title"
      aria-describedby="loading-line"
      aria-hidden={view.leaving ? true : undefined}
      data-ready={view.ready ? 'true' : 'false'}
    >
      <div className="loading__card">
        <svg className="loading__mark" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
          <rect width="40" height="40" rx="11" fill="currentColor" />
          <path d="M17 9h6v8h8v6h-8v8h-6v-8H9v-6h8z" fill="#fff" />
        </svg>
        <h1 className="loading__title" id="loading-title">
          {view.title}
        </h1>
        <p className="loading__tagline">{view.tagline}</p>
        <div className="loading__bar" role="progressbar" aria-label={view.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}>
          <div className="loading__fill" style={{ transform: `scaleX(${view.percent / 100})` }} />
        </div>
        <p className="loading__line" id="loading-line" aria-live="polite">
          {view.line}
        </p>
        <div className={`loading__enter${view.enterVisible ? ' loading__enter--shown' : ''}`} aria-hidden={view.enterVisible ? undefined : true}>
          <button type="button" className="loading__button" ref={buttonRef} disabled={view.enterDisabled || !view.enterVisible} tabIndex={view.enterVisible ? 0 : -1} onClick={onEnter}>
            {view.enterLabel}
          </button>
          <p className="loading__hint">{view.hint}</p>
        </div>
      </div>
    </div>
  )
}

export function LoadingScreen() {
  const ready = useWarmup((s) => s.ready)
  const progress = useWarmup((s) => s.progress)
  const failed = useWarmup((s) => s.failed)
  const timedOut = useWarmup((s) => s.timedOut)
  const entered = useWarmup((s) => s.entered)
  const skipIntro = useMemo(() => (typeof window === 'undefined' ? false : introFlags(window.location.search).skipIntro), [])
  const [gone, setGone] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const view = loadingView(LOADING, { ready, progress, failed, timedOut, entered, skipIntro })

  // the day waits for Enter (the hold is dropped when the card leaves the tree; after Enter it does nothing anyway)
  useEffect(() => (gone ? undefined : holdSim(realPorts())), [gone])

  // a warm-up that never finishes must not keep the presenter out
  useEffect(() => {
    if (ready) return
    const id = window.setTimeout(() => useWarmup.getState().giveUp(), GIVE_UP_MS)
    return () => window.clearTimeout(id)
  }, [ready])

  // `?skipIntro=1`: no click, so no audio unlock (the browser would refuse it; the first real key or click unlocks it later)
  useEffect(() => {
    if (view.autoEnter) enterHospital(realPorts(), { gesture: false })
  }, [view.autoEnter])

  // the button takes the keyboard when it appears: Enter or Space starts the day
  useEffect(() => {
    if (view.enterVisible) button.current?.focus()
  }, [view.enterVisible])

  // out of the tree once the fade is over
  useEffect(() => {
    if (!entered) return
    const id = window.setTimeout(() => setGone(true), FADE_MS + 60)
    return () => window.clearTimeout(id)
  }, [entered])

  if (gone) return null
  return (
    <LoadingCard
      view={view}
      buttonRef={button}
      onEnter={() => {
        enterHospital(realPorts(), { gesture: true })
        button.current?.blur()
      }}
    />
  )
}
