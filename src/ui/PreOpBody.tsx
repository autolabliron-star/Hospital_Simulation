/**
 * The pre-op bays panel (the room panel's body for `l2PreOp`, R2): a "Simulated" tag and the four pre-op bays, each with the patient, their procedure,
 * the planned wheels-in time, the minutes since they came in and a mark when the curtain is drawn. Reads the sim at 4 Hz through `usePoll` (the view
 * model is src/ui/preOpView.ts); nothing here runs per frame. All the words come from src/content/surgeryUi.json and src/content/surgery.json.
 */
import { useCallback } from 'react'
import { sim } from '@/sim'
import { NO_VALUE } from './orView'
import { preOpView, type PreOpBayRow, type PreOpView } from './preOpView'
import { usePoll } from './usePoll'
import './orBody.css'

function Bay({ b }: { b: PreOpBayRow }) {
  return (
    <li className="rp-list__item or-bay" data-occupied={b.occupied ? 'true' : 'false'} data-curtain={b.curtain ? 'drawn' : 'open'}>
      <span className="or-bay__label">{b.label}</span>
      {b.occupied ? (
        <>
          <span className="or-bay__text">
            <span className="rp-strong">{b.patient}</span>
            {b.procedure !== null && <span className="rp-muted">{b.procedure}</span>}
          </span>
          <span className="or-bay__side">
            {b.time !== null && <span className="or-bay__time">{b.time}</span>}
            <span className="or-bay__since">{b.since}</span>
          </span>
        </>
      ) : (
        <span className="or-bay__text rp-muted">{NO_VALUE}</span>
      )}
      <span className="or-curtain" aria-hidden="true" />
    </li>
  )
}

/** The panel's markup from a view. Pure, so the render test can feed it hand-made state. */
export function PreOpPanel({ v }: { v: PreOpView }) {
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

export function PreOpBody() {
  const read = useCallback(() => preOpView(sim.surgery.state, sim.t), [])
  return <PreOpPanel v={usePoll(read)} />
}
