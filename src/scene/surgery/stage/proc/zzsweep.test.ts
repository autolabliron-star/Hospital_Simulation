// TEMPORARY sweep (geometry agent): deleted before the report.
import { describe, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { AVATARS, POSE0, type ProcTableId } from '@/scene/actors/crowd/procTable.testkit'
import { Rng } from '@/sim/rng'
import { planCase } from '@/sim/cryoSuite/plan'
import { ctSliceInto } from '@/sim/procedure/ctSlice'
import { CRYO_SUITE } from '@/sim/places'
import { CONFIG } from '@/sim/config'
import type { CryoTarget, PatientPoseView } from '@/sim/types'
import { posedPatient, skinOf } from './proc.testkit'
import { distanceToSkin, firstSkinCrossing, roomToPatient } from './needleSkin.testkit'
import { MAX_SITES } from './marks'
import { newProcMemory, stepProcStage, type ProcIn } from './stage'
import { siteOfNeedle } from './config'

const POSES: Record<CryoTarget, Partial<PatientPoseView>> = {
  kidney: { position: 'obliqueLeftUp', arms: 'aboveHead' },
  lung: { position: 'prone', arms: 'aboveHead' },
  liver: { position: 'prone', arms: 'aboveHead' },
}
const SCALES = [0.94, 1, 1.06]
const DIR = '/private/tmp/claude-501/-Users-lironhagbi-3D-Hospital/3566c724-1697-47e6-a4e5-4fc53fbc3f3d/scratchpad/'
interface Cfg { name: string; target: CryoTarget; tumour?: { y: number; z: number }; approach?: { thetaDeg: number[]; entryX: number[]; entryY: number[] } }

describe('sweep', () => {
  it('sweeps', async () => {
    const cfgs: Cfg[] = JSON.parse(readFileSync(DIR + 'cfg2.json', 'utf8'))
    const res: unknown[] = []
    const cache = new Map<string, { id: string; tp: Awaited<ReturnType<typeof posedPatient>>; skin: ReturnType<typeof skinOf> }[]>()
    const v = { x: 0, y: 0, z: 0 }
    const e = new Float64Array(3)
    const t3 = new Float64Array(3)
    const raw = new Float64Array(MAX_SITES * 2)
    for (const cfg of cfgs) {
      const target = cfg.target
      let skins = cache.get(target)
      if (!skins) {
        skins = []
        for (const who of AVATARS) for (const sc of SCALES) {
          const tp = await posedPatient(who, 'cryo' as ProcTableId, POSES[target], sc)
          skins.push({ id: `${who.id} x${sc}`, tp, skin: skinOf(tp) })
        }
        cache.set(target, skins)
      }
      const tum = CRYO_SUITE.targets[target].tumour as { x: number; y: number; z: number }
      const t0 = { ...tum }
      const ap = CONFIG.cryoSuite.targets[target].approach as unknown as { thetaDeg: number[]; entryX: number[]; entryY: number[] }
      const a0 = JSON.parse(JSON.stringify(ap))
      if (cfg.tumour) { tum.y = cfg.tumour.y; tum.z = cfg.tumour.z }
      if (cfg.approach) { for (const k of ['thetaDeg', 'entryX', 'entryY'] as const) { ap[k][0] = cfg.approach[k][0]; ap[k][1] = cfg.approach[k][1] } }
      let n = 0, w2 = 0, w4 = 0, inW = 0, cross = 0, crossIn = 0, tipsIn = 0, sumAbs = 0
      for (const { skin } of skins) {
        const mem = newProcMemory('cryo')
        for (let seed = 1; seed <= 40; seed++) {
          const plan = planCase(new Rng(seed), `s${seed}`, 0, 0, false, target)
          const nds = plan.needles.slice(0, MAX_SITES)
          nds.forEach((nd, i) => siteOfNeedle(target, nd, raw, i * 2))
          const pin: ProcIn = { patient: { ...POSE0, ...POSES[target], prep: 1, drape: 1, marks: 'needles' }, skin, sites: raw, nSites: nds.length, rootX: 0, rootY: 0, rootZ: 0, heading: 0, dt: 1, target }
          stepProcStage(mem, pin)
          const w = mem.window
          for (const nd of nds) {
            ctSliceInto(target, 0, nd.entry.x, nd.entry.y, nd.dz, v); roomToPatient(v.x, v.y, v.z, e)
            ctSliceInto(target, 0, nd.tip.x, nd.tip.y, nd.dz, v); roomToPatient(v.x, v.y, v.z, t3)
            n++
            if (e[2] >= w.z0 && e[2] <= w.z1 && e[0] >= w.x0 && e[0] <= w.x1) inW++
            const d = distanceToSkin(skin, e[0], e[1], e[2]); sumAbs += d
            if (d <= 0.02) w2++
            if (d <= 0.04) w4++
            const L = Math.hypot(t3[0] - e[0], t3[1] - e[1], t3[2] - e[2])
            const ux = (t3[0] - e[0]) / L, uy = (t3[1] - e[1]) / L, uz = (t3[2] - e[2]) / L
            const sx = e[0] - ux * 0.12, sh = e[1] - uy * 0.12, sz = e[2] - uz * 0.12
            const k = firstSkinCrossing(skin, sx, sh, sz, t3[0], t3[1], t3[2])
            if (k >= 0) { cross++; const cx = sx + (t3[0] - sx) * k, cz = sz + (t3[2] - sz) * k; if (cz >= w.z0 && cz <= w.z1 && cx >= w.x0 && cx <= w.x1) crossIn++ }
            tipsIn++
          }
        }
      }
      res.push({ cfg: cfg.name, target, n, within2: w2 / n, within4: w4 / n, inWindow: inW / n, cross: cross / n, crossIn: crossIn / n, meanD: sumAbs / n })
      tum.y = t0.y; tum.z = t0.z
      for (const k of ['thetaDeg', 'entryX', 'entryY'] as const) { ap[k][0] = a0[k][0]; ap[k][1] = a0[k][1] }
      void tipsIn
    }
    writeFileSync(DIR + 'sweepout.json', JSON.stringify(res))
  }, 3_000_000)
})
