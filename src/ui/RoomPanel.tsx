/**
 * The Room panel: opens on the right when the presenter enters a room (click, "Go to…" or the G menu) and closes with Esc
 * or its close button. Imaging rooms show the Scan viewer; a ward room shows its patient, drawer and orders; the pharmacy core
 * shows pods and the picking queue; every other area shows who is there.
 *
 * Reads the sim at 4 Hz through `usePoll`; nothing here runs per frame or touches the 3D world.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { modalityOfArea, useFocus } from '@/scene/camera/focus.store'
import { unfocus } from '@/scene/camera/roomFocus'
import { sim } from '@/sim'
import { areaById, type AreaId } from '@/sim/places'
import { useJump } from './jump.store'
import { L1_COPY } from './l1Copy'
import { ScanViewer } from './ScanViewer'
import { MODALITY_NAME } from './scanPhase'
import { describeHere, roomView, type GenericRoomView, type HereNow, type PharmacyView, type RoomView, type WardRoomView } from './roomSnapshot'
import { usePoll } from './usePoll'
import { wardLifeView, type WardLifeView } from './wardRoomView'
import './roomPanel.css'
import { DrawCentreBody } from './DrawCentreBody'
import { KioskSection } from './KioskSection'
import { LabBody } from './LabBody'
import { OrBody } from './OrBody'
import { PacuBody } from './PacuBody'
import { PreOpBody } from './PreOpBody'

/** How long the panel stays mounted after Esc so it can slide out. Matches `rp-out` in roomPanel.css. */
const EXIT_MS = 240

/** Keeps the last area around while the panel slides out. */
function usePresence(area: AreaId | null): { shown: AreaId | null; closing: boolean } {
  const [shown, setShown] = useState<AreaId | null>(area)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (area) {
      setShown(area)
      setClosing(false)
      return
    }
    setClosing(true)
    const id = window.setTimeout(() => {
      setShown(null)
      setClosing(false)
    }, EXIT_MS)
    return () => window.clearTimeout(id)
  }, [area])
  return { shown, closing }
}

// ---------------------------------------------------------------------------------------------
// Bodies for non-imaging rooms
// ---------------------------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rp-section">
      <h3 className="hud-field__label">{title}</h3>
      {children}
    </section>
  )
}

function HereList({ here }: { here: HereNow }) {
  return (
    <>
      <p className="rp-line">{describeHere(here)}</p>
      {here.names.length > 0 && (
        <p className="rp-muted">
          {here.names.join(', ')}
          {here.total > here.names.length ? ` and ${here.total - here.names.length} more` : ''}
        </p>
      )}
    </>
  )
}

const WARD_COPY = L1_COPY.room

/** The synthetic patient (or the empty bed), the bed state and today's plan: the living-day part of a ward room (L1). */
function WardLife({ life }: { life: WardLifeView }) {
  return (
    <>
      <Section title={WARD_COPY.patient}>
        <p className="rp-big">
          {life.headline}
          {life.age !== null && <span className="rp-muted"> · {life.age}</span>}
        </p>
        {life.stay && <p className="rp-muted">{life.stay}</p>}
        {life.reason && <p className="rp-line">{life.reason}</p>}
        {life.notice && <p className="rp-line">{life.notice}</p>}
      </Section>
      <Section title={WARD_COPY.bedState}>
        <p className="rp-line rp-bed">
          <span className="rp-swatch" style={{ background: life.bedColor }} aria-hidden="true" />
          <span className="rp-strong">{life.bedLabel}</span>
          <span className="rp-muted">{life.bedSince}</span>
        </p>
        <p className="rp-muted">{life.bedDetail}</p>
      </Section>
      {life.plan && (
        <Section title={WARD_COPY.todaysPlan}>
          <ul className="rp-list">
            <li className="rp-list__item rp-list__item--stack">
              <span className="rp-muted">{WARD_COPY.nextDose}</span>
              <span className="rp-strong">{life.plan.nextDose}</span>
            </li>
            <li className="rp-list__item rp-list__item--stack">
              <span className="rp-muted">{WARD_COPY.meals}</span>
              <span className="rp-strong">{life.plan.meals}</span>
            </li>
            <li className="rp-list__item rp-list__item--stack">
              <span className="rp-muted">{WARD_COPY.discharge}</span>
              <span className="rp-strong">{life.plan.discharge}</span>
            </li>
          </ul>
        </Section>
      )}
    </>
  )
}

