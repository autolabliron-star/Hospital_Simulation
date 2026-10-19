/**
 * The "Go to…" menu as data: rooms grouped the way a visitor thinks of them. Pure (it reads the layout, the demo patient
 * list and, when given, the live room statuses), so it is unit-tested in node: every area that is on the minimap or is a
 * patient room is listed.
 */
import { patientInRoom } from '@/content/catalogue'
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

function item(area: AreaId, label?: string, detail?: string): GoToItem {
  const a = areaById(area)
  return { area, label: label ?? a.label, detail: detail ?? a.subtitle }
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
  return ROOMS.filter((r) => r.ward === ward).map((r) => item(`room:${r.id}`, r.id, roomDetail(r.id, rooms)))
}

/**
 * The menu, in reading order. Every `AREAS` entry with `mapLabel` or `kind: 'room'` appears exactly once. Pass the sim's
 * `life.rooms` so the ward names follow the beds as they turn over; without it the menu shows the demo roster.
 */
export function buildGoToGroups(rooms?: ReadonlyMap<RoomId, RoomStatus>): GoToGroup[] {
  return [
    {
      id: 'imaging',
      title: 'Imaging',
      items: [
        item('mri', 'MRI', 'Magnetic resonance imaging'),
        item('ct', 'CT', 'Computed tomography'),
        item('xray', 'X-ray', 'Radiography'),
        item('ultrasound', 'Ultrasound', 'Live sonography'),
        item('imagingHall', 'Imaging corridor', 'Waiting seats'),
      ],
    },
    // W4: the robot draw centre and the automated lab it sends its tubes to
    { id: 'bloodLab', title: 'Blood & lab', items: [item('diagnostics'), item('lab')] },
    { id: 'wardA', title: 'Ward A', items: wardItems('A', rooms) },
    { id: 'wardB', title: 'Ward B', items: wardItems('B', rooms) },
    { id: 'pharmacy', title: 'Pharmacy core', items: [item('core', 'Pharmacy core', 'MedVend wall and MedPods')] },
    { id: 'emergency', title: 'Emergency', items: [item('er', 'Emergency', 'Six treatment bays')] },
    { id: 'triage', title: 'Triage', items: [item('triage', 'Triage', 'Four assessment bays')] },
    { id: 'entrance', title: 'Entrance', items: [item('lobby', 'Entrance', 'Self check-in and reception')] },
    { id: 'atrium', title: 'Atrium & café', items: [item('atrium', 'Healing atrium', 'Garden, café and daylight')] },
    { id: 'command', title: 'Command center', items: [item('command', 'Command center', 'Every pod, room and order, live')] },
    { id: 'hubs', title: 'Nurse hubs', items: [item('hubA', 'Nurse hub A', 'Ward A'), item('hubB', 'Nurse hub B', 'Ward B')] },
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
