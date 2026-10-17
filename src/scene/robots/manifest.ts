/** What the robots draw, as a budget (see pharmacy/manifest.ts): the rail is three static meshes, the pods one InstancedMesh per part. */
import type { BufferGeometry } from 'three'
import { ROBOT } from '@/sim/places'
import { budgetLine, type BudgetLine } from './budget'
import { LID_CENTERS, podBodyGeometry, podBogieGeometry, podFaceGeometry, podHatchGeometry, podLidGeometry, podRingGeometry } from './podParts'
import { buildRail } from './rail'

/** Two wards, `podsPerWard` pods each (the fleet builds exactly this many). */
export const POD_COUNT = ROBOT.podsPerWard * 2

export function robotsBudget(): BudgetLine[] {
  const rail = buildRail()
  const parts: [string, BufferGeometry, number][] = [
    ['rail.body', rail.body, 1],
    ['rail.collars', rail.collars, 1],
    ['rail.light', rail.light, 1],
    ['pods.bogie', podBogieGeometry(), POD_COUNT],
    ['pods.body', podBodyGeometry(), POD_COUNT],
    ['pods.ring', podRingGeometry(), POD_COUNT],
    ['pods.face', podFaceGeometry(POD_COUNT), POD_COUNT],
    ['pods.lids', podLidGeometry(), POD_COUNT * LID_CENTERS.length],
    // one plate shape: the bottom hatches, the side hatches, then the dark seats under both
    ['pods.hatches', podHatchGeometry(), POD_COUNT * 4],
  ]
  const lines = parts.map(([name, g, n]) => budgetLine(name, g, n))
  for (const [, g] of parts) g.dispose()
  return lines
}
