/**
 * What the MedDrawer card shows (walk mode, E at a drawer): plain strings and numbers read from `sim.meds.drawers` at 4 Hz, so
 * the card re-renders only when a word changes. A drawer only ever holds its own patient's packs, so the card says whose.
 * Pure: it takes the sim's drawers as an argument, so node tests feed it fixtures.
 */
import { medicineById } from '@/content/catalogue'
import { WALK, fillWalk } from '@/content/walk'
import type { YourOrderView } from '@/scene/interact/yourOrder'
import type { Drawer } from '@/sim/types'

export interface DrawerSource {
  meds: {
    drawers: ReadonlyMap<string, Drawer>
    occupant(roomId: string): { id: string; name: string } | null
  }
}

export interface DrawerItemView {
  name: string
  strength: string
  qty: number
  color: string
}

export interface DrawerCardView {
  roomId: string
  title: string
  loaded: boolean
  dueNow: boolean
  /** "Locked to Grace Adeyemi's wristband." while there is something inside. */
  locked: string | null
  items: DrawerItemView[]
  /** Your order is still on its way to this drawer. */
  yours: boolean
}

/** Stages where your order has not reached the drawer yet. */
const ON_ITS_WAY: ReadonlySet<string> = new Set(['prescribed', 'verified', 'picking', 'enRoute'])

export function readDrawer(sim: DrawerSource, roomId: string, yours: YourOrderView | null): DrawerCardView {
  const d = sim.meds.drawers.get(roomId)
  const items: DrawerItemView[] = (d?.items ?? []).map((i) => {
    const m = medicineById(i.medId)
    return { name: m.name, strength: m.strength, qty: i.qty, color: m.color }
  })
  const loaded = d?.state === 'loaded' && items.length > 0
  const patient = sim.meds.occupant(roomId)?.name ?? null
  return {
    roomId,
    title: fillWalk(WALK.drawerCard.title, { room: roomId }),
    loaded,
    dueNow: loaded && (d?.lightOn ?? false),
    locked: loaded && patient ? fillWalk(WALK.drawerCard.locked, { patient }) : null,
    items,
    yours: yours !== null && yours.roomId === roomId && ON_ITS_WAY.has(yours.stage),
  }
}
