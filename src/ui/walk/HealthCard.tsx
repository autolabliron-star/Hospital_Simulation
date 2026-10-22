/**
 * Your health card (walk mode, E at a health kiosk): the eight values filling in live while your session runs ("—" until measured), the step and how far
 * through it you are; once the session is over it turns into the printed thermal slip ("Sent to triage · Simulated"). Read from the sim at 4 Hz. Not modal:
 * walk away, press E at the kiosk or Esc, or press its close button. Mounted by WalkOverlay beside the MedDrawer card.
 */
import { useCallback, useEffect } from 'react'
import { KIOSK_UI } from '@/content/kioskUi'
import { closableOverlayOpen, closeOverlays } from '@/scene/interact/overlays'
import { sim } from '@/sim'
import { DEFAULT_KEYMAP } from '@/sim/types'
import { usePoll } from '@/ui/usePoll'
import { readCard, type CardView } from '@/ui/kioskView'
import { useHealthCard } from './healthCard.store'
import './healthCard.css'

/** The card itself, from a view model: tests and the HUD render the same thing. */
export function HealthCardView({ v, onClose }: { v: CardView; onClose: () => void }) {
  const slip = v.state !== 'running'
  return (
    <section className={`hud-card walk-health${slip ? ' walk-health--slip' : ''}`} aria-label={v.title} data-state={v.state}>
      <header className="walk-health__head">
        <h2 className="walk-health__title">{v.title}</h2>
        <button type="button" className="hud-icon-btn" aria-label={KIOSK_UI.card.close} title={KIOSK_UI.card.closeTitle} onClick={onClose}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {v.stepTitle !== null && (
        <>
          <p className="walk-health__step">{v.stepTitle}</p>
          {v.hint !== null && <p className="walk-health__hint">{v.hint}</p>}
          <div className="walk-health__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.progress * 100)}>
            <span style={{ width: `${Math.round(v.progress * 100)}%` }} />
          </div>
          <ul className="walk-health__dots" aria-hidden="true">
            {v.dots.map((d) => (
              <li key={d.phase} data-state={d.state} />
            ))}
          </ul>
        </>
      )}
      <ul className="walk-health__rows">
        {v.rows.map((r) => (
          <li key={r.key} className="walk-health__row" data-current={r.current}>
            <span className="walk-health__label">{r.label}</span>
            <span>
              <span className="walk-health__value" data-measured={r.measured} data-out={r.outOfRange}>
                {r.value}
              </span>
              {r.measured && r.unit !== '' && <span className="walk-health__unit">{r.unit}</span>}
            </span>
          </li>
        ))}
      </ul>
      {v.bp.length > 1 && (
        <ul className="walk-health__bp">
          {v.bp.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {v.sent !== null && <p className="walk-health__sent">{v.sent}</p>}
      <p className="walk-health__foot">{v.footer}</p>
    </section>
  )
}

function Body({ kiosk }: { kiosk: number }) {
  const read = useCallback(() => readCard(sim, kiosk), [kiosk])
  const close = useCallback(() => useHealthCard.getState().close(), [])
  // Esc closes the card (like the drawer card): consumed, so the overview's own Esc never sees it. A menu above it (Jump, Go to, a lift ride) has
  // the first claim on Esc (F-38): then this stays out of the way, and the menu closes on the first press. Closing goes through `closeOverlays`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== DEFAULT_KEYMAP.overview || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (!closableOverlayOpen()) return
      closeOverlays()
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return <HealthCardView v={usePoll(read)} onClose={close} />
}

export function HealthCard() {
  const open = useHealthCard((s) => s.open)
  const kiosk = useHealthCard((s) => s.kiosk)
  return open ? <Body key={kiosk} kiosk={kiosk} /> : null
}
