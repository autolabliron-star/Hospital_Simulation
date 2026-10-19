/**
 * The recovery (PACU) panel (the room panel's body for `l2Pacu`, R2): a "Simulated" tag and the three recovery bays, each with the patient, the minutes
 * since they came in and where they go next. Reads the sim at 4 Hz through `usePoll` (the view model is src/ui/pacuView.ts); nothing here runs per
 * frame. All the words come from src/content/surgeryUi.json and src/content/surgery.json.
 */
import { useCallback } from 'react'
import { sim } from '@/sim'
import { NO_VALUE } from './orView'
import { pacuView, type PacuBayRow, type PacuView } from './pacuView'
import { usePoll } from './usePoll'
import './orBody.css'

function Bay({ b }: { b: PacuBayRow }) {
  return (
    <li className="rp-list__item or-bay" data-occupied={b.occupied ? 'true' : 'false'}>
      <span className="or-bay__label">{b.label}</span>
      {b.occupied ? (
        <>
          <span className="or-bay__text">
            <span className="rp-strong">{b.patient}</span>
            {b.outcome !== null && <span className="or-case__outcome">{b.outcome}</span>}
          </span>
          <span className="or-bay__since">{b.since}</span>
        </>
      ) : (
        <span className="or-bay__text rp-muted">{NO_VALUE}</span>
      )}
    </li>
  )
}

/** The panel's markup from a view. Pure, so the render test can feed it hand-made state. */
export function PacuPanel({ v }: { v: PacuView }) {
  return (
    <div className="or">
      <div className="or-head">
        <span className="hud-chip or-tag">{v.tag}</span>
      </div>
      <section className="rp-section">
        <h3 className="hud-field__label">{v.title}</h3>
        {v.empty !== null && <p className="rp-muted">{v.empty}</p>}
        <ul className="rp-list or-bays">
          {v.bays.map((b) => (
            <Bay key={b.n} b={b} />
          ))}
        </ul>
      </section>
    </div>
  )
}

export function PacuBody() {
  const read = useCallback(() => pacuView(sim.surgery.state, sim.t), [])
  return <PacuPanel v={usePoll(read)} />
}
