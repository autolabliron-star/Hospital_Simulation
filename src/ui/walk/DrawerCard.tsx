/**
 * The MedDrawer card (walk mode, E at a drawer): what is inside, whose it is, and a note while your order is still on its way.
 * Read from the sim at 4 Hz, so you can stand there and watch a pod load it. Not modal: walk away, press E or Esc, or close it.
 */
import { useCallback } from 'react'
import { WALK } from '@/content/walk'
import { useYourOrder } from '@/scene/interact/yourOrder.store'
import { sim } from '@/sim'
import { usePoll } from '@/ui/usePoll'
import { readDrawer, type DrawerCardView } from './drawerModel'
import { useDrawerCard } from './drawerCard.store'

export function DrawerCardView({ v, onClose }: { v: DrawerCardView; onClose: () => void }) {
  return (
    <section className="hud-card walk-drawer" aria-label={v.title}>
      <header className="walk-drawer__head">
        <h2 className="walk-drawer__title">{v.title}</h2>
        <button type="button" className="hud-icon-btn" aria-label={WALK.drawerCard.close} title={WALK.hud.drawerCloseTitle} onClick={onClose}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <p className="walk-drawer__chips">
        <span className="hud-chip" data-tone={v.loaded ? 'ok' : 'idle'}>
          {v.loaded ? WALK.drawerCard.loaded : WALK.drawerCard.empty}
        </span>
        {v.dueNow && (
          <span className="hud-chip" data-tone="due">
            {WALK.drawerCard.dueNow}
          </span>
        )}
      </p>
      {v.items.length > 0 ? (
        <ul className="walk-drawer__list">
          {v.items.map((m) => (
            <li key={m.name} className="walk-drawer__item">
              <span className="walk-drawer__swatch" style={{ background: m.color }} aria-hidden="true" />
              <span>
                {m.name} {m.strength}
                {m.qty > 1 ? ` ×${m.qty}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="walk-drawer__note">{WALK.drawerCard.nothing}</p>
      )}
      {v.locked && <p className="walk-drawer__note">{v.locked}</p>}
      {v.yours && <p className="walk-drawer__note walk-drawer__note--yours">{WALK.drawerCard.yours}</p>}
    </section>
  )
}

function Body({ roomId }: { roomId: string }) {
  const read = useCallback(() => readDrawer(sim, roomId, useYourOrder.getState().view), [roomId])
  return <DrawerCardView v={usePoll(read)} onClose={() => useDrawerCard.getState().close()} />
}

export function DrawerCard() {
  const roomId = useDrawerCard((s) => s.roomId)
  return roomId ? <Body key={roomId} roomId={roomId} /> : null
}
