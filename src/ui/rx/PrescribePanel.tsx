/**
 * The bedside tablet (moved out of Hud.tsx, F-25). `initialRoom` is the room it starts on (E at a bedside, in walk mode); `walk`
 * puts the tablet away after a send, because your order is then followed by the objective line (src/scene/interact/yourOrder.ts). The
 * order it makes is the sim's 'presenter' order. A medicine row shows its dose, route and frequency from the catalogue. When the
 * pharmacist queries an order (a duplicate, an interaction of the demo catalogue, or a recorded allergy) it is held: a card under the list
 * says why and the presenter confirms or cancels it; nothing is dispensed before that. The tablet stays open while a query waits.
 *
 * Two tabs over the same room: Prescribe (the order) and Record (the patient record, src/ui/rx/record). The medicines the patient in the room
 * has a recorded allergy to carry an "Allergy" tag in the list; the query cards show on both tabs. The bedside E opens on Record (rx.store); the Record tab fills
 * the column top to bottom and scrolls inside (src/styles/presenter.css, record.css).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { patientInRoom } from '@/content/catalogue'
import { RECORD_UI } from '@/content/patientHistory'
import { PRESENTER } from '@/content/presenter'
import { loop, sim } from '@/sim'
import { CONFIG } from '@/sim/config'
import { ROOM_IDS } from '@/sim/places'
import { allergyMedsInRoom } from '@/sim/records/record'
import { L1_COPY } from '../l1Copy'
import { usePoll } from '../usePoll'
import { useRx, type RxTab } from '../walk/rx.store'
import { RecordBody } from './record/RecordPanel'
import { decideQuery, medRows, queryViews, RX_WORDS, sendOrder } from './rxModel'
import './rx.css'
import './record/record.css'

/** Who is in a ward room now: the live occupant from the bed flow, or the bed state when it is empty. */
function roomOccupantName(roomId: string): string {
  const room = sim.life.rooms.get(roomId)
  if (!room) return patientInRoom(roomId).name
  return room.patientName ?? L1_COPY.bedStates[room.bed].label
}

/** In walk mode the tablet puts itself away this long after the order is sent, so you are back on your feet (real milliseconds). */
const WALK_SENT_CLOSE_MS = 1400

const TABS: readonly RxTab[] = ['record', 'prescribe'] as const

export interface PrescribePanelProps {
  onClose: () => void
  initialRoom: string | null
  walk: boolean
  /** The tab to show; default: the store's (useRx.tab), which the tab buttons set. Tests pass it (the server render reads a store's initial state). */
  tab?: RxTab
}

