/**
 * The presenter's side of presentation mode (mount once in App, outside the Canvas):
 *
 *   C   toggles the walkthrough (never while typing in a field, and not before the presenter has pressed Enter)
 *   Esc exits the walkthrough too (F-08); a notice says so when it starts and when it ends (the HUD, and its toast, are hidden meanwhile)
 *   N   glides to the next shot, turning the mode on if it is off (shots.ts, glide.ts; the player system runs the glide)
 *   power   while on, `usePresent` (src/app/power.ts: 60 fps on battery, no pause on blur) is on too; leaving puts it back as it was
 *   probe   `?probe=1` adds `window.__hospitalPresent = { on(), off(), shot(i), glide(), state() }` for scripted screenshots
 *
 * `Hidden` is the gate the game's overlays go through: it renders nothing while presenting (the Go-to menu, the room panel, the Jump menu and
 * its fade). `Cloaked` keeps its children mounted (they have effects of their own, the lift cover's outfit sync) and only hides them.
 */
import { useEffect, type ReactNode } from 'react'
import { usePresent } from '@/app/power'
import { probeEnabled } from '@/app/DevProbe'
import { closeOverlays } from '@/scene/interact/overlays'
import { presentCut, presentGlide, presentState } from '@/scene/player/api'
import { useGoTo } from '@/ui/goTo.store'
import { useJump } from '@/ui/jump.store'
import { hotkeyAllowed } from '@/ui/hotkeys'
import { hotkeyContext } from '@/ui/hotkeyContext'
import { PRESENTER } from '@/content/presenter'
import { showNotice } from '@/ui/notice.store'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { PRESENT_KEY, PRESENT_NEXT_KEY, usePresentation } from './presentation.store'
import { SHOTS } from './shots'

/** What a key does to the walkthrough: toggle (C), next shot (N), exit (Esc while it is on), or nothing. Pure, so node can test it. */
export function presentKeyAction(code: string, presenting: boolean, allowed: boolean): 'toggle' | 'next' | 'exit' | 'none' {
  if (code === DEFAULT_KEYMAP.overview) return presenting ? 'exit' : 'none'
  if (!allowed) return 'none'
  if (code === PRESENT_KEY) return 'toggle'
  if (code === PRESENT_NEXT_KEY && presenting) return 'next'
  return 'none'
}

export function PresentationControls(): null {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const store = usePresentation.getState()
      const action = presentKeyAction(e.code, store.on, hotkeyAllowed(e.code, hotkeyContext(e.target)))
      if (action === 'exit') {
        // Esc leaves the walkthrough (a focused field keeps its own Esc: the room list closing, say)
        store.setOn(false)
      } else if (action === 'toggle') {
        e.preventDefault()
        store.toggle()
      } else if (action === 'next') {
        // (N glides only inside the walkthrough; the probe's glide() turns it on first)
        e.preventDefault()
        presentGlide()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // the power flag: on while presenting, back to what it was (`?present=1` may have set it) when leaving
  useEffect(() => {
    let before: boolean | null = null
    const apply = (on: boolean): void => {
      const power = usePresent.getState()
      // nothing the walkthrough cannot show may hold your input: the tablet, the room panel, the cards and both menus close as it starts
      if (on) {
        closeOverlays()
        useGoTo.getState().setOpen(false)
        useJump.getState().setOpen(false)
      }
      if (on && before === null) {
        before = power.on
        power.setOn(true)
      } else if (!on && before !== null) {
        power.setOn(before)
        before = null
      }
    }
    apply(usePresentation.getState().on)
    const unsub = usePresentation.subscribe((s, prev) => {
      if (s.on === prev.on) return
      apply(s.on)
      // the HUD and its toast are hidden while the walkthrough runs: say how to leave it, and that it ended (F-08)
      showNotice(s.on ? PRESENTER.present.enter : PRESENTER.present.exit)
    })
    return () => {
      unsub()
      apply(false)
    }
  }, [])

  // scripted shots for the checks (?probe=1 only)
  useEffect(() => {
    if (!probeEnabled) return
    const w = window as unknown as { __hospitalPresent?: unknown }
    w.__hospitalPresent = {
      on: () => usePresentation.getState().setOn(true),
      off: () => usePresentation.getState().setOn(false),
      /** Instant cut to shot `i` (0-based, looping), settled, on the next frame. Turns the mode on if it is off. */
      shot: (i: number) => presentCut(i),
      /** Glide to the next shot (6 to 8 s). Turns the mode on if it is off. */
      glide: () => presentGlide(),
      shots: SHOTS.length,
      state: () => ({ on: usePresentation.getState().on, ...presentState() }),
    }
    return () => {
      delete w.__hospitalPresent
    }
  }, [])

  return null
}

/** The markup of `Hidden`, with the state as a prop (so it renders in node). */
export function HiddenView({ on, children }: { on: boolean; children?: ReactNode }) {
  return on ? null : <>{children}</>
}

/** Renders `children` unless presentation mode is on. */
export function Hidden({ children }: { children: ReactNode }) {
  const on = usePresentation((s) => s.on)
  return <HiddenView on={on}>{children}</HiddenView>
}

/** The markup of `Cloaked`, with the state as a prop. */
export function CloakedView({ on, children }: { on: boolean; children?: ReactNode }) {
  return <div style={{ display: on ? 'none' : 'contents' }}>{children}</div>
}

/** Keeps `children` mounted but invisible and inert while presentation mode is on (`display: contents` otherwise: no box of its own). */
export function Cloaked({ children }: { children: ReactNode }) {
  const on = usePresentation((s) => s.on)
  return <CloakedView on={on}>{children}</CloakedView>
}
