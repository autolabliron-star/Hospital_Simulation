/**
 * R5 "Watch step by step": the overlay while you watch (the HUD is hidden then). A DOM layer over the canvas:
 *
 *   top left      "Simulated", the room, and whether this is the step-by-step case or a live case being followed
 *   top right     pause, speed 1x 2x 4x (the sim's own clock: the same as Space and the number keys), free look, exit (Esc)
 *   left          the steps, done / current / upcoming (collapsible; the current one kept in view)
 *   bottom        the caption bar: "Step 7 of 32: Clips placed on duct and artery" and the step's one-line why; before a booked case, the wait and
 *                 "Skip to the start"
 *   inset         the endoscope picture-in-picture when the shot asks for it (big when the picture is the story)
 *   the dip       a 0.5 s fade through black on every cut the director makes (it cuts at the black)
 *
 * The caption is read from the sim at 4 Hz (`usePoll`); the rest comes from the watch store, written by the director only on change. `?probe=1` installs
 * `window.__hospitalWatch`, which runs the same code as the room panel's button.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { fillWatch, WATCH } from '@/content/watch'
import type { InsetId } from '@/scene/registries/insetSources'
import { roomPort, roomView, type WatchRoomId, type WatchSim } from '@/scene/watch/rooms'
import { useWatch, watchSession, type FreeLook } from '@/scene/watch/watch.store'
import { loop, sim } from '@/sim'
import { DEFAULT_KEYMAP, type ProcedureId } from '@/sim/types'
import { useWorld } from '@/sim/world.store'
import { usePoll } from '../usePoll'
import { isTyping } from '../walk/typing'
import { watchActions } from './actions'
import { Inset } from './Inset'
import { captionModel, type CaptionModel } from './watchView'
import './watch.css'

/** The speeds the overlay offers (the number keys still reach 10x and 30x). */
export const WATCH_SPEEDS = [1, 2, 4] as const

export interface WatchOverlayViewProps {
  caption: CaptionModel
  room: WatchRoomId
  free: FreeLook
  inset: InsetId | null
  insetBig: boolean
  skipping: boolean
  paused: boolean
  speed: number
  stepsOpen: boolean
  onToggleSteps(): void
  onPause(): void
  onSpeed(n: number): void
  onFreeLook(): void
  onExit(): void
  onSkip(): void
  /** The picture-in-picture (the live <Inset />; left out in node tests). */
  insetSlot?: ReactNode
}

