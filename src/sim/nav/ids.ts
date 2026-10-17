/**
 * Node ids and where they are, derived only from the contract (`places.ts`). No dependency on the nav graph or the
 * building layout, so both can import it without a cycle:
 *   - the room builders (patientRoom.ts) name the node a chair serves with `roomNodeId`;
 *   - nav/layout.ts resolves the `serves` exemptions of furniture footprints with `nodeAnchor`, before (and without)
 *     the graph being built.
 * The graph adds its nodes at exactly these positions (a test checks it).
 */
import { ATRIUM, COMMAND_SEATS, LOBBY, NURSE_HUB, roomById } from '../places'
import type { RoomId, Vec2, WardId } from '../types'

export type RoomNodePart = 'doorOutside' | 'door' | 'doorInside' | 'bedside' | 'drawerSpot' | 'chair' | 'footL' | 'footR'

export function roomNodeId(roomId: RoomId, part: RoomNodePart): string {
  return `room:${roomId}:${part}`
}

/** The id of the nav node at a seat's approach point. */
export function seatNodeId(seatId: string): string {
  return `seat:${seatId}`
}

/**
 * Where a station node stands, for the ids a footprint may `serve`: reception, kiosks, a room's chair or bedside, a
 * command seat, a nurse hub spot and the café. Returns null for ids it does not know.
 */
export function nodeAnchor(id: string): Vec2 | null {
  if (id === 'lobby:reception') return LOBBY.reception.at
  if (id === 'atrium:cafe') return ATRIUM.cafe.at
  let m = /^lobby:kiosk:(\d+)$/.exec(id)
  if (m) return LOBBY.kiosks[Number(m[1])] ?? null
  m = /^command:seat:(\d+)$/.exec(id)
  if (m) return COMMAND_SEATS[Number(m[1])]?.at ?? null
  m = /^hub:([AB]):spot:(\d+)$/.exec(id)
  if (m) return NURSE_HUB[m[1] as WardId][Number(m[2])]?.at ?? null
  m = /^room:([AB]\d+):(chair|bedside|drawerSpot|doorInside)$/.exec(id)
  if (m) {
    const r = roomById(m[1])
    return m[2] === 'chair' ? r.chair : m[2] === 'bedside' ? r.bedside : m[2] === 'drawerSpot' ? r.drawerSpot : r.doorInside
  }
  return null
}
