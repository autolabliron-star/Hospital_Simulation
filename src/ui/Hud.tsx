/**
 * M1 HUD: a DOM overlay on top of the canvas. Slow state (clock, KPIs, order counts, events) comes from the
 * zustand world store, which the sim loop publishes at about 4 Hz; nothing here reads per-frame data.
 *
 *   top left     title, clock, speed and pause
 *   top right    KPI card ("simulated") and the dev Prescribe panel (a stand-in for the M4 tablet panel)
 *   bottom       the event line (one sentence at a time) above the order rail
 *
 * Walk mode (W1) is the quiet branch of the same root: a small clock, the minimap, the interact prompt, the objective line, a key hint
 * and the MedDrawer card, with no KPI card, order rail or event line (src/ui/walk, which parts show is `hudVisibility`). The
 * Prescribe panel is the one tablet in both modes: P opens it, and E at a patient's bedside opens it on that room. H hides it all.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MEDICINES, patientInRoom } from '@/content/catalogue'
import { useWalk } from '@/scene/player/state'
import { loop, sim } from '@/sim'
import { CONFIG } from '@/sim/config'
import { ROOM_IDS } from '@/sim/places'
import { DEFAULT_KEYMAP, ORDER_STAGES, type OrderStage, type PlayerMode, type SimEvent } from '@/sim/types'
import { useWorld } from '@/sim/world.store'
import { dayStatsTracker } from './dayStats'
import { useJump } from './jump.store'
import { fillCopy, L1_COPY } from './l1Copy'
import { installLevelKey } from './levelKey'
import { LevelSwitch } from './LevelSwitch'
import { switchShown } from './levelSwitchModel'
import { usePoll } from './usePoll'
import { useHudPrefs } from './walk/hudPrefs.store'
import { Minimap } from './walk/Minimap'
import { useRx } from './walk/rx.store'
import { activatesOnSpace, isTyping } from './walk/typing'
import { hudKind, hudVisibility } from './walk/visibility'
import { WalkClock } from './walk/WalkClock'
import { WalkOverlay } from './walk/WalkOverlay'
import './hud.css'

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------

function setSpeed(n: number): void {
  loop.speed = n
  loop.publishNow()
}

function togglePause(): void {
  loop.paused = !loop.paused
  loop.publishNow()
}

function useHotkeys(onPrescribe: () => void): void {
  useEffect(() => {
    const km = DEFAULT_KEYMAP
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      switch (e.code) {
        case km.pause:
          if (activatesOnSpace(e.target)) return
          e.preventDefault()
          togglePause()
          break
        case km.speed1:
          setSpeed(1)
          break
        case km.speed2:
          setSpeed(2)
          break
        case km.speed4:
          setSpeed(4)
          break
        case km.prescribe:
          onPrescribe()
          break
        case km.jump:
          useJump.getState().toggle()
          break
        case km.cleanScreen:
          useHudPrefs.getState().toggle()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPrescribe])
}

// ---------------------------------------------------------------------------------------------
// Top left: title, clock, speed
// ---------------------------------------------------------------------------------------------

const SPEEDS = [1, 2, 4] as const

function TitleCard() {
  const clock = useWorld((s) => s.clock)
  const speed = useWorld((s) => s.speed)
  const paused = useWorld((s) => s.paused)
  return (
    <section className="hud-card hud-title" aria-label="Clock and speed">
      <h1 className="hud-title__name">The Ideal Hospital</h1>
      <div className="hud-title__row">
        <span className="hud-clock" aria-label={`Simulated time ${clock}`}>
          {clock}
        </span>
        <div className="hud-seg" role="group" aria-label="Simulation speed">
          {SPEEDS.map((n) => (
            <button
              key={n}
              type="button"
              className="hud-seg__btn"
              aria-pressed={speed === n}
              title={`Speed ${n}× (key ${n})`}
              onClick={(e) => {
                setSpeed(n)
                e.currentTarget.blur()
              }}
            >
              {n}×
            </button>
          ))}
          <button
            type="button"
            className="hud-seg__btn hud-seg__btn--icon"
            aria-pressed={paused}
            aria-label={paused ? 'Resume' : 'Pause'}
            title={paused ? 'Resume (Space)' : 'Pause (Space)'}
            onClick={(e) => {
              togglePause()
              e.currentTarget.blur()
            }}
          >
            {paused ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="hud-jump"
        title={L1_COPY.jump.buttonTitle}
        onClick={(e) => {
          useJump.getState().setOpen(true)
          e.currentTarget.blur()
        }}
      >
        {L1_COPY.jump.button}
        <kbd className="hud-kbd">J</kbd>
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Top right: KPIs
// ---------------------------------------------------------------------------------------------

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="hud-metric">
      <span className="hud-metric__value">
        {value}
        {unit && <span className="hud-metric__unit"> {unit}</span>}
      </span>
      <span className="hud-metric__label">{label}</span>
    </div>
  )
}

/** Read at about 4 Hz (usePoll), from the event log and `sim.life`; `sim` is the live binding, so a Jump needs nothing here. */
const readDayStats = () => dayStatsTracker.read(sim)

