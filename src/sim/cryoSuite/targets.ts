/**
 * R5 wave 3: what differs between the cryo suite's three targets (kidney, lung, liver), read from CONFIG.cryoSuite (the numbers) and typed here.
 * The kidney keeps R4's block values (a kidney case plans exactly as before R5); lung and liver list what they change in `targets`.
 * Pure data: nothing here draws a random number.
 */
import { CONFIG, type CryoTargetBlock } from '../config'
import type { CryoTarget, PatientArms, PatientPosition } from '../types'

export const CRYO_TARGET_LIST: readonly CryoTarget[] = ['kidney', 'lung', 'liver']

/** The step lengths a plan draws (minutes; `aimExtra`: the time after the last needle, the liver's fluid step). */
export type StepKey = keyof typeof CONFIG.cryoSuite.stepMinutes | 'anchorFreeze' | 'anchorThaw' | 'aimExtra'

export interface TargetSettings {
  target: CryoTarget
  anaesthesia: CryoTargetBlock['anaesthesia']
  /** The cryo anaesthetist joins this case (head end, by the machine). */
  anaesthetist: boolean
  position: PatientPosition
  arms: PatientArms
  needles: readonly [number, number]
  tumourMm: readonly [number, number]
  iceMm: readonly [number, number]
  approach: CryoTargetBlock['approach']
  /** The minutes of a step for this target, or null (the target has no such step: the lung's anchors for the others). */
  minutes(step: StepKey): readonly [number, number] | null
}

const cache = new Map<CryoTarget, TargetSettings>()

export function targetSettings(target: CryoTarget): TargetSettings {
  let s = cache.get(target)
  if (s !== undefined) return s
  const cfg = CONFIG.cryoSuite
  const block = cfg.targets[target]
  const own = block.stepMinutes ?? {}
  s = {
    target,
    anaesthesia: block.anaesthesia,
    anaesthetist: block.anaesthetist,
    position: block.position,
    arms: 'aboveHead',
    needles: block.needles ?? cfg.needles,
    tumourMm: block.tumourMm ?? cfg.tumourMm,
    iceMm: block.iceMm ?? cfg.iceMm,
    approach: block.approach,
    minutes: (step) => {
      const o = (own as Readonly<Partial<Record<StepKey, readonly [number, number]>>>)[step]
      if (o !== undefined) return o
      if (target !== 'kidney') return null
      return step === 'anchorFreeze' || step === 'anchorThaw' || step === 'aimExtra' ? null : (cfg.stepMinutes as Readonly<Partial<Record<StepKey, readonly [number, number]>>>)[step] ?? null
    },
  }
  cache.set(target, s)
  return s
}

/** Today's `target` of a plan, an absent one being the kidney (R4's plans have no field: they must stay byte-identical). */
export function targetOfPlan(p: { target?: CryoTarget }): CryoTarget {
  return p.target ?? 'kidney'
}
