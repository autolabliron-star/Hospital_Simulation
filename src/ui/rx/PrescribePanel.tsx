/**
 * The prescribing tablet (moved out of Hud.tsx, F-25). `initialRoom` is the room it starts on (E at a bedside, in walk mode); `walk`
 * puts the tablet away after a send, because your order is then followed by the objective line (src/scene/interact/yourOrder.ts). The
 * order it makes is the sim's 'presenter' order. A medicine row shows its dose, route and frequency from the catalogue. When the
 * pharmacist queries an order (a duplicate, or an interaction of the demo catalogue) it is held: a card under the list says why
 * and the presenter confirms or cancels it; nothing is dispensed before that. The tablet stays open while a query waits.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { patientInRoom } from '@/content/catalogue'
import { PRESENTER } from '@/content/presenter'
import { loop, sim } from '@/sim'
import { CONFIG } from '@/sim/config'
import { ROOM_IDS } from '@/sim/places'
import { L1_COPY } from '../l1Copy'
import { usePoll } from '../usePoll'
import { decideQuery, medRows, queryViews, RX_WORDS, sendOrder } from './rxModel'
import './rx.css'

/** Who is in a ward room now: the live occupant from the bed flow, or the bed state when it is empty. */
function roomOccupantName(roomId: string): string {
  const room = sim.life.rooms.get(roomId)
  if (!room) return patientInRoom(roomId).name
  return room.patientName ?? L1_COPY.bedStates[room.bed].label
}

/** In walk mode the tablet puts itself away this long after the order is sent, so you are back on your feet (real milliseconds). */
const WALK_SENT_CLOSE_MS = 1400

export function PrescribePanel({ onClose, initialRoom, walk }: { onClose: () => void; initialRoom: string | null; walk: boolean }) {
  const max = CONFIG.orders.maxItems
  const rows = useMemo(medRows, [])
  const [roomId, setRoomId] = useState(initialRoom && ROOM_IDS.includes(initialRoom) ? initialRoom : ROOM_IDS[0])
  const [picked, setPicked] = useState<string[]>([])
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  // the queries waiting for the presenter (re-read at about 4 Hz; they survive closing and reopening the tablet)
  const queries = usePoll(useCallback(() => queryViews(sim.meds), []))

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

  return (
    <section className="hud-card hud-rx" data-walk={walk} aria-label={PRESENTER.rx.panelLabel}>
      <header className="hud-rx__head">
        <span className="hud-rx__title">Prescribe</span>
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

      <fieldset className="hud-meds">
        <legend className="hud-field__label">
          Medicines <span className="hud-meds__count">{picked.length} of {max}</span>
        </legend>
        <ul className="hud-meds__list">
          {rows.map((m) => {
            const on = picked.includes(m.id)
            return (
              <li key={m.id}>
                <label className="hud-med" data-on={on} data-disabled={!on && picked.length >= max}>
                  <input type="checkbox" checked={on} disabled={!on && picked.length >= max} onChange={() => toggle(m.id)} />
                  <span className="hud-med__swatch" style={{ background: m.color }} aria-hidden="true" />
                  <span className="hud-med__name">{m.name}</span>
                  <span className="hud-med__strength">{m.strength}</span>
                  <span className="hud-med__plan">{m.plan}</span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>

      {queries.map((q) => (
        <section key={q.orderId} className="rx-query" aria-label={RX_WORDS.queryTitle} role="alert">
          <h3 className="rx-query__title">{RX_WORDS.queryTitle}</h3>
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

      {notice && (
        <p className="hud-rx__notice" data-ok={notice.ok} role="status">
          {notice.text}
        </p>
      )}
      <button type="button" className="hud-send" disabled={picked.length === 0} onClick={send}>
        Send
      </button>
    </section>
  )
}