/** L1: beds, discharges before noon, ER boarding and meals on time. */
function DayMetrics() {
  const d = usePoll(readDayStats)
  const c = L1_COPY.kpi
  const boarding = d.boardingCount === 0 ? c.erBoardingNone : fillCopy(c.erBoardingValue, { n: d.boardingCount, min: d.boardingLongestMin })
  const meals = d.mealsServed === 0 ? '–' : `${d.mealsOnTime} / ${d.mealsServed}`
  return (
    <>
      <h3 className="hud-kpi__sub">{c.bedsHeading}</h3>
      <div className="hud-kpi__grid">
        <Metric label={c.bedsOccupiedReady} value={`${d.bedsOccupied} / ${d.bedsReady}`} />
        <Metric label={c.dischargesBeforeNoon} value={String(d.dischargesBeforeNoon)} />
        <Metric label={c.erBoarding} value={boarding} />
        <Metric label={c.mealsOnTime} value={meals} />
      </div>
    </>
  )
}

function KpiCard() {
  const k = useWorld((s) => s.kpis)
  const median = k.medianOrderToDrawerMin === null ? '–' : k.medianOrderToDrawerMin.toFixed(1)
  return (
    <section className="hud-card hud-kpi" aria-label="Key figures">
      <header className="hud-kpi__head">
        <span className="hud-kpi__title">Today</span>
        <span className="hud-chip">simulated</span>
      </header>
      <div className="hud-kpi__grid">
        <Metric label="Deliveries" value={String(k.delivered)} />
        <Metric label="Given" value={String(k.given)} />
        <Metric label="Order to drawer, median" value={median} unit={k.medianOrderToDrawerMin === null ? undefined : 'min'} />
        <Metric label="Pods busy / charging" value={`${k.podsBusy} / ${k.podsCharging}`} />
      </div>
      <DayMetrics />
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Bottom: event line and order rail
// ---------------------------------------------------------------------------------------------

/** Each sentence stays on screen at least this long. */
const HOLD_MS = 2500
/** If events pile up (fast forward), only the newest few wait their turn. */
const MAX_PENDING = 2

function EventLine() {
  const events = useWorld((s) => s.events)
  const [shown, setShown] = useState<SimEvent | null>(null)
  const queue = useRef<SimEvent[]>([])
  const lastId = useRef<number>(useWorld.getState().events.at(-1)?.id ?? 0)
  const shownAt = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  const pump: () => void = useCallback(() => {
    if (timer.current !== undefined || queue.current.length === 0) return
    const show = () => {
      timer.current = undefined
      const next = queue.current.shift()
      if (!next) return
      shownAt.current = performance.now()
      setShown(next)
      pump()
    }
    const wait = HOLD_MS - (performance.now() - shownAt.current)
    if (wait <= 0) show()
    else timer.current = window.setTimeout(show, wait)
  }, [])

  useEffect(() => {
    // A Jump swaps in a hospital whose event ids start again from 1: forget the old ones and anything still waiting
    if ((events.at(-1)?.id ?? 0) < lastId.current) {
      lastId.current = 0
      queue.current.length = 0
    }
    let added = false
    for (const e of events) {
      if (e.id <= lastId.current) continue
      lastId.current = e.id
      if (e.type === 'itemPicked') continue
      queue.current.push(e)
      added = true
    }
    if (queue.current.length > MAX_PENDING) queue.current.splice(0, queue.current.length - MAX_PENDING)
    if (added) pump()
  }, [events, pump])

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      timer.current = undefined
    },
    [],
  )

  return (
    <p className="hud-card hud-event" aria-live="polite">
      {shown ? (
        <span key={shown.id} className="hud-event__text">
          {shown.text}
        </span>
      ) : (
        <span className="hud-event__idle">The hospital is running. Press P to prescribe a medicine and follow it.</span>
      )}
    </p>
  )
}

