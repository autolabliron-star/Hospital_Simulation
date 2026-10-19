/**
 * The robotic OR panel (the room panel's body for `l2Or`, R2): a "Simulated" tag, today's list, the case in the room with its phase timeline, the
 * robot and its four arms, the theatre team, the day's numbers, and the "Watch the endoscope view" button that opens the teaching-console card inside
 * the panel. Reads the sim at 4 Hz through `usePoll` (the view model is src/ui/orView.ts); nothing here runs per frame or touches the 3D world.
 * All the words come from src/content/surgeryUi.json and src/content/surgery.json.
 */
import { useCallback, type ReactNode } from 'react'
import { SURGERY_UI } from '@/content/surgeryUi'
import { sim } from '@/sim'
import { ConsoleCardInline } from '@/ui/walk/ConsoleCard'
import { useConsoleCard, type ConsoleCardState } from '@/ui/walk/consoleCard.store'
import { orView, teamOf, type ArmRow, type CaseRow, type CurrentCase, type OrView, type TimelineStep } from './orView'
import { usePoll } from './usePoll'
import './orBody.css'

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rp-section">
      {title !== undefined && <h3 className="hud-field__label">{title}</h3>}
      {children}
    </section>
  )
}

function Case({ c }: { c: CaseRow }) {
  return (
    <li className="rp-list__item or-case" data-current={c.current ? 'true' : undefined}>
      <span className="or-case__time">{c.time}</span>
      <span className="or-case__text">
        <span className="rp-strong">{c.patient}</span>
        <span className="rp-muted">{c.procedure}</span>
        {c.outcome !== null && <span className="or-case__outcome">{c.outcome}</span>}
      </span>
      <span className="hud-chip or-case__phase" data-current={c.current ? 'true' : undefined}>
        {c.phase}
      </span>
    </li>
  )
}

function Step({ s, left }: { s: TimelineStep; left: string | null }) {
  return (
    <li className="or-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
      <span className="or-step__dot" aria-hidden="true" />
      <span className="or-step__label">{s.label}</span>
      {s.state === 'current' && left !== null && <span className="or-step__left">{left}</span>}
    </li>
  )
}

function Current({ c }: { c: CurrentCase }) {
  return (
    <>
      <p className="rp-line or-now">
        <span className="rp-strong">{c.patient}</span> <span className="rp-muted">{c.procedure}</span>
      </p>
      <ol className="or-steps">
        {c.steps.map((s) => (
          <Step key={s.phase} s={s} left={c.timeLeft} />
        ))}
      </ol>
    </>
  )
}

function Arm({ a }: { a: ArmRow }) {
  return (
    <li className="or-arm" data-endoscope={a.endoscope ? 'true' : undefined} data-drape={a.drape ? 'on' : 'off'}>
      <div className="or-arm__head">
        <span className="rp-strong">{a.label}</span>
        <span className="or-arm__drape" aria-hidden="true" />
        <span className="or-arm__engage">{a.engage}</span>
      </div>
      <span className="or-arm__tool">{a.instrument}</span>
      <div className="sv-bar or-force" role="progressbar" aria-label={`${a.label}: ${SURGERY_UI.console.force}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.forcePct}>
        <span className="sv-bar__fill" style={{ width: `${a.forcePct}%` }} />
      </div>
    </li>
  )
}

/** The panel's markup from a view; `watching` is the endoscope card being open from this panel. Pure, so the render test can feed it hand-made state. */
export function OrPanel({ v, watching, onWatch }: { v: OrView; watching: boolean; onWatch: () => void }) {
  return (
    <div className="or">
      <div className="or-head">
        <span className="hud-chip or-tag">{v.tag}</span>
        <span className="rp-strong or-room">{v.room}</span>
      </div>
      <p className="rp-muted or-note" role="note">
        {v.note}
      </p>

      <Section title={SURGERY_UI.panel.list}>
        {v.cases.length === 0 ? (
          <p className="rp-muted">{SURGERY_UI.panel.empty.list}</p>
        ) : (
          <ul className="rp-list or-cases">
            {v.cases.map((c) => (
              <Case key={c.id} c={c} />
            ))}
          </ul>
        )}
      </Section>

      <Section title={SURGERY_UI.panel.phase}>
        {v.current === null ? <p className="rp-muted">{SURGERY_UI.panel.empty.room}</p> : <Current c={v.current} />}
      </Section>

      <Section title={SURGERY_UI.panel.robot}>
        <p className="rp-line or-robot">{v.robot.phase}</p>
        <p className="or-caption">{SURGERY_UI.console.arms}</p>
        <ul className="or-arms">
          {v.robot.arms.map((a) => (
            <Arm key={a.index} a={a} />
          ))}
        </ul>
      </Section>

      <Section title={SURGERY_UI.panel.team}>
        <ul className="rp-list or-team">
          {v.team.map((m) => (
            <li key={m.id} className="rp-list__item or-member" data-title={m.title} data-in={m.inOr ? 'true' : 'false'}>
              <span className="or-dot" aria-hidden="true" />
              <span className="or-member__name">{m.name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <div className="rp-stats or-kpis">
          {v.kpis.map((k) => (
            <div key={k.id} className="hud-metric">
              <span className="hud-metric__value">{k.value}</span>
              <span className="hud-metric__label">{k.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <button type="button" className="hud-send or-watch" aria-expanded={watching} onClick={onWatch}>
          {SURGERY_UI.panel.watch}
        </button>
        {watching && <ConsoleCardInline />}
      </Section>
    </div>
  )
}

/** Is the endoscope card open from this panel (not from the seat)? */
export const watchingPanel = (s: Pick<ConsoleCardState, 'open' | 'source'>): boolean => s.open && s.source === 'panel'

/** The button: open the card inside the panel, or close it when it is already open from here. */
export function toggleWatch(): void {
  useConsoleCard.getState().toggle('panel')
}

export function OrBody() {
  const read = useCallback(() => orView(sim.surgery.state, sim.t, teamOf(sim.entities)), [])
  const v = usePoll(read)
  const watching = useConsoleCard(watchingPanel)
  return <OrPanel v={v} watching={watching} onWatch={toggleWatch} />
}
