/**
 * "Jump to…": a keyboard-friendly list of the moments of the day (07:00 handover … 22:30 night), opened with J or the HUD
 * button. Arrow keys move, Enter jumps, Esc closes. Choosing a moment fades the screen out, rebuilds the hospital at that
 * hour with the same seed (the pre-roll runs behind the cover) and fades back in: see jumpFlow.ts for the sequence and
 * `JumpFade` below for the cover. Real buttons in a labelled dialog, the same pattern as the Go to… menu.
 *
 * The labels and captions come from src/content/day.json; the chrome words from l1Copy.ts.
 */
import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from 'react'
import { useWorld } from '@/sim/world.store'
import { useJump } from './jump.store'
import { buildJumpItems, clockHourOf, startIndex, type JumpItem } from './jumpModel'
import { fillCopy, L1_COPY } from './l1Copy'
import './jumpMenu.css'

const COPY = L1_COPY.jump

function Menu({ onClose }: { onClose: () => void }) {
  const clock = useWorld((s) => s.clock)
  const clockHour = clockHourOf(clock)
  const items = useMemo(() => buildJumpItems(clockHour ?? 7.5), [clockHour])
  const root = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const buttons = (): HTMLElement[] => (root.current ? Array.from(root.current.querySelectorAll<HTMLElement>('[data-jump-item]')) : [])

  // Focus the moment the clock is in on open, and give focus back to whatever had it on close.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    buttons()[startIndex(items)]?.focus()
    return () => before?.focus?.()
    // only on open: the list changing under the cursor must not steal focus
  }, [])

  // Esc closes the menu wherever the focus is (a click on the dialog's padding leaves it on the page), and never also closes
  // the room panel behind it: the capture phase runs before RoomKeys' window listener.
  useEffect(() => {
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [onClose])

  const choose = (item: JumpItem) => {
    useJump.getState().jump(item.hour)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    const list = buttons()
    if (e.key === 'Tab') {
      // keep Tab inside the dialog
      const focusable = root.current ? Array.from(root.current.querySelectorAll<HTMLElement>('button')) : []
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
      return
    }
    const at = list.indexOf(document.activeElement as HTMLElement)
    let next = -2
    if (e.key === 'ArrowDown') next = at + 1
    else if (e.key === 'ArrowUp') next = at - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = list.length - 1
    if (next === -2) return
    e.preventDefault()
    list[Math.max(0, Math.min(next, list.length - 1))]?.focus()
  }

  return (
    <div
      className="jm-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={root} className="hud-card jm" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <header className="jm-head">
          <div className="jm-head__titles">
            <h2 className="jm-title" id={titleId}>
              {COPY.title}
            </h2>
            <p className="jm-sub">
              {COPY.now} <span className="jm-sub__clock">{clock}</span>
            </p>
          </div>
          <button type="button" className="hud-icon-btn" aria-label={COPY.closeLabel} title={COPY.closeTitle} onClick={onClose}>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <ul className="jm-list" aria-label={COPY.listLabel}>
          {items.map((item) => (
            <li key={item.hour}>
              <button type="button" className="jm-item" data-jump-item data-now={item.isNow} data-past={item.isPast} onClick={() => choose(item)}>
                <span className="jm-item__time">{item.time}</span>
                <span className="jm-item__text">
                  <span className="jm-item__label">{item.label}</span>
                  <span className="jm-item__caption">{item.caption}</span>
                </span>
                {item.isNow && <span className="hud-chip jm-item__now">{COPY.nowChip}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="jm-hint">{COPY.hint}</p>
      </div>
    </div>
  )
}

export function JumpMenu() {
  const open = useJump((s) => s.open)
  const setOpen = useJump((s) => s.setOpen)
  if (!open) return null
  return (
    <div className="hud jm-layer">
      <Menu onClose={() => setOpen(false)} />
    </div>
  )
}

/**
 * The cover for a jump: it fades in while the hospital is rebuilt behind it (so no half-built state is ever visible), shows
 * where we are going, and fades out once the new hospital has drawn. Mount it once, last, in App.
 */
export function JumpFade() {
  const phase = useJump((s) => s.phase)
  const target = useJump((s) => s.target)
  const covered = phase === 'fadingOut' || phase === 'swapping'
  return (
    <div className="jm-cover" data-phase={phase} data-covered={covered} role="status" aria-live="polite" aria-hidden={phase === 'idle'}>
      {target && (
        <div className="jm-cover__text">
          <p className="jm-cover__time">{fillCopy(COPY.overlay, { time: target.time })}</p>
          {target.label && <p className="jm-cover__label">{target.label}</p>}
        </div>
      )}
    </div>
  )
}
