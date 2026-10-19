/**
 * The Room panel body of the robot blood-draw centre (area `diagnostics`): who is being called, who is waiting, the three robots (phase, progress,
 * the synthetic patient, a tick for a first-attempt draw), the nurse, today's numbers, the tube-prep machine and a "Call next patient" button
 * that starts a demo draw. Reads `sim.blood` at about 4 Hz through `usePoll` (the view model is drawView.ts); nothing here runs per frame.
 * All the words come from src/content/drawUi.json.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { DRAW_UI, fillDraw } from '@/content/drawUi'
import { sim } from '@/sim'
import { drawView, type RobotCard } from './drawView'
import { usePoll } from './usePoll'
import './drawCentre.css'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dc-section">
      <h3 className="hud-field__label">{title}</h3>
      {children}
    </section>
  )
}

function Robot({ r }: { r: RobotCard }) {
  return (
    <li className="dc-robot" data-tone={r.tone}>
      <div className="dc-robot__head">
        <span className="dc-light" data-light={r.light} aria-hidden="true" />
        <span className="dc-robot__name">{fillDraw(DRAW_UI.panel.robot, { n: r.n })}</span>
        <span className="dc-chip" data-tone={r.tone}>
          {r.phaseText}
        </span>
      </div>
      <div className="sv-bar" role="progressbar" aria-label={fillDraw(DRAW_UI.panel.robot, { n: r.n })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.percent}>
        <span className="sv-bar__fill" style={{ width: `${r.percent}%` }} />
      </div>
      <div className="dc-robot__who">
        <span className={r.patient ? 'rp-strong' : 'rp-muted'}>{r.patient ? `${r.patient}${r.ticket ? ` · ${r.ticket}` : ''}` : DRAW_UI.panel.free}</span>
        {r.attemptText && (
          <span className="dc-tick" data-attempt={r.attempt}>
            {r.attempt === 'first' ? '✓ ' : ''}
            {r.attemptText}
          </span>
        )}
      </div>
    </li>
  )
}

export function DrawCentreBody() {
  const read = useCallback(() => drawView(sim.blood), [])
  const v = usePoll(read)

  // "Call next patient" was pressed: a patient is on the way until a robot starts, or the sim had no free robot
  const [note, setNote] = useState<'none' | 'asked' | 'busy'>('none')
  const busyRobots = v.robots.filter((r) => r.tone !== 'idle').length
  useEffect(() => {
    if (note === 'asked' && busyRobots > 0) setNote('none')
  }, [busyRobots, note])
  useEffect(() => {
    if (note === 'none') return
    const id = window.setTimeout(() => setNote('none'), note === 'busy' ? 3500 : 20000)
    return () => window.clearTimeout(id)
  }, [note])

  const callNext = () => {
    let ok = false
    try {
      ok = sim.blood.startDemoDraw()
    } catch {
      ok = false
    }
    setNote(ok ? 'asked' : 'busy')
  }

  return (
    <div className="dc" role="region" aria-label={DRAW_UI.panel.robots}>
      <Section title={DRAW_UI.panel.nowCalling}>
        <p className="dc-call" data-empty={v.calling ? 'false' : 'true'} aria-live="polite">
          {v.calling ? v.calling.text : DRAW_UI.panel.noCall}
        </p>
      </Section>

      <Section title={DRAW_UI.panel.waiting}>
        {v.waiting.ids.length === 0 ? (
          <p className="rp-muted">{DRAW_UI.panel.noWaiting}</p>
        ) : (
          <ul className="dc-tickets">
            {v.waiting.ids.map((id) => (
              <li key={id} className="dc-ticket" data-priority={id.startsWith('V')}>
                {id}
              </li>
            ))}
            {v.waiting.moreText && <li className="rp-muted">{v.waiting.moreText}</li>}
          </ul>
        )}
      </Section>

      <Section title={DRAW_UI.panel.robots}>
        <ul className="dc-robots rp-list">
          {v.robots.map((r) => (
            <Robot key={r.n} r={r} />
          ))}
        </ul>
        <p className="rp-muted">{v.staff}</p>
      </Section>

      <Section title={DRAW_UI.panel.stats}>
        <div className="dc-metrics">
          <div className="hud-metric">
            <span className="hud-metric__value">{v.stats.draws}</span>
            <span className="hud-metric__label">{DRAW_UI.panel.draws}</span>
          </div>
          <div className="hud-metric">
            <span className="hud-metric__value">{v.stats.firstAttempt}</span>
            <span className="hud-metric__label">{DRAW_UI.panel.firstAttempt}</span>
          </div>
          <div className="hud-metric">
            <span className="hud-metric__value">{v.stats.manual}</span>
            <span className="hud-metric__label">{DRAW_UI.panel.manual}</span>
          </div>
          <div className="hud-metric">
            <span className="hud-metric__value">{v.stats.wait}</span>
            <span className="hud-metric__label">{DRAW_UI.panel.wait}</span>
          </div>
        </div>
      </Section>

      <Section title={DRAW_UI.panel.prep}>
        <div className="dc-prep">
          <div className="dc-prep__row">
            <span className="rp-strong">{v.prep.phase}</span>
            <span className="rp-muted">{v.prep.ticket ?? ''}</span>
          </div>
          <div className="sv-bar" role="progressbar" aria-label={DRAW_UI.panel.prep} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.prep.percent}>
            <span className="sv-bar__fill" style={{ width: `${v.prep.percent}%` }} />
          </div>
          <div className="dc-prep__row">
            <span>
              {DRAW_UI.panel.labels}: <span className="rp-strong">{v.prep.labels}</span>
            </span>
            <span className="rp-muted">{v.prep.trays}</span>
          </div>
        </div>
      </Section>

      <div className="dc-actions">
        <button type="button" className="hud-send" disabled={note === 'asked'} onClick={callNext}>
          {note === 'asked' ? DRAW_UI.panel.callNextWaiting : DRAW_UI.panel.callNext}
        </button>
        {note === 'busy' && (
          <p className="dc-note" role="status">
            {DRAW_UI.panel.noneFree}
          </p>
        )}
      </div>

      <p className="dc-disclaimer">{v.disclaimer}</p>
    </div>
  )
}
