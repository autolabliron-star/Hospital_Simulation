/**
 * The doors that move in walk mode (W1). Pure data: where each leaf lives and how far it may open. The animation is in
 * ../../render/walk/doorBank.ts (the opening state and the sensing) and WalkBuilding.tsx (the instance matrices).
 *
 *   auto    two sliding leaves that part into the wall (the leaves ride 0.06 m off the wall line, inside a solid wall's thickness and
 *           in front of a thin glass sheet), set off by anyone within 2.5 m of the opening's centre;
 *   swing   one leaf, DOUBLE-ACTING (W3, like a real hospital corridor door): it opens away from whoever sets it off, so it swings
 *           into the room beyond (area `b`, the `into` side) for somebody coming from area `a` and out into area `a` for somebody
 *           coming from the room, set off within 1.6 m. The hinge side and the widest angle (the same both ways) are chosen so the
 *           leaf's sweep clears every furniture footprint of the layout on BOTH sides of the wall; the side a leaf takes is the
 *           DoorBank's business (render/walk/doorBank.ts `swing`), not the layout's.
 *
 * W3: the leaves are SOLID (render/walk/doorMatrices.ts `writeLeafBlockers`, published through src/scene/blockers.ts), so the sensing radii
 * below are measured from YOU along the way you are going (`CONFIG.player.doorLeadSeconds` ahead, render/walk/doorBank.ts): at a run an auto
 * door stirs about 5 m out and is wide open 2.7 m out, a swing door about 4.1 m and 1.6 m. The swing radius is deliberately small (1.6 m
 * from the middle of the doorway): a patient in a bed 2.5 m from the door does not set it off, and the people of the sim are sensed from
 * where they stand, as ever. An auto leaf slides its whole width into the wall beside the opening (`autoTravel`), so a wide-open door has
 * no leaf in its clear opening.
 *
 * The pharmacy core's own doors (S2) are not here. Open passages and the hub counters have no leaf.
 */
import { DOORS, areaById, type AreaId, type DoorSpec } from '@/sim/places'
import { footprintDistance } from '../builder'
import type { Footprint } from '../types'
import { isWalkDoor } from './upperWalls'
import type { WalkDoor } from './types'

export const DOOR_LEAF = { height: 2.28, thickness: 0.04, autoThickness: 0.02, offset: 0.06 } as const
export const SENSE = { auto: 2.5, swing: 1.6 } as const
/** Widest-first openings to try for a swing leaf, degrees, and the clearance the sweep must keep from every footprint. */
const SWING_ANGLES = [85, 70, 55, 40] as const
const SWEEP_CLEAR = 0.04
/** Leaf colours (instance colours of the `tinted` material): the soft mint of the patient rooms, light oak elsewhere. */
export const LEAF_COLOR = { room: '#bfe3d9', other: '#d8b88a' } as const

const sideOf = (areaId: AreaId, c: number, alongX: boolean): 1 | -1 => {
  const r = areaById(areaId).rect
  const mid = alongX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2
  return mid >= c ? 1 : -1
}

/** True when the leaf, hinged at (hx, hz) and swung from closed to `angle`, stays clear of every footprint. */
export function sweepIsClear(hx: number, hz: number, alongV: { x: number; z: number }, hinge: 1 | -1, into: { x: number; z: number }, width: number, angle: number, footprints: readonly Footprint[]): boolean {
  const steps = Math.max(2, Math.ceil(angle / (Math.PI / 36)))
  const pts = Math.ceil(width / 0.1)
  for (let i = 1; i <= steps; i++) {
    const th = (angle * i) / steps
    // the leaf's direction: from the hinge, along the wall toward the other jamb, turning toward `into`
    const dx = -hinge * alongV.x * Math.cos(th) + into.x * Math.sin(th)
    const dz = -hinge * alongV.z * Math.cos(th) + into.z * Math.sin(th)
    for (let k = 1; k <= pts; k++) {
      const t = (width * k) / pts
      const px = hx + dx * t
      const pz = hz + dz * t
      for (const fp of footprints) if (footprintDistance(fp, px, pz) < SWEEP_CLEAR) return false
    }
  }
  return true
}

/**
 * The hinge side and widest angle of a swing leaf. The leaf swings both ways (double-acting), so the widest-first search first wants a
 * plan whose sweep clears the footprints on both sides of the wall, and only then settles for one that clears the room beyond alone
 * (the plan before W3). Every door of today's layout is clear on both sides at 85 degrees, so the first candidate wins everywhere.
 */
function swingPlan(d: DoorSpec, alongV: { x: number; z: number }, into: { x: number; z: number }, footprints: readonly Footprint[]): { hinge: 1 | -1; maxAngle: number } {
  const back = { x: -into.x, z: -into.z }
  for (const bothSides of [true, false]) {
    for (const deg of SWING_ANGLES) {
      for (const hinge of [1, -1] as const) {
        const hx = d.center.x + hinge * alongV.x * (d.width / 2)
        const hz = d.center.z + hinge * alongV.z * (d.width / 2)
        const angle = (deg * Math.PI) / 180
        if (!sweepIsClear(hx, hz, alongV, hinge, into, d.width - 0.04, angle, footprints)) continue
        if (bothSides && !sweepIsClear(hx, hz, alongV, hinge, back, d.width - 0.04, angle, footprints)) continue
        return { hinge, maxAngle: angle }
      }
    }
  }
  return { hinge: 1, maxAngle: (30 * Math.PI) / 180 }
}

export function buildWalkDoors(footprints: readonly Footprint[]): WalkDoor[] {
  const out: WalkDoor[] = []
  for (const d of DOORS) {
    if (!isWalkDoor(d) || (d.kind !== 'auto' && d.kind !== 'swing')) continue
    const alongX = d.wallAxis === 'x'
    const c = alongX ? d.center.z : d.center.x
    const alongV = alongX ? { x: 1, z: 0 } : { x: 0, z: 1 }
    const acrossTo = (id: AreaId): { x: number; z: number } => {
      const s = sideOf(id, c, alongX)
      return alongX ? { x: 0, z: s } : { x: s, z: 0 }
    }
    const into = acrossTo(d.b)
    const inward = acrossTo(d.a)
    const plan = d.kind === 'swing' ? swingPlan(d, alongV, into, footprints) : { hinge: 1 as const, maxAngle: 0 }
    out.push({
      id: d.id,
      kind: d.kind,
      x: d.center.x,
      z: d.center.z,
      width: d.width,
      wallAxis: d.wallAxis,
      along: alongV,
      offset: DOOR_LEAF.offset * (alongX ? inward.z : inward.x),
      hinge: plan.hinge,
      into,
      maxAngle: plan.maxAngle,
      color: d.id.startsWith('room:') ? LEAF_COLOR.room : LEAF_COLOR.other,
      sense: SENSE[d.kind],
    })
  }
  return out
}
