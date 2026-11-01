// TEMPORARY (geometry agent): deleted before the report.
import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { AVATARS } from '@/scene/actors/crowd/procTable.testkit'
import { Rng } from '@/sim/rng'
import { planCase } from '@/sim/cryoSuite/plan'
import { ctSliceInto } from '@/sim/procedure/ctSlice'
import { posedPatient, skinOf } from './proc.testkit'
import { roomToPatient } from './needleSkin.testkit'
import { skinCrossings } from './needleSkin.testkit'

const DIR = '/private/tmp/claude-501/-Users-lironhagbi-3D-Hospital/3566c724-1697-47e6-a4e5-4fc53fbc3f3d/scratchpad/'
describe('section', () => {
  it('dumps', async () => {
    const out: Record<string, unknown> = {}
    for (const id of ['medical_female_01', 'medical_male_01', 'female_adult_17']) {
      const who = AVATARS.find((a) => a.id === id)!
      for (const sc of [0.94, 1.06]) {
        const tp = await posedPatient(who, 'cryo', { position: 'obliqueLeftUp', arms: 'aboveHead' }, sc)
        const skin = skinOf(tp)
        // the outline at z_p = -0.25: from a grid of (x, h) points, inside = odd crossings of a ray along +z... use a ray along z from -2 to 2 and count crossings
        const rows: string[] = []
        for (let h = 0.4; h >= -0.02; h -= 0.02) {
          let line = ''
          for (let x = -0.22; x <= 0.2201; x += 0.01) {
            // a ray along z at (x, h) from z=-3 to z=-0.25: odd crossings = inside (a closed body)
            const c = skinCrossings(skin, x, h, -3, x, h, -0.25)
            line += c % 2 === 1 ? '#' : '.'
          }
          rows.push(`${h.toFixed(2)} ${line}`)
        }
        out[`${id} x${sc}`] = rows
      }
    }
    const v = { x: 0, y: 0, z: 0 }
    const e = new Float64Array(3)
    const pts: number[][] = []
    for (let seed = 1; seed <= 6; seed++) for (const nd of planCase(new Rng(seed), 's', 0, 0, false, 'kidney').needles) {
      ctSliceInto('kidney', 0, nd.entry.x, nd.entry.y, nd.dz, v); roomToPatient(v.x, v.y, v.z, e); pts.push([e[0], e[1], e[2]])
      ctSliceInto('kidney', 0, nd.tip.x, nd.tip.y, nd.dz, v); roomToPatient(v.x, v.y, v.z, e); pts.push([e[0], e[1], e[2]])
    }
    out.pts = pts
    writeFileSync(DIR + 'section.json', JSON.stringify(out))
  }, 600000)
})
