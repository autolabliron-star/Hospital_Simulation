/**
 * The "Go to…" menu as data: rooms grouped the way a visitor thinks of them. Pure (it reads the layout, the demo patient
 * list and, when given, the live room statuses), so it is unit-tested in node: every area that is on the minimap or is a
 * patient room is listed.
 */
import { patientInRoom } from '@/content/catalogue'
import { GO_TO_COPY } from '@/content/goTo'
import { SURGERY_UI } from '@/content/surgeryUi'
import { levelOf } from '@/sim/levels'
import { AREAS, ROOMS, areaById, type AreaId } from '@/sim/places'
import type { RoomId, RoomStatus } from '@/sim/types'
import { L1_COPY } from './l1Copy'

export interface GoToItem {
  area: AreaId
  /** "MRI", "A3". */
  label: string
  /** Second line: the patient's name for a ward room, the area's subtitle otherwise. */
  detail: string
}

export interface GoToGroup {
  id: string
  title: string
  items: GoToItem[]
}

/** One menu row: the words of `goTo.json` (the fixed rooms, then the UK replacements for the layout's own words), else the area's own label and subtitle. */
function item(area: AreaId): GoToItem {
  const a = areaById(area)
  const words = GO_TO_COPY.items[area] ?? GO_TO_COPY.areaWords[area]
  return { area, label: words?.label ?? a.label, detail: words?.detail ?? a.subtitle }
}

/**
 * The second line for a ward room: the live occupant (`sim.life.rooms`), or the bed state when the bed is empty. Falls back
 * to the demo roster only when no live room is given or the sim has no entry for it.
 */
function roomDetail(roomId: RoomId, rooms?: ReadonlyMap<RoomId, RoomStatus>): string {
  const room = rooms?.get(roomId)
  if (!room) return patientInRoom(roomId).name
  return room.patientName ?? L1_COPY.bedStates[room.bed].label
}

function wardItems(ward: 'A' | 'B', rooms?: ReadonlyMap<RoomId, RoomStatus>): GoToItem[] {
  return ROOMS.filter((r) => r.ward === ward).map((r) => ({ area: `room:${r.id}` as AreaId, label: r.id, detail: roomDetail(r.id, rooms) }))
}

/**
 * R2: the robotic surgery suite on level 2, every level-2 area the minimap names, once (pre-op, sterile supply, the robotic OR, recovery and the
 * family lounge). Read from `AREAS` so a room added to level 2 with a map label joins the menu with no edit here. Choosing one flies there and
 * switches the overview to Level 2 (roomFocus.ts `focusRoom`).
 */
function level2Items(): GoToItem[] {
  return AREAS.filter((a) => a.mapLabel && levelOf(a.rect.x0) === 2).map((a) => item(a.id))
}

/**
 * The menu, in reading order. Every `AREAS` entry with `mapLabel` or `kind: 'room'` appears exactly once. Pass the sim's
 * `life.rooms` so the ward names follow the beds as they turn over; without it the menu shows the demo roster.
 */
export function buildGoToGroups(rooms?: ReadonlyMap<RoomId, RoomStatus>): GoToGroup[] {
  const g = GO_TO_COPY.groups
  return [
    { id: 'imaging', title: g.imaging, items: [item('mri'), item('ct'), item('xray'), item('ultrasound'), item('imagingHall')] },
    // W4: the robot draw centre and the automated lab it sends its tubes to
    { id: 'bloodLab', title: g.bloodLab, items: [item('diagnostics'), item('lab')] },
    // R2: level 2, the robotic surgery suite
    { id: 'level2', title: SURGERY_UI.goTo.group, items: level2Items() },
    { id: 'wardA', title: g.wardA, items: wardItems('A', rooms) },
    { id: 'wardB', title: g.wardB, items: wardItems('B', rooms) },
    { id: 'pharmacy', title: g.pharmacy, items: [item('core')] },
    { id: 'emergency', title: g.emergency, items: [item('er')] },
    { id: 'triage', title: g.triage, items: [item('triage')] },
    { id: 'entrance', title: g.entrance, items: [item('lobby')] },
    { id: 'atrium', title: g.atrium, items: [item('atrium')] },
    { id: 'command', title: g.command, items: [item('command')] },
    { id: 'hubs', title: g.hubs, items: [item('hubA'), item('hubB')] },
  ]
}

/** Every area the menu should offer: on the minimap, or a patient room. */
export function menuAreaIds(): AreaId[] {
  return AREAS.filter((a) => a.mapLabel || a.kind === 'room').map((a) => a.id)
}

/** Groups narrowed to the items matching `query` (label, detail or group title; case and spacing ignored). */
export function filterGoToGroups(groups: GoToGroup[], query: string): GoToGroup[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return groups
  const out: GoToGroup[] = []
  for (const g of groups) {
    const titleHit = g.title.toLowerCase().includes(q)
    const items = titleHit ? g.items : g.items.filter((i) => `${i.label} ${i.detail}`.toLowerCase().includes(q))
    if (items.length > 0) out.push({ ...g, items })
  }
  return out
}

/** All items in the order the keyboard walks them. */
export function flattenItems(groups: GoToGroup[]): GoToItem[] {
  return groups.flatMap((g) => g.items)
}
