/**
 * The invariants of the bed flow, checked every half second of a run (the M3 gate's checks plus the L1 ones). A run collects
 * problems as text; a test expects the list to be empty.
 */
import { DOORS, VEHICLE_AHEAD } from '../places'
import type { Simulation } from '../Simulation'
import { CONFIG } from '../config'

interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

const DOORWAYS: { id: string; r: Rect }[] = DOORS.filter((d) => d.kind !== 'opening').map((d) => {
  const half = d.width / 2
  const r =
    d.wallAxis === 'x'
      ? { x0: d.center.x - half, x1: d.center.x + half, z0: d.center.z - 0.35, z1: d.center.z + 0.35 }
      : { x0: d.center.x - 0.35, x1: d.center.x + 0.35, z0: d.center.z - half, z1: d.center.z + half }
  return { id: `door:${d.id}`, r }
})

const inside = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1

export interface Watch {
  problems: string[]
  /** Distinct bed states each room showed (what the door tile shows), in order. */
  stages: Map<string, string[]>
  /** The bed's own lifecycle stages (a reservation does not hide them here), in order. */
  lifecycle: Map<string, string[]>
  /** The most ER bays boarding at once, and the longest a bed was boarded for. */
  maxBoarding: number
  longestBoarding: number
  /** Orders seen, with whether the room held a patient in bed (stage occupied) when the order first appeared. */
  newOrders: { id: string; source: string; room: string; patientId: string; inBed: boolean; stage: string }[]
  sawWheelchairRider: Set<string>
  sawHidden: Set<string>
  sawCollectingFamily: boolean
  /** ER patients that became ward patients while being watched (the swap must not be visible). */
  swaps: number
}

