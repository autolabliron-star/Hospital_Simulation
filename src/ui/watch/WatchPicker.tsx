/**
 * R5: the "Watch step by step" button of a room panel (the robotic theatre's, the CT cryo suite's and the ultrasound room's: the same picker, with the
 * room's own words). It opens a short list of the room's procedures that have a script; a pick asks the room for a watch case (watchFlow.ts) and the
 * watch begins at once, or after the turnover with a countdown. With a case already in the room it offers to watch that one from its current step, or the
 * whole case from the start after it; when the team is not in (or, in the CT suite, it is too late today for a whole case), or a watch case is already
 * booked, it says so. All the words are in src/content/watch.json (and the CT suite's "too late" line in src/content/cryoSuite.json).
 */
import { useCallback, useMemo, useState } from 'react'
import { scriptFor } from '@/content/procedures'
import { CRYO_SUITE_COPY } from '@/content/cryoSuite'
import { fillWatch, panelWords, WATCH } from '@/content/watch'
import { proceduresOfRoom, type WatchRoomId } from '@/scene/watch/rooms'
import { CONFIG } from '@/sim/config'
import { compiledFor, watchTotalSeconds } from '@/sim/procedure'
import type { ProcedureId } from '@/sim/types'
import { watchActions } from './actions'
import type { PickResult } from './watchFlow'
import './watch.css'

export interface PickerItem {
  id: ProcedureId
  title: string
  detail: string
  /** "about 11 min" */
  minutes: string
}

/** The room's procedures that can be watched (they have a script), with their length as watched. */
export function pickerItems(room: WatchRoomId): PickerItem[] {
  const out: PickerItem[] = []
  for (const id of proceduresOfRoom(room)) {
    const cs = compiledFor(id)
    if (scriptFor(id) === undefined || cs === undefined) continue
    const copy = WATCH.procedures[id]
    out.push({ id, title: copy.title, detail: copy.detail, minutes: fillWatch(WATCH.panel.minutes, { n: Math.round(watchTotalSeconds(cs) / 60) }) })
  }
  return out
}

/** "07:00" for an hour of the day. */
export function hourText(h: number): string {
  const m = Math.round(h * 60)
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`
}

/** The hours each room's team is on site (the theatre's, the cryoablation team's, the ultrasound room's office hours). */
export function teamHours(room: WatchRoomId): { from: number; to: number } {
  if (room === 'cryo') return { from: CONFIG.cryoSuite.teamFromHour, to: CONFIG.cryoSuite.teamToHour }
  if (room === 'us') return { from: CONFIG.day.shifts.office[0], to: CONFIG.day.shifts.office[1] }
  return { from: CONFIG.surgery.teamFromHour, to: CONFIG.surgery.teamToHour }
}

/** The line a refused pick shows in a room's panel (null: nothing to say). */
export function answerText(result: PickResult | null, room: WatchRoomId = 'or'): string | null {
  const w = panelWords(room)
  switch (result) {
    case 'busy':
    case 'noCamera':
      return w.busy
    case 'noTeam': {
      const h = teamHours(room)
      return fillWatch(w.noTeam, { from: hourText(h.from), to: hourText(h.to) })
    }
    case 'tooLate':
      // (the CT suite's own words: its team is in, but not for long enough to finish a whole case)
      return CRYO_SUITE_COPY.panel.tooLate
    case 'noScript':
      return WATCH.panel.noScript
    default:
      return null
  }
}

export interface WatchPickerViewProps {
  room: WatchRoomId
  open: boolean
  items: readonly PickerItem[]
  /** The last answer and the procedure it was for. */
  answer: { id: ProcedureId; result: PickResult } | null
  onToggle(): void
  onPick(id: ProcedureId): void
  onFollow(): void
  onFromStart(id: ProcedureId): void
  onBack(): void
}

/** The markup, with its state as props (so it renders in node). */
export function WatchPickerView(p: WatchPickerViewProps) {
  const w = panelWords(p.room)
  const message = answerText(p.answer?.result ?? null, p.room)
  return (
    <div className="watch-pick" data-room={p.room}>
      <button type="button" className="hud-send watch-pick__open" aria-expanded={p.open} title={w.buttonTitle} onClick={p.onToggle}>
        {w.button}
      </button>
      {p.open && p.answer?.result === 'following' ? (
        <div className="watch-pick__choice" role="group" aria-label={w.following}>
          <p className="rp-muted watch-pick__note">{w.following}</p>
          <button type="button" className="watch-pick__item" onClick={p.onFollow}>
            <span className="rp-strong">{w.watchCurrent}</span>
            <span className="rp-muted">{w.watchCurrentNote}</span>
          </button>
          <button type="button" className="watch-pick__item" onClick={() => p.onFromStart(p.answer!.id)}>
            <span className="rp-strong">{w.fromStart}</span>
            <span className="rp-muted">{w.fromStartNote}</span>
          </button>
          <button type="button" className="watch-pick__back" onClick={p.onBack}>
            {w.cancel}
          </button>
        </div>
      ) : (
        p.open && (
          <div className="watch-pick__list" role="group" aria-label={w.pick}>
            <p className="rp-muted watch-pick__note">{w.pick}</p>
            {p.items.map((it) => (
              <button key={it.id} type="button" className="watch-pick__item" onClick={() => p.onPick(it.id)}>
                <span className="rp-strong">{it.title}</span>
                <span className="rp-muted">{fillWatch(w.itemLine, { detail: it.detail, minutes: it.minutes })}</span>
              </button>
            ))}
            {message !== null && (
              <p className="watch-pick__message" role="status">
                {message}
              </p>
            )}
          </div>
        )
      )}
    </div>
  )
}

export function WatchPicker({ room }: { room: WatchRoomId }) {
  const items = useMemo(() => pickerItems(room), [room])
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState<{ id: ProcedureId; result: PickResult } | null>(null)
  const done = useCallback(() => {
    setOpen(false)
    setAnswer(null)
  }, [])
  const act = useCallback(
    (id: ProcedureId, result: PickResult) => {
      if (result === 'started' || result === 'queued') done()
      else setAnswer({ id, result })
    },
    [done],
  )
  if (items.length === 0) return null
  return (
    <WatchPickerView
      room={room}
      open={open}
      items={items}
      answer={answer}
      onToggle={() => {
        setOpen((v) => !v)
        setAnswer(null)
      }}
      onPick={(id) => act(id, watchActions.pick(id))}
      onFollow={() => {
        if (watchActions.follow(room)) done()
        else setAnswer((a) => (a ? { ...a, result: 'noCamera' } : a))
      }}
      onFromStart={(id) => act(id, watchActions.pick(id, { fromStart: true }))}
      onBack={() => setAnswer(null)}
    />
  )
}
