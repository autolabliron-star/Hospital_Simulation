/**
 * R2: the scene groups that belong to one level (docs/R2-SURGERY.md). `<LevelGroup level={1}>` (LevelGroup.tsx) registers its three.js group here, and the
 * levels frame (LevelsFrame.tsx) writes every group's `visible` once a frame, right after it writes `levelView`, so there is one callback at
 * FRAME_PRIORITY.levels and nothing can read a stale `levelView` (the groups are never one frame behind the building).
 *
 *   level 1   the ground floor's rigs (pharmacy core, pods, meals, drawers, imaging machines, the W4 layers): drawn whenever level 1 is shown, and in
 *             BOTH overviews (level 2 sits only over the west block: the rest of the ground floor stays drawn around it). Hidden only while you walk
 *             on level 2, where they would cost draw calls under a roof nobody sees through.
 *   level 2   drawn only while level 2 is shown (the overview's Level 2, or walking on it).
 *
 * A pure registry: no React, no three.js import, no allocation per frame (a plain loop over a fixed array).
 */
import type { LevelId } from '@/sim/levels'
import { levelView, type LevelViewState } from './levelView'

/** Anything with a `visible` flag (a three.js Object3D). */
export interface Showable {
  visible: boolean
}

interface Entry {
  level: LevelId
  object: Showable
}

const groups: Entry[] = []

/** Is a group of `level` drawn for this view? */
export function levelGroupVisible(level: LevelId, view: Readonly<LevelViewState> = levelView): boolean {
  return level === 1 ? view.overview || view.shown === 1 : view.shown === 2
}

/** Register a group of `level`; returns the function that takes it out again. */
export function registerLevelGroup(level: LevelId, object: Showable): () => void {
  const entry: Entry = { level, object }
  groups.push(entry)
  object.visible = levelGroupVisible(level)
  return () => {
    const i = groups.indexOf(entry)
    if (i >= 0) groups.splice(i, 1)
  }
}

/** Write every registered group's `visible` from `levelView`. Allocation-free. */
export function applyLevelGroups(): void {
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const v = levelGroupVisible(g.level)
    if (g.object.visible !== v) g.object.visible = v
  }
}

/** How many groups are registered (tests). */
export function levelGroupCount(): number {
  return groups.length
}
