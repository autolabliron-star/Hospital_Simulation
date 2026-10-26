/**
 * R4: the CT cryoablation suite panel (the room panel's body for `l2Cryo` and `l2CryoControl`), modelled on the Scan viewer: a "Simulated" tag, the
 * live CT picture (384 px, Planning or Live, painted by the same painters as the room's screens, src/scene/cryoSuite/ctPaint.ts), the step and the
 * stepper, the needles, the console's readouts, today's list, the "Start a cryoablation now" button and the "Meet the devices" card.
 *
 * Reads the sim at 4 Hz through `usePoll` (the view model is src/ui/cryoSuiteView.ts); the picture repaints at most 4 Hz and only when what it shows
 * changes. Nothing here runs per frame or touches the 3D world. The model is brand-free; real products are named only on the card.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { domEnv } from '@/scene/imaging/images/ctx'
import { baseSliceFor, newBaseSliceCache, paintLive, paintPlanning } from '@/scene/cryoSuite/ctPaint'
import { newRepaintGate, shouldRepaint } from '@/scene/cryoSuite/screens'
import { sim } from '@/sim'
import type { CryoDemoResult } from '@/sim/cryoSuite/ports'
import type { CryoSuiteState } from '@/sim/types'
import { cryoSuiteView, type CryoSuiteView, type NeedleRow, type StepRow } from './cryoSuiteView'
import { usePoll } from './usePoll'
import './cryoSuite.css'

/** The picture's edge (px). */
export const LIVE_PX = 384

export type PictureMode = 'planning' | 'live'

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rp-section">
      {title !== undefined && <h3 className="hud-field__label">{title}</h3>}
      {children}
    </section>
  )
}

function Step({ s }: { s: StepRow }) {
  return (
    <li className="cr-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined} title={s.label}>
      <span className="cr-step__dot" aria-hidden="true" />
      {s.state === 'current' && <span className="cr-step__label">{s.label}</span>}
    </li>
  )
}

function Needle({ n, labels }: { n: NeedleRow; labels: CryoSuiteView['labels'] }) {
  return (
    <tr className="cr-needle" data-state={n.state} data-active={n.active ? 'true' : undefined}>
      <td className="rp-strong">{n.n}</td>
      <td>
        <div className="sv-bar cr-needle__in" role="progressbar" aria-label={n.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={n.insertedPct}>
          <span className="sv-bar__fill" style={{ width: `${n.insertedPct}%` }} />
        </div>
      </td>
      <td className="cr-needle__aligned">{n.aligned ?? '—'}</td>
      <td className="cr-needle__temp" aria-label={labels.tip}>
        {n.temp}
      </td>
    </tr>
  )
}

/** The live picture: a canvas the painters draw into while the panel is open. */
function Picture({ mode, state }: { mode: PictureMode; state: () => CryoSuiteState }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const base = newBaseSliceCache()
    const gate = newRepaintGate()
    const paint = () => {
      const s = state()
      // somebody is looking (the panel is open): the 4 Hz rate
      if (!shouldRepaint(gate, s, performance.now() / 1000, true)) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const slice = baseSliceFor(base, domEnv, s.imageSeed)
      if (mode === 'planning') paintPlanning(ctx, LIVE_PX, LIVE_PX, s, slice)
      else paintLive(ctx, LIVE_PX, LIVE_PX, s, slice)
    }
    paint()
    const id = window.setInterval(paint, 250)
    return () => window.clearInterval(id)
  }, [mode, state])
  return <canvas ref={ref} className="cr-picture" width={LIVE_PX} height={LIVE_PX} />
}

