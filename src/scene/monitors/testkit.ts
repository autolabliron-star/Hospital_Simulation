/**
 * Test helpers for the live patient monitors (node only): a recording canvas, a seeded baseline, a fake world for the hub, and the real anchors.
 */
import type { Ctx2D } from '@/scene/imaging/images/ctx'
import { buildLayout } from '@/scene/building/layout'
import { KIT_SCREENS } from '@/scene/surgery/dims'
import { Rng } from '@/sim/rng'
import { profileFor } from '@/sim/vitals/model'
import type { AreaId } from '@/sim/places'
import type { SurgeryState } from '@/sim/types'
import { monitorDefs, type MonitorDef } from './anchors'
import type { HubEnv, Uploader } from './hub'
import type { ErCaseView, ErView } from './occupancy'
import { baselineFrom, type Baseline } from './vitals'

export interface Rec {
  ctx: Ctx2D
  texts: string[]
  count(name: string): number
  /** Every call in order, "name" only. */
  calls: string[]
}

/** A canvas-2D context that records what is drawn. */
export function recCtx(): Rec {
  const texts: string[] = []
  const calls: string[] = []
  const counts = new Map<string, number>()
  const store: Record<string, unknown> = {}
  const ctx = new Proxy(store, {
    get(t, key: string) {
      if (key in t) return t[key]
      return (...args: unknown[]) => {
        calls.push(key)
        counts.set(key, (counts.get(key) ?? 0) + 1)
        if (key === 'fillText') texts.push(String(args[0]))
        if (key === 'measureText') return { width: String(args[0]).length * 6 }
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return { addColorStop: () => undefined }
        return undefined
      }
    },
    set(t, key: string, value) {
      t[key] = value
      return true
    },
  }) as unknown as Ctx2D
  return { ctx, texts, calls, count: (n) => counts.get(n) ?? 0 }
}

/** A synthetic patient's baseline, as the health kiosks' model draws it. */
export function baselineOf(id: string, seed = 7): Baseline {
  return baselineFrom(profileFor(id, `Test ${id}`, {}, new Rng(seed)), seed * 7919 + id.length)
}

let defsCache: MonitorDef[] | null = null
/** The 19 monitors from the real building layout. */
export function realDefs(): MonitorDef[] {
  defsCache ??= monitorDefs(buildLayout().bedMonitors, KIT_SCREENS.anaesthesia)
  return defsCache
}

/** One recorded copy. */
export interface Copy {
  sx: number
  sy: number
  w: number
  h: number
  dx: number
  dy: number
  mips: boolean
}

export function recUploader(): Uploader & { copies: Copy[] } {
  const copies: Copy[] = []
  return { copies, copy: (sx, sy, w, h, dx, dy, mips) => void copies.push({ sx, sy, w, h, dx, dy, mips }) }
}

/** An ER case for the fake world. */
export function erCase(id: string, bay: number, o: Partial<ErCaseView> = {}): ErCaseView {
  return { id, name: `Patient ${id}`, reason: '', acuity: 3, state: 'inBay.waitingExam', bay, triageBay: -1, onTrolley: true, trolleyAt: 100, ...o }
}

/** A fake ER department: 6 bays and 4 triage bays, cases by id. */
export function fakeEr(): ErView & { bays: { seat: { id: string }; caseId: string | null }[]; triageBays: { seat: { id: string }; caseId: string | null }[]; cases: Map<string, ErCaseView> } {
  return {
    bays: Array.from({ length: 6 }, (_, i) => ({ seat: { id: `erBay:bay:${i}` }, caseId: null })),
    triageBays: Array.from({ length: 4 }, (_, i) => ({ seat: { id: `triageBay:bay:${i}` }, caseId: null })),
    cases: new Map(),
  }
}

/** A mutable fake world for the hub. */
export interface FakeWorld {
  env: HubEnv
  er: ReturnType<typeof fakeEr>
  surgery: SurgeryState | null
  simT: number
  gen: number
  you: { x: number; z: number } | null
  focus: AreaId | null
  ms: number
}

export function fakeWorld(surgery: SurgeryState | null = null): FakeWorld {
  const w: FakeWorld = {
    er: fakeEr(),
    surgery,
    simT: 3600,
    gen: 0,
    you: null,
    focus: null,
    ms: 0,
    env: null as unknown as HubEnv,
  }
  w.env = {
    occupancy: { surgery: () => w.surgery, er: () => w.er },
    baseline: (id) => baselineOf(id),
    simT: () => w.simT,
    generation: () => w.gen,
    walker: () => w.you,
    focus: () => w.focus,
    nowMs: () => w.ms,
  }
  return w
}
