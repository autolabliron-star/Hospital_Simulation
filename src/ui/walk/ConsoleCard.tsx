/**
 * The teaching-console card (R2): the OR's simulated endoscope view with the console's HUD, view only. Two homes, one card:
 *
 *   ConsoleCard         walk mode, beside the health card (WalkOverlay): open while YOU sit at the teaching console (source 'seat', src/scene/interact/surgery/teaching.ts
 *                       opens it, closes it when you stand up, and a closed card stands you up)
 *   ConsoleCardInline   inside the OR panel, under "Watch the endoscope view" (source 'panel'): the same card without sitting; while it is open it tells the sim
 *                       somebody is teaching (`sim.surgery.setTeaching`)
 *
 * The picture is a 768 x 432 (16:9) canvas repainted at 12 Hz ONLY while the card is mounted (consoleCard.canvas.ts), with the console's own HUD inside it; the
 * fact list under it (procedure, phase, console clock, each arm's instrument and force-feedback bar, insufflation) is read from the sim at 4 Hz (consoleCard.view.ts). Esc and the close button close it (Esc is the
 * interaction layer's: src/scene/interact/overlays.ts).
 */
import { useCallback, useEffect, useRef } from 'react'
import { SURGERY_UI } from '@/content/surgeryUi'
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { sim, simGeneration } from '@/sim'
import { usePoll } from '@/ui/usePoll'
import { CARD_H, CARD_W, ConsoleCanvas } from './consoleCard.canvas'
import { useConsoleCard } from './consoleCard.store'
import { consoleHud, type ConsoleHud } from './consoleCard.view'
import './consoleCard.css'

/** The card itself, from a view model: tests and the HUD render the same thing. `canvasRef` is the picture's canvas (null in tests). */
export function ConsoleCardView({ hud, onClose, inline = false, canvasRef }: { hud: ConsoleHud; onClose: () => void; inline?: boolean; canvasRef?: React.Ref<HTMLCanvasElement> }) {
  return (
    <section className={`hud-card walk-console${inline ? ' walk-console--inline' : ''}`} aria-label={hud.title} data-live={hud.live}>
      <header className="walk-console__head">
        <h2 className="walk-console__title">{hud.title}</h2>
        <button type="button" className="hud-icon-btn" aria-label={SURGERY_UI.console.leave} title={SURGERY_UI.console.leave} onClick={onClose}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="walk-console__view">
        <canvas ref={canvasRef} className="walk-console__canvas" width={CARD_W} height={CARD_H} role="img" aria-label={SURGERY_UI.console.endoscope} />
      </div>
      {hud.standby !== null && <p className="walk-console__standby">{hud.standby}</p>}
      <dl className="walk-console__facts">
        <div>
          <dt>{hud.procedureLabel}</dt>
          <dd>{hud.procedure === '' ? '–' : hud.procedure}</dd>
        </div>
        <div>
          <dt>{hud.phaseLabel}</dt>
          <dd>{hud.phase}</dd>
        </div>
        <div>
          <dt>{hud.clockLabel}</dt>
          <dd className="walk-console__clock">{hud.clock}</dd>
        </div>
      </dl>
      <h3 className="walk-console__sub">{hud.armsLabel}</h3>
      <ul className="walk-console__arms">
        {hud.arms.map((a) => (
          <li key={a.label} className="walk-console__arm" data-engaged={a.engaged}>
            <span className="walk-console__arm-name">{a.label}</span>
            <span className="walk-console__arm-tool">{a.instrument === '' ? '–' : a.instrument}</span>
            <span className="walk-console__bar" role="meter" aria-label={hud.forceLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.engaged ? a.force : 0}>
              <i style={{ width: `${a.engaged ? a.force : 0}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {hud.insufflation !== null && <p className="walk-console__gas">{hud.insufflation}</p>}
      <p className="walk-console__foot">{hud.leave}</p>
    </section>
  )
}

function Body({ source }: { source: 'seat' | 'panel' }) {
  const read = useCallback(() => consoleHud(sim.surgery.state, sim.t), [])
  const hud = usePoll(read)
  const close = useCallback(() => useConsoleCard.getState().close(), [])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // the picture: 12 Hz, only while this card is mounted; a Jump swaps the hospital, and the old card goes with it
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas ? (canvas.getContext('2d') as Ctx2D | null) : null
    if (!ctx) return undefined
    const painter = new ConsoleCanvas(ctx)
    const generation = simGeneration
    const tick = (): void => {
      if (simGeneration !== generation) {
        useConsoleCard.getState().close()
        return
      }
      painter.update(sim.surgery.state, sim.t, performance.now())
    }
    tick()
    const id = window.setInterval(tick, 1000 / 12)
    return () => window.clearInterval(id)
  }, [])

  // from the OR panel nobody sits down: while the card is open the sim knows somebody is teaching
  useEffect(() => {
    if (source !== 'panel') return undefined
    const mine = sim
    mine.surgery.setTeaching(true)
    return () => {
      const st = useConsoleCard.getState()
      // (sitting down at the console took the card over: the session owns the flag now)
      if (!(st.open && st.source === 'seat')) mine.surgery.setTeaching(false)
    }
  }, [source])

  return <ConsoleCardView hud={hud} onClose={close} inline={source === 'panel'} canvasRef={canvasRef} />
}

/** Walk mode: the card while you sit at the teaching console. */
export function ConsoleCard() {
  const open = useConsoleCard((s) => s.open && s.source === 'seat')
  return open ? <Body source="seat" /> : null
}

/** Inside the OR panel: the card opened by "Watch the endoscope view". */
export function ConsoleCardInline() {
  const open = useConsoleCard((s) => s.open && s.source === 'panel')
  return open ? <Body source="panel" /> : null
}