function WardBody({ v, life }: { v: WardRoomView; life: WardLifeView | null }) {
  return (
    <>
      {life ? (
        <WardLife life={life} />
      ) : (
        <Section title={WARD_COPY.patient}>
          <p className="rp-big">
            {v.patient.name} <span className="rp-muted">· {v.patient.age}</span>
          </p>
          <p className="rp-line">{v.patient.reason}</p>
        </Section>
      )}
      <Section title="Medicine drawer">
        <p className="rp-line">
          <span className="hud-chip" data-tone={v.drawer.loaded ? 'ok' : 'idle'}>
            {v.drawer.loaded ? 'Loaded' : 'Empty'}
          </span>
          {v.drawer.lightOn && (
            <span className="hud-chip" data-tone="due">
              Dose due
            </span>
          )}
        </p>
        {v.drawer.items.length > 0 && (
          <ul className="rp-list">
            {v.drawer.items.map((m) => (
              <li key={m.name} className="rp-list__item">
                <span className="rp-swatch" style={{ background: m.color }} aria-hidden="true" />
                <span>
                  {m.name} {m.strength}
                  {m.qty > 1 ? ` ×${m.qty}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Orders in progress">
        {v.orders.length === 0 ? (
          <p className="rp-muted">No orders on the way.</p>
        ) : (
          <ul className="rp-list">
            {v.orders.map((o) => (
              <li key={o.id} className="rp-list__item rp-list__item--stack">
                <span className="rp-strong">{o.stage}</span>
                <span className="rp-muted">{o.meds}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="In the room now">
        <HereList here={v.here} />
      </Section>
    </>
  )
}

function PharmacyBody({ v }: { v: PharmacyView }) {
  return (
    <>
      <Section title="MedPods">
        <div className="rp-stats">
          <div className="hud-metric">
            <span className="hud-metric__value">{v.podsBusy}</span>
            <span className="hud-metric__label">Busy</span>
          </div>
          <div className="hud-metric">
            <span className="hud-metric__value">{v.podsCharging}</span>
            <span className="hud-metric__label">Charging</span>
          </div>
        </div>
      </Section>
      <Section title="Picking now">
        {v.picking.length === 0 ? (
          <p className="rp-muted">The picker is idle.</p>
        ) : (
          <ul className="rp-list">
            {v.picking.map((p) => (
              <li key={p.orderId} className="rp-list__item rp-list__item--stack">
                <span className="rp-strong">
                  Order for room {p.roomId} <span className="rp-muted">· ward {p.ward}</span>
                </span>
                <span className="rp-muted">
                  Pack {p.pack} of {p.packs}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`Queue${v.queueTotal > 0 ? ` (${v.queueTotal})` : ''}`}>
        {v.queue.length === 0 ? (
          <p className="rp-muted">No orders waiting.</p>
        ) : (
          <ul className="rp-list">
            {v.queue.map((q) => (
              <li key={q.orderId} className="rp-list__item rp-list__item--stack">
                <span className="rp-strong">Room {q.roomId}</span>
                <span className="rp-muted">{q.stage}</span>
              </li>
            ))}
            {v.queueTotal > v.queue.length && <li className="rp-muted">and {v.queueTotal - v.queue.length} more</li>}
          </ul>
        )}
      </Section>
      <Section title="In the room now">
        <HereList here={v.here} />
      </Section>
    </>
  )
}

function GenericBody({ v }: { v: GenericRoomView }) {
  return (
    <Section title="Here now">
      <HereList here={v.here} />
    </Section>
  )
}

/** The room's snapshot, and for a ward room its living-day view (bed state, patient, today's plan). `sim` is the live binding. */
function readRoom(area: AreaId): { v: RoomView; life: WardLifeView | null } {
  const v = roomView(sim, area)
  return { v, life: v.kind === 'ward' ? wardLifeView(sim, v.roomId) : null }
}

function RoomBody({ area }: { area: AreaId }) {
  const read = useCallback(() => readRoom(area), [area])
  const { v, life } = usePoll(read)
  if (v.kind === 'ward') return <WardBody v={v} life={life} />
  if (v.kind === 'pharmacy') return <PharmacyBody v={v} />
  // W4: the robot draw centre, the lab, and the lobby's health kiosks
  if (area === 'diagnostics') return <DrawCentreBody />
  if (area === 'lab') return <LabBody />
  // R2: the robotic surgery suite on level 2
  if (area === 'l2Or') return <OrBody />
  if (area === 'l2Pacu') return <PacuBody />
  if (area === 'l2PreOp') return <PreOpBody />
  if (area === 'lobby')
    return (
      <>
        <KioskSection />
        <GenericBody v={v} />
      </>
    )
  return <GenericBody v={v} />
}

// ---------------------------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------------------------

function titlesFor(area: AreaId): { title: string; subtitle: string } {
  const a = areaById(area)
  const modality = modalityOfArea(area)
  if (modality) return { title: MODALITY_NAME[modality], subtitle: a.subtitle || 'Control room' }
  return { title: a.label, subtitle: a.ward && a.kind === 'room' ? `Ward ${a.ward}` : a.subtitle }
}

export function RoomPanel() {
  const area = useFocus((s) => s.area)
  // A Jump swaps the hospital under an open panel: the body is rebuilt on the new one (the focus itself stays valid).
  const generation = useJump((s) => s.generation)
  const { shown, closing } = usePresence(area)

  // The HUD's KPI card and event line make way for the panel (see roomPanel.css).
  useEffect(() => {
    const root = document.documentElement
    if (area) root.dataset.roomPanel = 'open'
    else delete root.dataset.roomPanel
    return () => {
      delete root.dataset.roomPanel
    }
  }, [area])

  if (!shown) return null
  const modality = modalityOfArea(shown)
  const { title, subtitle } = titlesFor(shown)

  return (
    <div className="hud rp-layer">
      <aside className="hud-card rp" data-state={closing ? 'closing' : 'open'} aria-label={`Room panel: ${title}`}>
        <header className="rp-head">
          <div className="rp-head__titles">
            <h2 className="rp-head__title">{title}</h2>
            {subtitle && <p className="rp-head__sub">{subtitle}</p>}
          </div>
          <button type="button" className="hud-icon-btn" aria-label={`Close ${title} and go back to the overview`} title="Back to the overview (Esc)" onClick={unfocus}>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="rp-body">{modality ? <ScanViewer key={`${modality}:${generation}`} modality={modality} /> : <RoomBody key={`${shown}:${generation}`} area={shown} />}</div>
      </aside>
    </div>
  )
}
