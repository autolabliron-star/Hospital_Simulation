/**
 * "Go to…": a keyboard-friendly list of rooms, opened with G or the HUD button. Type to filter, arrow keys to move,
 * Enter to fly there (the Room panel opens on arrival), Esc to close. Real buttons in a labelled dialog.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { focusRoom } from '@/scene/camera/roomFocus'
import { sim } from '@/sim'
import { buildGoToGroups, filterGoToGroups, type GoToItem } from './goToModel'
import { useGoTo } from './goTo.store'
import './roomPanel.css'

function Menu({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  // the menu mounts each time it opens, so the ward names are the beds' occupants right now
  const groups = useMemo(() => buildGoToGroups(sim.life.rooms), [])
  const shown = useMemo(() => filterGoToGroups(groups, query), [groups, query])
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const titleId = useId()

  // Focus the search box on open, and give focus back to whatever had it on close.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    input.current?.focus()
    return () => before?.focus?.()
  }, [])

  const choose = (item: GoToItem) => {
    onClose()
    focusRoom(item.area)
  }

  const items = (): HTMLElement[] => (root.current ? Array.from(root.current.querySelectorAll<HTMLElement>('[data-goto-item]')) : [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Tab') {
      // keep Tab inside the dialog
      const focusable = root.current ? Array.from(root.current.querySelectorAll<HTMLElement>('input, button')) : []
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
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLElement)
    const inInput = document.activeElement === input.current
    let next = -2
    if (e.key === 'ArrowDown') next = at + 1
    else if (e.key === 'ArrowUp') next = at - 1
    else if (!inInput && e.key === 'ArrowRight') next = at + 1
    else if (!inInput && e.key === 'ArrowLeft') next = at - 1
    else if (!inInput && e.key === 'Home') next = 0
    else if (!inInput && e.key === 'End') next = list.length - 1
    else if (inInput && e.key === 'Enter' && list.length > 0) {
      e.preventDefault()
      list[0].click() // Enter in the search box picks the first match
      return
    }
    if (next === -2) return
    e.preventDefault()
    if (next < 0) input.current?.focus()
    else list[Math.min(next, list.length - 1)]?.focus()
  }

  return (
    <div
      className="gt-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={root} className="hud-card gt" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <header className="gt-head">
          <h2 className="gt-title" id={titleId}>
            Go to…
          </h2>
          <button type="button" className="hud-icon-btn" aria-label="Close the room menu" title="Close (Esc)" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <input
          ref={input}
          className="gt-search"
          type="search"
          value={query}
          placeholder="Type a room or a patient"
          aria-label="Search rooms and patients"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="gt-scroll">
          {shown.length === 0 && <p className="gt-empty">Nothing matches “{query.trim()}”.</p>}
          {shown.map((g) => (
            <section key={g.id} className="gt-group" aria-label={g.title}>
              <h3 className="hud-field__label">{g.title}</h3>
              <div className="gt-grid">
                {g.items.map((item) => (
                  <button key={item.area} type="button" className="gt-item" data-goto-item onClick={() => choose(item)}>
                    <span className="gt-item__label">{item.label}</span>
                    {item.detail && <span className="gt-item__detail">{item.detail}</span>}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

export function GoToMenu() {
  const open = useGoTo((s) => s.open)
  const setOpen = useGoTo((s) => s.setOpen)
  if (!open) return null
  return (
    <div className="hud rp-layer">
      <Menu onClose={() => setOpen(false)} />
    </div>
  )
}