/** The markup, with its state as props (so it renders in node). */
export function WatchOverlayView(p: WatchOverlayViewProps) {
  const o = WATCH.overlay
  const c = p.caption
  return (
    <div className="watch" role="region" aria-label={o.region} data-free={p.free} data-inset={p.inset === null ? 'none' : p.insetBig ? 'big' : 'small'}>
      <div className="watch-top">
        <div className="watch-card watch-tag">
          <span className="watch-chip">{o.simulated}</span>
          <span className="watch-room">{WATCH.rooms[p.room]}</span>
          <span className="watch-badge" data-mode={c.badge === o.live ? 'follow' : 'watch'}>
            {c.badge}
          </span>
        </div>
        <div className="watch-card watch-controls" role="toolbar" aria-label={o.region}>
          <button type="button" className="watch-btn" aria-pressed={p.paused} title={o.pauseTitle} onClick={p.onPause}>
            {p.paused ? o.play : o.pause}
          </button>
          <div className="watch-seg" role="group" aria-label={o.speed}>
            {WATCH_SPEEDS.map((n) => (
              <button key={n} type="button" className="watch-seg__btn" aria-pressed={p.speed === n} title={fillWatch(o.speedTitle, { n })} onClick={() => p.onSpeed(n)}>
                {fillWatch(o.speedLabel, { n })}
              </button>
            ))}
          </div>
          <button type="button" className="watch-btn" aria-pressed={p.free === 'held'} title={o.freeLookTitle} onClick={p.onFreeLook}>
            {o.freeLook}
          </button>
          <button type="button" className="watch-btn watch-btn--exit" title={o.exitTitle} onClick={p.onExit}>
            {o.exit}
            <kbd className="watch-kbd">{o.exitKey}</kbd>
          </button>
        </div>
      </div>

      {c.steps.length > 0 && (
        <aside className="watch-card watch-steps" data-open={p.stepsOpen ? 'true' : 'false'}>
          <button type="button" className="watch-steps__toggle" aria-expanded={p.stepsOpen} title={p.stepsOpen ? o.stepsHide : o.stepsShow} onClick={p.onToggleSteps}>
            {o.steps}
          </button>
          {p.stepsOpen && (
            <ol className="watch-steps__list">
              {c.steps.map((s) => (
                <li key={s.key} className="watch-steps__item" data-watch-step={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
                  <span className="watch-steps__n">{s.key + 1}</span>
                  <span className="watch-steps__label">{s.label}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      )}

      {p.insetSlot}

      {p.free === 'drag' && <p className="watch-hint">{o.dragHint}</p>}

      <div className="watch-card watch-caption" data-status={c.status} aria-live="polite">
        <p className="watch-caption__title">{c.title}</p>
        {c.why !== '' && <p className="watch-caption__why">{c.why}</p>}
        {c.canSkip && (
          <button type="button" className="watch-btn watch-caption__skip" disabled={p.skipping} onClick={p.onSkip}>
            {p.skipping ? o.skipBusy : o.skip}
          </button>
        )}
      </div>
    </div>
  )
}

/** The fade through black of a cut: replayed on every new `dip` (its key), nothing at all before the first. */
export function DipLayer({ dip }: { dip: number }) {
  if (dip === 0) return null
  return <div key={dip} className="watch-dip" aria-hidden="true" />
}

function readCaption(): CaptionModel {
  const w = useWatch.getState()
  const s = sim as unknown as WatchSim
  const room = w.room ?? 'or'
  return captionModel({ status: w.status, mode: w.mode, procedureId: w.procedureId, view: roomView(s, room), startsAt: roomPort(s, room)?.startsAt() ?? null, now: s.t })
}

function setSpeed(n: number): void {
  loop.speed = n
  loop.publishNow()
}

function togglePause(): void {
  loop.paused = !loop.paused
  loop.publishNow()
}

function WatchHud() {
  const caption = usePoll(readCaption)
  const room = useWatch((s) => s.room) ?? 'or'
  const free = useWatch((s) => s.free)
  const inset = useWatch((s) => s.inset)
  const insetBig = useWatch((s) => s.insetBig)
  const skipping = useWatch((s) => s.skipping)
  const paused = useWorld((s) => s.paused)
  const speed = useWorld((s) => s.speed)
  const [stepsOpen, setStepsOpen] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const current = caption.steps.findIndex((s) => s.state === 'current')

  // keep the current step in view in the list
  useEffect(() => {
    root.current?.querySelector('.watch-steps__item[aria-current]')?.scrollIntoView({ block: 'nearest' })
  }, [current, stepsOpen])

  const onFreeLook = useCallback(() => watchActions.holdFreeLook(useWatch.getState().free !== 'held'), [])
  return (
    <div ref={root}>
      <WatchOverlayView
        caption={caption}
        room={room}
        free={free}
        inset={inset}
        insetBig={insetBig}
        skipping={skipping}
        paused={paused}
        speed={speed}
        stepsOpen={stepsOpen}
        onToggleSteps={() => setStepsOpen((v) => !v)}
        onPause={togglePause}
        onSpeed={setSpeed}
        onFreeLook={onFreeLook}
        onExit={watchActions.stop}
        onSkip={() => void watchActions.skipToStart()}
        insetSlot={inset !== null ? <Inset key={inset} id={inset} big={insetBig} /> : null}
      />
    </div>
  )
}

const probeOn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('probe') === '1'

/** `?probe=1`: `window.__hospitalWatch`, running the same code as the room panel's button. */
function useWatchProbe(): void {
  useEffect(() => {
    if (!probeOn) return
    const w = window as unknown as { __hospitalWatch?: unknown }
    const idOf = (name: string): ProcedureId => (name.includes('-') ? name : `or-${name}`) as ProcedureId
    w.__hospitalWatch = {
      /** Start watching a procedure ('cholecystectomy' or 'or-cholecystectomy'); `{ fromStart: true }` books it after the case in the room. */
      start: (name: string, opts: { fromStart?: boolean } = {}) => watchActions.pick(idOf(name), opts),
      /** Watch the case in the room now. */
      follow: (room: WatchRoomId = 'or') => watchActions.follow(room),
      skip: () => watchActions.skipToStart(),
      freeLook: (on: boolean) => watchActions.holdFreeLook(on),
      stop: () => watchActions.stop(),
      state: () => {
        const { set: _set, ...ui } = useWatch.getState()
        return { ...ui, director: watchSession()?.debug() ?? null }
      },
    }
    return () => {
      delete w.__hospitalWatch
    }
  }, [])
}

/** Esc ends the watch (heard before the room keys and the walkthrough's, which have nothing open to close then). */
function useEscToExit(on: boolean): void {
  useEffect(() => {
    if (!on) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== DEFAULT_KEYMAP.overview || e.repeat || isTyping(e.target)) return
      e.preventDefault()
      watchActions.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [on])
}

export function WatchOverlay() {
  const phase = useWatch((s) => s.phase)
  const dip = useWatch((s) => s.dip)
  const shown = phase === 'entering' || phase === 'live'
  useEscToExit(shown)
  useWatchProbe()
  return (
    <>
      {shown && <WatchHud />}
      <DipLayer dip={dip} />
    </>
  )
}