/** The panel's markup from a view. Pure (the picture aside), so the render test can feed it hand-made state. */
export function CryoSuitePanel({
  v,
  mode,
  onMode,
  onStart,
  picture,
}: {
  v: CryoSuiteView
  mode: PictureMode
  onMode: (m: PictureMode) => void
  onStart: () => void
  picture: ReactNode
}) {
  return (
    <div className="cr">
      <div className="cr-head">
        <span className="hud-chip cr-tag">{v.tag}</span>
        <span className="rp-strong cr-room">{v.title}</span>
      </div>

      <div className="cr-picture-wrap">
        {picture}
        <div className="cr-toggle" role="group">
          <button type="button" className="cr-toggle__btn" aria-pressed={mode === 'planning'} onClick={() => onMode('planning')}>
            {v.labels.planning}
          </button>
          <button type="button" className="cr-toggle__btn" aria-pressed={mode === 'live'} onClick={() => onMode('live')}>
            {v.labels.live}
          </button>
        </div>
      </div>

      <Section>
        <p className="rp-line cr-now">
          <span className="rp-strong">{v.step}</span>
          {v.patient !== null && <span className="rp-muted"> · {v.patient}</span>}
        </p>
        {v.needleNow !== null && <p className="cr-caption">{v.needleNow}</p>}
        <ol className="cr-steps">
          {v.steps.map((s) => (
            <Step key={s.step} s={s} />
          ))}
        </ol>
      </Section>

      {v.needles.length > 0 && (
        <Section>
          <table className="cr-needles">
            <tbody>
              {v.needles.map((n) => (
                <Needle key={n.n} n={n} labels={v.labels} />
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section>
        <div className="rp-stats cr-console">
          <div className="hud-metric">
            <span className="hud-metric__value">{v.console.timer}</span>
            <span className="hud-metric__label">{v.labels.timer}</span>
          </div>
          <div className="hud-metric">
            <span className="hud-metric__value">{v.console.margin}</span>
            <span className="hud-metric__label">{v.labels.margin}</span>
          </div>
          <div className="hud-metric">
            <span className="hud-metric__value">{v.console.ice ?? '—'}</span>
            <span className="hud-metric__label">{v.labels.ice}</span>
          </div>
          <div className="hud-metric">
            <span className="hud-metric__value">{v.console.coldest ?? '—'}</span>
            <span className="hud-metric__label">{v.labels.tip}</span>
          </div>
        </div>
        <p className="cr-lamps">
          <span className="cr-lamp" data-on={v.console.argon ? 'true' : 'false'} data-kind="argon">
            {v.labels.argon}
          </span>
          <span className="cr-lamp" data-on={v.console.heater ? 'true' : 'false'} data-kind="heater">
            {v.labels.heater}
          </span>
        </p>
      </Section>

      <Section title={v.labels.list}>
        {v.empty !== null ? (
          <p className="rp-muted">{v.empty}</p>
        ) : (
          <ul className="rp-list cr-cases">
            {v.list.map((c) => (
              <li key={c.id} className="rp-list__item cr-case" data-current={c.current ? 'true' : undefined}>
                <span className="cr-case__time">{c.time}</span>
                <span className="rp-strong cr-case__name">{c.patient}</span>
                <span className="hud-chip cr-case__step">{c.step}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section>
        <button type="button" className="hud-send cr-start" disabled={v.start.disabled} onClick={onStart}>
          {v.start.label}
        </button>
        {v.start.note !== null && (
          <p className="rp-muted cr-note" role="status">
            {v.start.note}
          </p>
        )}
      </Section>

      <Section title={v.card.title}>
        <div className="cr-card">
          <p>{v.card.robot}</p>
          <p>{v.card.console}</p>
          <p className="rp-muted cr-honesty">{v.card.honesty}</p>
        </div>
      </Section>
    </div>
  )
}

export function CryoSuiteBody() {
  const [last, setLast] = useState<CryoDemoResult | null>(null)
  const [mode, setMode] = useState<PictureMode>('live')
  const read = useCallback(() => cryoSuiteView(sim.cryoSuite.state, last), [last])
  const v = usePoll(read)
  const state = useCallback(() => sim.cryoSuite.state, [])
  const onStart = useCallback(() => setLast(sim.cryoSuite.startDemo()), [])
  return <CryoSuitePanel v={v} mode={mode} onMode={setMode} onStart={onStart} picture={<Picture mode={mode} state={state} />} />
}
