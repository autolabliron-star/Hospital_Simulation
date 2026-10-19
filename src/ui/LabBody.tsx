/**
 * The lab panel (the room panel's body for the Lab): "Simulated, not real patient data", four numbers for the day, an SVG of the U track with a
 * box for every machine (coloured by its live status) and a dot for every tube in its cap colour, the tubes in the lab now (cap, tests, stage,
 * time since they arrived), the last three results, and a "Send a sample now" button that makes a background sample fly in through the pipe.
 * Reads the sim at 4 Hz through `usePoll` (the view model is src/ui/labView.ts); nothing here runs per frame or touches the 3D world.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { LAB_UI } from '@/content/labUi'
import { sim } from '@/sim'
import { labView, type ModuleBox, type Puck } from './labView'
import { usePoll } from './usePoll'
import './labBody.css'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rp-section">
      <h3 className="hud-field__label">{title}</h3>
      {children}
    </section>
  )
}

function Module({ m }: { m: ModuleBox }) {
  return (
    <g className="lb-module" data-status={m.status}>
      <title>{`${m.name}: ${m.note}`}</title>
      <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={4} />
      <text x={m.x + m.w / 2} y={m.y + m.h / 2} textAnchor="middle" dominantBaseline="central" transform={m.h > m.w * 1.6 ? `rotate(-90 ${m.x + m.w / 2} ${m.y + m.h / 2})` : undefined}>
        {m.short}
      </text>
    </g>
  )
}

function Dot({ p }: { p: Puck }) {
  return (
    <g className="lb-puck" data-stat={p.stat ? 'true' : undefined}>
      {p.stat && <circle cx={p.x} cy={p.y} r={7} className="lb-puck__ring" />}
      <circle cx={p.x} cy={p.y} r={4.5} fill={p.color} className="lb-puck__dot" />
    </g>
  )
}

/** How long the button stays quiet after a click, so a double click does not send two. */
const SEND_PAUSE_MS = 1500

export function LabBody() {
  const read = useCallback(() => labView(sim.lab, sim.t), [])
  const v = usePoll(read)
  const [sent, setSent] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  const send = (): void => {
    sim.lab.sendDemo()
    setSent(true)
    timer.current = window.setTimeout(() => setSent(false), SEND_PAUSE_MS)
  }

  return (
    <div className="lb">
      <p className="lb-sim" role="note">
        {v.simulated}
      </p>
      <p className="rp-muted lb-intro">{LAB_UI.intro}</p>

      <Section title={LAB_UI.sections.kpis}>
        <div className="rp-stats lb-kpis">
          {v.kpis.map((k) => (
            <div key={k.id} className="hud-metric">
              <span className="hud-metric__value">{k.value}</span>
              <span className="hud-metric__label">{k.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={LAB_UI.sections.track}>
        <svg className="lb-board" viewBox={`0 0 ${v.track.width} ${v.track.height}`} role="img" aria-label={LAB_UI.sections.track}>
          <rect className="lb-board__room" x={0} y={0} width={v.track.width} height={v.track.height} rx={8} />
          <path className="lb-board__bench" d={v.track.path} />
          <path className="lb-board__belt" d={v.track.path} />
          {v.track.modules.map((m) => (
            <Module key={m.id} m={m} />
          ))}
          {v.track.pucks.map((p) => (
            <Dot key={p.id} p={p} />
          ))}
          {v.track.flying && <circle className="lb-board__flight" cx={v.track.modules[0].x + v.track.modules[0].w / 2} cy={v.track.modules[0].y - 8} r={5} />}
        </svg>
        {v.track.empty && <p className="rp-muted">{LAB_UI.empty.track}</p>}
      </Section>

      <Section title={LAB_UI.sections.samples}>
        {v.samples.length === 0 ? (
          <p className="rp-muted">{LAB_UI.empty.samples}</p>
        ) : (
          <ul className="rp-list lb-samples">
            {v.samples.map((s) => (
              <li key={s.id} className="rp-list__item lb-sample">
                <span className="lb-cap" style={{ background: s.cap }} aria-hidden="true" />
                <span className="lb-sample__text">
                  <span className="rp-strong">
                    {s.title} {s.stat && <span className="hud-chip lb-stat">{LAB_UI.priority.stat}</span>}
                  </span>
                  <span className="rp-muted">{s.detail}</span>
                </span>
                <span className="lb-sample__side">
                  <span className="hud-chip lb-stage" data-tone={s.stageTone}>
                    {s.stage}
                  </span>
                  <span className="rp-muted">{s.since}</span>
                </span>
              </li>
            ))}
            {v.moreSamples > 0 && <li className="rp-muted">+{v.moreSamples}</li>}
          </ul>
        )}
      </Section>

      <Section title={LAB_UI.sections.results}>
        {v.results.length === 0 ? (
          <p className="rp-muted">{LAB_UI.empty.results}</p>
        ) : (
          <ul className="rp-list">
            {v.results.map((r) => (
              <li key={r.orderId} className="rp-list__item rp-list__item--stack">
                <span className="rp-strong">{r.name}</span>
                <span className="rp-muted">{r.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={LAB_UI.sections.send}>
        <button type="button" className="hud-send lb-send" disabled={sent} onClick={send}>
          {LAB_UI.send.button}
        </button>
        <p className="rp-muted">{LAB_UI.send.note}</p>
      </Section>
    </div>
  )
}
