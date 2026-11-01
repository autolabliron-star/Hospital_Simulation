/**
 * R5 wave 3: the CT suite's two pictures as the watch overlay's picture-in-picture (src/ui/watch/Inset.tsx, the `insetSources` registry): `ctPlan`, the
 * planning picture (the CT slice with the planned needle paths numbered and the one being aimed in amber, with the path list beside it: what the robot's
 * planning screen shows) and `ctLive`, the live CT (the needles, the ice growing round the tips, the scanner's sweep).
 *
 * The registry copies a WHOLE canvas, and the room's screens share one atlas, so each inset has a small canvas of its own, painted by the very painters of the
 * room's screens (ctPaint.ts) from the same base slice. A canvas is painted ONLY while its inset is on screen (`insetWanted[id]`), when what it shows changes
 * (the screens' key: the step, the robot, the ice, the timer, the sweep, the needles in), at most 4 times a real second (CLAUDE.md: the focused imaging
 * screen's rate); off screen it costs nothing at all. Plain functions and fields, no React: `<CryoSuiteLayer />` registers them at mount and calls
 * `update` from its screens' frame callback.
 */
import { insetWanted, registerInsetSource, type InsetId } from '@/scene/registries/insetSources'
import type { Env, Surface } from '@/scene/imaging/images/ctx'
import type { CryoSuiteState } from '@/sim/types'
import { baseSliceFor, paintLive, paintPlanning, type BaseSliceCache } from './ctPaint'
import { KEY_LEN, screenKeyInto, TILE, TILE_LOGICAL_W } from './screens'

/** The shortest time between two paints of one inset (real seconds): 4 Hz. */
export const INSET_PERIOD_S = 0.25
/** The inset canvases' height; the width is the screens' aspect (the same logical box as the room's tiles). */
export const INSET_H = 256

export type CtInsetId = Extract<InsetId, 'ctPlan' | 'ctLive'>
const IDS: readonly CtInsetId[] = ['ctPlan', 'ctLive']

export interface CtInset {
  id: CtInsetId
  surface: Surface
  width: number
  height: number
  /** How many times it was painted. */
  paints: number
  /** When it was last painted (real seconds); -Infinity before the first. */
  last: number
  /** What it showed then (`screenKeyInto`'s numbers: the step, the robot, the ice, the timer, the sweep, the needles in, the picture's seed and target). */
  key: Float64Array
  next: Float64Array
}

export interface CryoInsets {
  plan: CtInset
  live: CtInset
  /** Paint each inset whose picture is on screen and has something new, at most 4 Hz. Allocation-free except the painters' own strings. */
  update(s: CryoSuiteState, now: number): void
  /** Register both as sources (at mount); returns the function that removes them (at unmount). */
  register(): () => void
}

function makeInset(env: Env, id: CtInsetId): CtInset {
  const width = TILE_LOGICAL_W[id === 'ctPlan' ? TILE.planning : TILE.live]
  return { id, surface: env.createSurface(width, INSET_H), width, height: INSET_H, paints: 0, last: Number.NEGATIVE_INFINITY, key: new Float64Array(KEY_LEN).fill(Number.NaN), next: new Float64Array(KEY_LEN) }
}

/** Repaint one inset when its period is over and what it shows changed. Allocation-free except the painters' own strings. */
export function refreshInset(st: CtInset, s: CryoSuiteState, now: number, base: BaseSliceCache, env: Env): boolean {
  if (now - st.last < INSET_PERIOD_S) return false
  screenKeyInto(s, st.next)
  let same = true
  for (let i = 0; i < KEY_LEN; i++) {
    if (st.next[i] !== st.key[i]) {
      same = false
      break
    }
  }
  if (same) return false
  st.key.set(st.next)
  st.last = now
  st.paints++
  const slice = baseSliceFor(base, env, s.imageSeed, s.target)
  if (st.id === 'ctPlan') paintPlanning(st.surface.ctx, st.width, st.height, s, slice)
  else paintLive(st.surface.ctx, st.width, st.height, s, slice)
  return true
}

/**
 * `base` is the screens' base-slice cache (the same slice serves the room's screens and the insets); `wanted` is the registry's flags (a parameter so a test
 * can use its own).
 */
export function createCryoInsets(env: Env, base: BaseSliceCache, wanted: Readonly<Record<InsetId, boolean>> = insetWanted): CryoInsets {
  const plan = makeInset(env, 'ctPlan')
  const live = makeInset(env, 'ctLive')

  return {
    plan,
    live,
    update(s: CryoSuiteState, now: number): void {
      if (wanted.ctPlan) refreshInset(plan, s, now, base, env)
      if (wanted.ctLive) refreshInset(live, s, now, base, env)
    },
    register(): () => void {
      const offs = IDS.map((id) => {
        const st = id === 'ctPlan' ? plan : live
        return registerInsetSource({ id, canvas: st.surface.canvas, width: st.width, height: st.height, paints: () => st.paints })
      })
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