const STAGE_LABEL: Record<OrderStage, string> = {
  prescribed: 'Prescribed',
  verified: 'Verified',
  picking: 'Picking',
  enRoute: 'En route',
  inDrawer: 'In drawer',
  given: 'Given',
}

function OrderRail() {
  const counts = useWorld((s) => s.stageCounts)
  return (
    <section className="hud-card hud-rail" aria-label="Orders by stage">
      {ORDER_STAGES.map((stage, i) => (
        <Fragment key={stage}>
          {i > 0 && <span className="hud-rail__link" aria-hidden="true" />}
          <div className="hud-rail__stage" data-active={counts[stage] > 0}>
            <span className="hud-rail__count">{counts[stage]}</span>
            <span className="hud-rail__label">{STAGE_LABEL[stage]}</span>
          </div>
        </Fragment>
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Dev prescribe panel (stand-in for the M4 tablet panel)
// ---------------------------------------------------------------------------------------------

/** Who is in a ward room now: the live occupant from the bed flow, or the bed state when it is empty. */
function roomOccupantName(roomId: string): string {
  const room = sim.life.rooms.get(roomId)
  if (!room) return patientInRoom(roomId).name
  return room.patientName ?? L1_COPY.bedStates[room.bed].label
}

/** In walk mode the tablet puts itself away this long after the order is sent, so you are back on your feet (real milliseconds). */
const WALK_SENT_CLOSE_MS = 1400

/**
 * The prescribing tablet. `initialRoom` is the room it starts on (E at a bedside, in walk mode); `walk` puts the tablet away after
 * a send, because your order is then followed by the objective line (src/scene/interact/yourOrder.ts). The order it makes is the
 * sim's 'presenter' order, which is what the objective line tracks as "your order".
 */
function PrescribePanel({ onClose, initialRoom, walk }: { onClose: () => void; initialRoom: string | null; walk: boolean }) {
  const max = CONFIG.orders.maxItems
  const [roomId, setRoomId] = useState(initialRoom && ROOM_IDS.includes(initialRoom) ? initialRoom : ROOM_IDS[0])
  const [picked, setPicked] = useState<string[]>([])
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const toggle = (medId: string) => {
    setNotice(null)
    setPicked((p) => (p.includes(medId) ? p.filter((id) => id !== medId) : p.length >= max ? p : [...p, medId]))
  }

  const send = () => {
    const result = sim.prescribe(
      roomId,
      picked.map((medId) => ({ medId, qty: 1 })),
    )
    loop.publishNow()
    if (result.ok) {
      setNotice({ ok: true, text: `Sent as ${result.order.id} to ${roomId}.` })
      setPicked([])
      if (walk) closeTimer.current = window.setTimeout(onClose, WALK_SENT_CLOSE_MS)
    } else {
      setNotice({ ok: false, text: result.reason })
    }
  }

  return (
    <section className="hud-card hud-rx" data-walk={walk} aria-label="Prescribe (developer panel)">
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
          {MEDICINES.map((m) => {
            const on = picked.includes(m.id)
            return (
              <li key={m.id}>
                <label className="hud-med" data-on={on} data-disabled={!on && picked.length >= max}>
                  <input type="checkbox" checked={on} disabled={!on && picked.length >= max} onChange={() => toggle(m.id)} />
                  <span className="hud-med__swatch" style={{ background: m.color }} aria-hidden="true" />
                  <span className="hud-med__name">{m.name}</span>
                  <span className="hud-med__strength">{m.strength}</span>
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
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------------------------

export interface HudViewProps {
  mode: PlayerMode
  /** H: the clean screen. */
  hidden: boolean
  rxOpen: boolean
  /** The room the tablet starts on, and how many times it has been opened (the tablet is rebuilt on each). */
  rxRoom: string | null
  rxRequest: number
  onToggleRx: () => void
  onCloseRx: () => void
}

/** The HUD for a mode: the overview's cards, or walk mode's quiet pieces (src/ui/walk/visibility.ts says which). */
export function HudView({ mode, hidden, rxOpen, rxRoom, rxRequest, onToggleRx, onCloseRx }: HudViewProps) {
  // H hides it all, in both modes; walk mode is the quiet HUD of the doctor on foot
  const parts = hudVisibility(mode, hidden)
  const walking = hudKind(mode) === 'walk'
  if (hidden) return null

  return (
    <div className="hud" data-hud={walking ? 'walk' : 'overview'}>
      {parts.titleCard && (
        <div className="hud-tl">
          <TitleCard />
          {/* R2: the overview's Level switch (Level 1 / Level 2 · Surgery), under the clock card: the overview only */}
          {switchShown(mode) && <LevelSwitch />}
        </div>
      )}
      {parts.walkClock && (
        <div className="hud-tl">
          <WalkClock />
        </div>
      )}
      <div className="hud-tr">
        {parts.kpiCard && <KpiCard />}
        {parts.minimap && !rxOpen && <Minimap />}
        {rxOpen ? (
          <PrescribePanel key={rxRequest} onClose={onCloseRx} initialRoom={rxRoom} walk={walking} />
        ) : (
          parts.rxPill && (
            <button type="button" className="hud-card hud-rx-open" onClick={onToggleRx} title="Prescribe a medicine (P)">
              Prescribe
              <kbd className="hud-kbd">P</kbd>
            </button>
          )
        )}
      </div>
      {(parts.eventLine || parts.orderRail) && (
        <div className="hud-bottom">
          {parts.eventLine && <EventLine />}
          {parts.orderRail && <OrderRail />}
        </div>
      )}
      {walking && <WalkOverlay parts={parts} />}
    </div>
  )
}

export function Hud() {
  const rx = useRx()
  const mode = useWalk((s) => s.mode)
  const hidden = useHudPrefs((s) => s.hidden)
  const toggleRx = useCallback(() => useRx.getState().toggle(), [])
  const closeRx = useCallback(() => useRx.getState().close(), [])
  useHotkeys(toggleRx)
  // R2: the L key switches the overview's level (a listener of its own, so it works with the HUD hidden by H)
  useEffect(() => installLevelKey(window), [])
  // The store starts at 07:30: publish once before the first paint, so `?start=` shows its own hour straight away.
  useLayoutEffect(() => {
    loop.publishNow()
  }, [])

  return <HudView mode={mode} hidden={hidden} rxOpen={rx.open} rxRoom={rx.roomId} rxRequest={rx.request} onToggleRx={toggleRx} onCloseRx={closeRx} />
}