export function PrescribePanel({ onClose, initialRoom, walk, tab: tabProp }: PrescribePanelProps) {
  const max = CONFIG.orders.maxItems
  const rows = useMemo(medRows, [])
  const storeTab = useRx((s) => s.tab)
  const tab = tabProp ?? storeTab
  const [roomId, setRoomId] = useState(initialRoom && ROOM_IDS.includes(initialRoom) ? initialRoom : ROOM_IDS[0])
  const [picked, setPicked] = useState<string[]>([])
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  // the queries waiting for the presenter (re-read at about 4 Hz; they survive closing and reopening the tablet)
  const queries = usePoll(useCallback(() => queryViews(sim.meds), []))
  // the medicines the patient in the room has a recorded allergy to (patient record), for the tag in the list
  const allergyMeds = usePoll(useCallback(() => [...allergyMedsInRoom(sim, roomId)].sort(), [roomId]))

  const toggle = (medId: string) => {
    setNotice(null)
    setPicked((p) => (p.includes(medId) ? p.filter((id) => id !== medId) : p.length >= max ? p : [...p, medId]))
  }

  const send = () => {
    const out = sendOrder(sim, roomId, picked)
    loop.publishNow()
    if (out.kind === 'error') {
      setNotice({ ok: false, text: out.text })
      return
    }
    setNotice({ ok: out.kind === 'sent', text: out.text })
    setPicked([])
    // a queried order is held for a decision: keep the tablet up until it is settled
    if (out.kind === 'sent' && walk) closeTimer.current = window.setTimeout(onClose, WALK_SENT_CLOSE_MS)
  }

  const decide = (q: (typeof queries)[number], decision: 'confirm' | 'cancel') => {
    const out = decideQuery(sim, q, decision)
    loop.publishNow()
    if (!out.ok) return
    setNotice({ ok: decision === 'confirm', text: out.text })
    if (decision === 'confirm' && walk) closeTimer.current = window.setTimeout(onClose, WALK_SENT_CLOSE_MS)
  }

  const tabLabel = (t: RxTab) => (t === 'record' ? RECORD_UI.recordTab : RECORD_UI.prescribeTab)

  return (
    <section className="hud-card hud-rx" data-walk={walk} data-tab={tab} aria-label={PRESENTER.rx.panelLabel}>
      <header className="hud-rx__head">
        <div className="rx-tabs" role="tablist" aria-label={RECORD_UI.tabsLabel as string}>
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              className="rx-tab"
              aria-selected={tab === t}
              onClick={(e) => {
                useRx.getState().setTab(t)
                setNotice(null)
                // hand the keys back to the page (Space pauses, P closes), as the other HUD buttons do
                e.currentTarget.blur()
              }}
            >
              {tabLabel(t)}
            </button>
          ))}
        </div>
        <button type="button" className="hud-icon-btn" aria-label="Close prescribe panel" title="Close (P)" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <label className="hud-field">
        <span className="hud-field__label">Room</span>
        <select
          className="hud-select"
          value={roomId}
          onChange={(e) => {
            setRoomId(e.target.value)
            setNotice(null)
            // F-37: a focused <select> would swallow P (and, before the fix in interact/keys.ts, Esc): hand the keys back to the page
            e.currentTarget.blur()
          }}
        >
          {ROOM_IDS.map((id) => (
            <option key={id} value={id}>
              {id} · {roomOccupantName(id)}
            </option>
          ))}
        </select>
      </label>

      {queries.map((q) => (
        <section key={q.orderId} className="rx-query" data-kind={q.allergy ? 'allergy' : 'query'} aria-label={q.allergy ? RX_WORDS.allergyTitle : RX_WORDS.queryTitle} role="alert">
          <h3 className="rx-query__title">{q.allergy ? RX_WORDS.allergyTitle : RX_WORDS.queryTitle}</h3>
          <p className="rx-query__for">
            {q.title}: {q.meds}
          </p>
          <ul className="rx-query__reasons">
            {q.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="rx-query__held">{q.heldNote}</p>
          <div className="rx-query__actions">
            <button type="button" className="rx-query__btn" data-kind="confirm" onClick={() => decide(q, 'confirm')}>
              {RX_WORDS.confirm}
            </button>
            <button type="button" className="rx-query__btn" data-kind="cancel" onClick={() => decide(q, 'cancel')}>
              {RX_WORDS.cancel}
            </button>
          </div>
        </section>
      ))}

      {tab === 'record' ? (
        <RecordBody roomId={roomId} />
      ) : (
        <>
          <fieldset className="hud-meds">
            <legend className="hud-field__label">
              Medicines <span className="hud-meds__count">{picked.length} of {max}</span>
            </legend>
            <ul className="hud-meds__list">
              {rows.map((m) => {
                const on = picked.includes(m.id)
                const allergy = allergyMeds.includes(m.id)
                return (
                  <li key={m.id}>
                    <label className="hud-med" data-on={on} data-disabled={!on && picked.length >= max} data-allergy={allergy}>
                      <input type="checkbox" checked={on} disabled={!on && picked.length >= max} onChange={() => toggle(m.id)} />
                      <span className="hud-med__swatch" style={{ background: m.color }} aria-hidden="true" />
                      <span className="hud-med__name">
                        {m.name}
                        {allergy && (
                          <span className="hud-med__allergy" title={RECORD_UI.allergyMedTitle as string}>
                            {RECORD_UI.allergyMedBadge as string}
                          </span>
                        )}
                      </span>
                      <span className="hud-med__strength">{m.strength}</span>
                      <span className="hud-med__plan">{m.plan}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>

          {notice && (
            <p className="hud-rx__notice" data-ok={notice.ok} role="status">
              {notice.text}
            </p>
          )}
          <button type="button" className="hud-send" disabled={picked.length === 0} onClick={send}>
            Send
          </button>
        </>
      )}
    </section>
  )
}
