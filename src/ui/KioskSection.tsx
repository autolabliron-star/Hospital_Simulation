/**
 * The lobby panel's health-kiosk section (W4): for each of the two entrance kiosks who is using it and at which step, how many sessions today and the
 * last result ("Last: BP 124/79 · SpO₂ 98% · 36.6 °C"). Read from the sim at 4 Hz like every room panel. Simulated, like everything here.
 */
import { useCallback } from 'react'
import { sim } from '@/sim'
import { readKioskSection, type KioskSectionView } from './kioskView'
import { usePoll } from './usePoll'

export function KioskSectionView({ v }: { v: KioskSectionView }) {
  return (
    <section className="rp-section" aria-label={v.title}>
      <h3 className="hud-field__label">{v.title}</h3>
      <ul className="rp-list">
        {v.rows.map((r) => (
          <li key={r.n} className="rp-list__item rp-list__item--stack">
            <span className="rp-strong">
              <span className="hud-chip" data-tone={r.free ? 'idle' : 'busy'}>
                {r.n}
              </span>{' '}
              {r.line}
              {r.assisted ? <span className="rp-muted"> · {v.assistedLabel}</span> : null}
            </span>
            <span className="rp-muted">{r.last}</span>
            <span className="rp-muted">{r.today}</span>
          </li>
        ))}
      </ul>
      <p className="rp-muted">{v.disclaimer}</p>
    </section>
  )
}

export function KioskSection() {
  const read = useCallback(() => readKioskSection(sim), [])
  return <KioskSectionView v={usePoll(read)} />
}
