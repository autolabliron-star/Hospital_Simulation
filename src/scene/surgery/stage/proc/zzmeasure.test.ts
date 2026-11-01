// TEMPORARY measurement harness (geometry agent): deleted before the report.
import { describe, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { AVATARS } from '@/scene/actors/crowd/procTable.testkit'
import { Rng } from '@/sim/rng'
import { planCase } from '@/sim/cryoSuite/plan'
import { ctSliceInto } from '@/sim/procedure/ctSlice'
import { CRYO_SUITE } from '@/sim/places'
import { CONFIG } from '@/sim/config'
import type { CryoTarget, PatientPoseView } from '@/sim/types'
import { posedPatient, skinOf } from './proc.testkit'
import { distanceToSkin, firstSkinCrossing, roomToPatient } from './needleSkin.testkit'

const POSES: Record<CryoTarget, Partial<PatientPoseView>> = {
  kidney: { position: 'obliqueLeftUp', arms: 'aboveHead' },
  lung: { position: 'prone', arms: 'aboveHead' },
  liver: { position: 'prone', arms: 'aboveHead' },
}
const SCALES = [0.94, 1, 1.06]
const DIR = '/private/tmp/claude-501/-Users-lironhagbi-3D-Hospital/3566c724-1697-47e6-a4e5-4fc53fbc3f3d/scratchpad/'

interface Cfg { name: string; target: CryoTarget; tumour?: { y: number; z: number; x?: number }; approach?: { thetaDeg: [number, number]; entryX: [number, number]; entryY: [number, number] } }

describe('measure', () => {
  it('measures configs', async () => {
    const cfgs: Cfg[] = JSON.parse(readFileSync(DIR + 'cfg.json', 'utf8'))
    const res: unknown[] = []
    const cache = new Map<string, { id: string; skin: ReturnType<typeof skinOf> }[]>()
    const e = new Float64Array(3)
    const tp3 = new Float64Array(3)
    const v = { x: 0, y: 0, z: 0 }
    const w = { x: 0, y: 0, z: 0 }
    for (const cfg of cfgs) {
      const target = cfg.target
      let skins = cache.get(target)
      if (!skins) {
        skins = []
        for (const who of ['procedural', ...AVATARS] as const) {
          for (const sc of who === 'procedural' ? [1] : SCALES) {
            const tp = await posedPatient(who as never, 'cryo', POSES[target], sc)
            skins.push({ id: `${typeof who === 'string' ? who : who.id} x${sc}`, skin: skinOf(tp) })
          }
        }
        cache.set(target, skins)
      }
      const tum = CRYO_SUITE.targets[target].tumour as { x: number; y: number; z: number }
      const t0 = { ...tum }
      const ap = CONFIG.cryoSuite.targets[target].approach as unknown as { thetaDeg: number[]; entryX: number[]; entryY: number[] }
      const a0 = JSON.parse(JSON.stringify(ap))
      if (cfg.tumour) {
        tum.y = cfg.tumour.y
        tum.z = cfg.tumour.z
        if (cfg.tumour.x !== undefined) tum.x = cfg.tumour.x
      }
      if (cfg.approach) {
        ap.thetaDeg[0] = cfg.approach.thetaDeg[0]; ap.thetaDeg[1] = cfg.approach.thetaDeg[1]
        ap.entryX[0] = cfg.approach.entryX[0]; ap.entryX[1] = cfg.approach.entryX[1]
        ap.entryY[0] = cfg.approach.entryY[0]; ap.entryY[1] = cfg.approach.entryY[1]
      }
      const paths: { ex: number; ey: number; dz: number; tx: number; ty: number }[] = []
      for (let seed = 1; seed <= 40; seed++) {
        const plan = planCase(new Rng(seed), `s${seed}`, 0, 0, false, target)
        for (const n of plan.needles) paths.push({ ex: n.entry.x, ey: n.entry.y, dz: n.dz, tx: n.tip.x, ty: n.tip.y })
      }
      const per: { id: string; mean: number; dmean: number; dmax: number; within: number; tipsOut: number }[] = []
      let n = 0, within = 0, sum = 0, dsum = 0, dmax = 0, tipsOut = 0
      const dists: number[] = []
      for (const { id, skin } of skins) {
        let m = 0, ds = 0, dm = 0, wi = 0, to = 0
        for (const p of paths) {
          ctSliceInto(target, 0, p.ex, p.ey, p.dz, v)
          ctSliceInto(target, 0, p.tx, p.ty, p.dz, w)
          roomToPatient(v.x, v.y, v.z, e)
          roomToPatient(w.x, w.y, w.z, tp3)
          const L = Math.hypot(tp3[0] - e[0], tp3[1] - e[1], tp3[2] - e[2])
          const ux = (tp3[0] - e[0]) / L, uy = (tp3[1] - e[1]) / L, uz = (tp3[2] - e[2]) / L
          const back = 0.15
          const k = firstSkinCrossing(skin, e[0] - ux * back, e[1] - uy * back, e[2] - uz * back, tp3[0], tp3[1], tp3[2])
          const gap = k < 0 ? 0.3 : k * (L + back) - back
          const d = distanceToSkin(skin, e[0], e[1], e[2])
          m += gap; ds += d; if (d > dm) dm = d; if (d <= 0.02) wi++
          // tip inside: a vertical probe above the tip crossing the skin an odd number of times is cheap but unreliable; use the distance only
          if (k < 0) to++
          dists.push(d)
        }
        per.push({ id, mean: m / paths.length, dmean: ds / paths.length, dmax: dm, within: wi / paths.length, tipsOut: to })
        n += paths.length; within += wi; sum += m; dsum += ds; if (dm > dmax) dmax = dm; tipsOut += to
      }
      dists.sort((a, b) => a - b)
      res.push({ cfg: cfg.name, target, paths: paths.length, skins: skins.length, meanGap: sum / n, dmean: dsum / n, dmax, p90: dists[Math.floor(dists.length * 0.9)], within2: within / n, noCross: tipsOut, per })
      // restore
      tum.x = t0.x; tum.y = t0.y; tum.z = t0.z
      ap.thetaDeg[0] = a0.thetaDeg[0]; ap.thetaDeg[1] = a0.thetaDeg[1]
      ap.entryX[0] = a0.entryX[0]; ap.entryX[1] = a0.entryX[1]
      ap.entryY[0] = a0.entryY[0]; ap.entryY[1] = a0.entryY[1]
    }
    writeFileSync(DIR + 'cfgout.json', JSON.stringify(res))
  }, 1_800_000)
})