/** Returns a `sample` function: call it every half second of a run. */
export function watch(sim: Simulation): { sample: () => void; out: Watch } {
  const stillIn = new Map<string, number>()
  const seenOrders = new Set<string>()
  const out: Watch = {
    problems: [],
    stages: new Map(),
    lifecycle: new Map(),
    maxBoarding: 0,
    longestBoarding: 0,
    newOrders: [],
    sawWheelchairRider: new Set(),
    sawHidden: new Set(),
    sawCollectingFamily: false,
    swaps: 0,
  }
  const last = new Map<string, { x: number; z: number; variant: number; outfit: string | undefined; kind: string }>()
  const note = (s: string) => {
    if (out.problems.length < 30) out.problems.push(`${sim.t.toFixed(0)}s ${s}`)
  }
  const board = sim.beds.board
  const sampleDt = 30 * CONFIG.sim.step
  const sample = () => {
    // nobody stands still inside a doorway for more than 2 s
    for (const p of sim.people) {
      if (!p.mobile || p.entity.seated || p.entity.riding) continue
      // (the theatre team on level 2 is the surgery suite's own business: it has its own tests)
      if (p.entity.id.startsWith('or-')) continue
      const w = p.walker
      const zone = w.speed < 0.05 && (p.entity.fade ?? 1) > 0 ? DOORWAYS.find((z) => inside(z.r, w.x, w.z)) : undefined
      const key = p.entity.id
      if (!zone) {
        stillIn.delete(key)
        continue
      }
      const held = (stillIn.get(key) ?? 0) + sampleDt
      stillIn.set(key, held)
      if (held > 2 + 1e-9) note(`${p.entity.name} (${p.entity.role}) still in ${zone.id} for ${held.toFixed(1)} s`)
    }

    // no seat is ever held by two people
    const seatedBy = new Map<string, string>()
    for (const p of sim.people) {
      const id = p.entity.seated?.seatId
      if (!id) continue
      const other = seatedBy.get(id)
      if (other) note(`seat ${id} holds ${other} and ${p.entity.id}`)
      seatedBy.set(id, p.entity.id)
    }

    // riders sit on the vehicle, in front of whoever pushes them
    for (const { pusher, rider } of sim.world.pairs) {
      const kind = rider.entity.vehicle ?? 'none'
      if (kind === 'none' || rider.mode !== 'ride') continue
      const pw = pusher.walker
      const ahead = VEHICLE_AHEAD[kind]
      const off = Math.hypot(rider.walker.x - (pw.x + Math.sin(pw.heading) * ahead), rider.walker.z - (pw.z + Math.cos(pw.heading) * ahead))
      if (off > 0.3) note(`${rider.entity.name} is ${off.toFixed(2)} m off ${pusher.entity.name}'s ${kind}`)
      if (kind === 'wheelchair' && rider.entity.id.startsWith('pt-')) out.sawWheelchairRider.add(rider.entity.id)
    }

    // the bed states each room goes through
    for (const r of sim.life.rooms.values()) {
      const seq = out.stages.get(r.roomId) ?? []
      if (seq[seq.length - 1] !== r.bed) seq.push(r.bed)
      out.stages.set(r.roomId, seq)
      const inner = out.lifecycle.get(r.roomId) ?? []
      const stage = board.get(r.roomId).stage
      if (inner[inner.length - 1] !== stage) inner.push(stage)
      out.lifecycle.set(r.roomId, inner)
    }

    // a drawer only ever holds the packs of the patient in the bed
    for (const d of sim.meds.drawers.values()) {
      if (d.state !== 'loaded') continue
      const occ = board.occupantOf(d.roomId)
      for (const id of d.orderIds) {
        const o = sim.meds.orders.get(id)!
        if (occ === null || o.patientId !== occ.id) note(`drawer ${d.roomId} holds ${id} for ${o.patientId}, but ${occ?.id ?? 'nobody'} is in the bed`)
        if (o.cancelledAt !== undefined) note(`drawer ${d.roomId} holds the cancelled order ${id}`)
      }
    }

    // new orders: a rounds order goes to a patient who is in the bed
    for (const o of sim.meds.orders.values()) {
      if (seenOrders.has(o.id)) continue
      seenOrders.add(o.id)
      const rec = board.get(o.roomId)
      out.newOrders.push({ id: o.id, source: o.source, room: o.roomId, patientId: o.patientId, inBed: board.isInBed(o.roomId), stage: rec.stage })
      if (rec.record?.id !== o.patientId) note(`order ${o.id} (${o.source}) for ${o.patientId} in ${o.roomId}, but the bed holds ${rec.record?.id ?? 'nobody'}`)
      if (o.source === 'sim' && rec.stage !== 'occupied') note(`rounds order ${o.id} for ${o.roomId} while the bed is ${rec.stage}`)
    }

    // boarding stays within its limits
    let boarding = 0
    for (const r of sim.life.rooms.values()) {
      if (!r.boarding) continue
      boarding++
      const age = sim.t - r.boarding.since
      out.longestBoarding = Math.max(out.longestBoarding, age)
      if (age > CONFIG.beds.boardingMaxSeconds + 1) note(`${r.roomId} has boarded for ${(age / 60).toFixed(0)} min`)
    }
    out.maxBoarding = Math.max(out.maxBoarding, boarding)
    if (boarding > CONFIG.beds.boardingMaxBays) note(`${boarding} ER bays board at once`)

    // an ER patient who becomes a ward patient looks exactly the same: same place, same look, no fade, no jump
    for (const p of sim.people) {
      if (p.entity.role !== 'patient' || !p.entity.id.startsWith('er-')) continue
      const e = p.entity
      const prev = last.get(e.id)
      const kind = p.constructor.name
      if (prev && prev.kind !== kind) {
        out.swaps++
        const jump = Math.hypot(p.walker.x - prev.x, p.walker.z - prev.z)
        if (jump > 0.12) note(`${e.name} jumped ${jump.toFixed(2)} m when they became a ward patient`)
        if (e.variant !== prev.variant || e.outfit !== prev.outfit) note(`${e.name} changed look when they became a ward patient`)
        if ((e.fade ?? 1) !== 1) note(`${e.name} faded when they became a ward patient`)
      }
      last.set(e.id, { x: p.walker.x, z: p.walker.z, variant: e.variant, outfit: e.outfit, kind })
    }

    // who is hidden in a bathroom pod, and whether a family is collecting
    for (const p of sim.people) {
      if (p.entity.role === 'patient' && p.hidden) out.sawHidden.add(p.entity.id)
      if (p.entity.role === 'visitor' && p.entity.name && sim.beds.board.rooms.size > 0) {
        for (const rec of board.rooms.values()) if (rec.discharge?.family?.members.includes(p as never)) out.sawCollectingFamily = true
      }
    }
  }
  return { sample, out }
}
