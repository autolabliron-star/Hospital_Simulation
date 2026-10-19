/**
 * Walk mode: can you see a point from the camera? What floats over people's heads (emote icons, speech bubbles) must not show
 * through a wall: in walk mode the walls are full height, so a person in the next room is hidden, and so is what is over them.
 *
 * The test is the straight line from the camera to the point against the building's solid walls and the wall over every door
 * (`buildWallBoxes({ sight: true })`): glass walls (the command centre, the observation windows, the hubs, the atrium, the lab
 * front, the glazed shell) do not block, so people seen through glass keep theirs. Door leaves are not in it. Built once, lazily;
 * allocation-free per call.
 */
import { WallBoxProbe, buildWallBoxes } from '@/scene/player/boomProbe'
import type { Vec3 } from '@/sim/types'

let probe: WallBoxProbe | null = null
const from: Vec3 = { x: 0, y: 0, z: 0 }
const dir: Vec3 = { x: 0, y: 0, z: 0 }
/** The line stops this short of the point (m), so a wall right behind it never counts. */
const END_SLACK = 0.05

/** Is a solid wall between the camera at (cx, cy, cz) and the point (tx, ty, tz)? */
export function sightBlocked(cx: number, cy: number, cz: number, tx: number, ty: number, tz: number): boolean {
  const dx = tx - cx
  const dy = ty - cy
  const dz = tz - cz
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (d <= END_SLACK) return false
  if (probe === null) probe = new WallBoxProbe(buildWallBoxes({ sight: true }))
  from.x = cx
  from.y = cy
  from.z = cz
  dir.x = dx / d
  dir.y = dy / d
  dir.z = dz / d
  return probe.cast(from, dir, d - END_SLACK, 0) !== null
}
