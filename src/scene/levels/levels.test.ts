/**
 * R2 (docs/R2-SURGERY.md): which level the screen shows. The rule the levels frame runs once a frame (walking: your level; the overview: the Level switch), the
 * groups that follow it (the ground floor's rigs hide while you walk on level 2 and stay in both overviews), the contract's `shownAt`, and the wiring in World.tsx.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PerspectiveCamera, Vector3 } from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OVERVIEW_FOV_DEG, type RigHandle } from '@/scene/camera/cameraApi'
import { PlayerSystem } from '@/scene/player/system'
import { LEVEL2_FOOTPRINT, l2 } from '@/sim/levels'
import { LIFTS } from '@/sim/places'
import { Simulation } from '@/sim/Simulation'
import { applyLevelGroups, levelGroupCount, levelGroupVisible, registerLevelGroup, type Showable } from './levelGroups'
import { updateLevelView } from './levelRule'
import { levelView, shownAt } from './levelView'

const reset = (): void => {
  levelView.shown = 1
  levelView.overview = true
}
beforeEach(reset)
afterEach(reset)

describe('the levels frame rule: which level is shown, and whether this is the overview', () => {
  it('walking: your level, and not the overview (every mode but the overview, the flights between the two included)', () => {
    for (const mode of ['walk', 'toOverview', 'toWalk']) {
      updateLevelView({ mode, x: -40 }, 2)
      expect(levelView, `${mode} on level 1, switch on 2`).toEqual({ shown: 1, overview: false })
      updateLevelView({ mode, x: l2(-48) }, 1)
      expect(levelView, `${mode} on level 2, switch on 1`).toEqual({ shown: 2, overview: false })
    }
  })

  it('the overview: the Level switch, and the overview flag set (level 1 stays drawn around level 2)', () => {
    updateLevelView({ mode: 'overview', x: l2(-48) }, 1)
    expect(levelView).toEqual({ shown: 1, overview: true })
    updateLevelView({ mode: 'overview', x: -40 }, 2)
    expect(levelView).toEqual({ shown: 2, overview: true })
  })

  it('with no player yet it is the overview', () => {
    levelView.shown = 2
    levelView.overview = false
    updateLevelView(null, 1)
    expect(levelView).toEqual({ shown: 1, overview: true })
    updateLevelView(undefined, 2)
    expect(levelView).toEqual({ shown: 2, overview: true })
  })

  it('the split is where the sim puts it: just under sim x 70 is level 1, from 70 on is level 2', () => {
    updateLevelView({ mode: 'walk', x: 69.99 }, 1)
    expect(levelView.shown).toBe(1)
    updateLevelView({ mode: 'walk', x: 70 }, 1)
    expect(levelView.shown).toBe(2)
  })

  it('follows a real player system through a lift ride and Tab (the sim\'s own player view)', () => {
    class Rig implements RigHandle {
      camera = {}
      suspended = false
      enabled = true
      getPosition(out: Vector3): Vector3 {
        return out.set(-11, 80, 66)
      }
      getTarget(out: Vector3): Vector3 {
        return out.set(-11, 0, 0)
      }
      setLookAt(): void {}
    }
    const sim = new Simulation(5)
    const sys = new PlayerSystem({ camera: new PerspectiveCamera(OVERVIEW_FOV_DEG, 16 / 9, 1, 500), getSim: () => sim, getRig: () => new Rig(), reducedMotion: () => true })
    try {
      sys.update(1 / 60)
      updateLevelView(sim.player, 1)
      expect(levelView).toEqual({ shown: 1, overview: false })
      sys.placeAt(LIFTS.A[2].walkers[0].x, LIFTS.A[2].walkers[0].z, 0)
      sys.update(1 / 60)
      updateLevelView(sim.player, 1)
      expect(levelView).toEqual({ shown: 2, overview: false })
      sys.input.keyDown('Tab')
      for (let i = 0; i < 10; i++) sys.update(1 / 60)
      expect(sim.player!.mode).toBe('overview')
      updateLevelView(sim.player, 2)
      expect(levelView).toEqual({ shown: 2, overview: true })
      updateLevelView(sim.player, 1)
      expect(levelView).toEqual({ shown: 1, overview: true })
    } finally {
      sys.dispose()
    }
  })
})

describe('the contract\'s shownAt', () => {
  const under = { x: -48, z: 0 }
  const outside = { x: 10, z: 0 }
  const up = { x: l2(-48), z: 0 }

  it('walking shows your own level only; the overview of Level 1 hides level 2; the overview of Level 2 keeps the ground floor around the slab, not under it', () => {
    const view = (shown: 1 | 2, overview: boolean): boolean[] => {
      levelView.shown = shown
      levelView.overview = overview
      return [under, outside, up].map((p) => shownAt(p.x, p.z))
    }
    expect(view(1, false)).toEqual([true, true, false])
    expect(view(2, false)).toEqual([false, false, true])
    expect(view(1, true)).toEqual([true, true, false])
    expect(view(2, true)).toEqual([false, true, true])
    // the footprint's own edge
    levelView.shown = 2
    levelView.overview = true
    expect(shownAt(LEVEL2_FOOTPRINT.x0 - 0.01, 0)).toBe(true)
    expect(shownAt(LEVEL2_FOOTPRINT.x0 + 0.01, 0)).toBe(false)
  })
})

describe('the level groups: the ground floor\'s rigs hide while you walk on level 2', () => {
  const obj = (): Showable => ({ visible: true })

  it('level 1: shown walking on level 1 and in both overviews; hidden walking on level 2. Level 2: shown only while level 2 is shown', () => {
    const cases: [number, boolean, boolean, boolean][] = [
      // shown, overview, level-1 group, level-2 group
      [1, false, true, false],
      [2, false, false, true],
      [1, true, true, false],
      [2, true, true, true],
    ]
    for (const [shown, overview, one, two] of cases) {
      const view = { shown: shown as 1 | 2, overview }
      expect(levelGroupVisible(1, view), `level 1 group, shown ${shown}${overview ? ' overview' : ''}`).toBe(one)
      expect(levelGroupVisible(2, view), `level 2 group, shown ${shown}${overview ? ' overview' : ''}`).toBe(two)
    }
  })

  it('registered groups follow levelView when applied, and only change when they must', () => {
    const a = obj()
    const b = obj()
    const off = [registerLevelGroup(1, a), registerLevelGroup(2, b)]
    try {
      expect(levelGroupCount()).toBe(2)
      // registering already sets it right: the overview of Level 1 (the test default)
      expect(a.visible).toBe(true)
      expect(b.visible).toBe(false)
      levelView.shown = 2
      levelView.overview = false
      applyLevelGroups()
      expect(a.visible).toBe(false)
      expect(b.visible).toBe(true)
      levelView.overview = true
      applyLevelGroups()
      expect(a.visible).toBe(true)
      expect(b.visible).toBe(true)
      levelView.shown = 1
      applyLevelGroups()
      expect(a.visible).toBe(true)
      expect(b.visible).toBe(false)
    } finally {
      off.forEach((f) => f())
    }
    expect(levelGroupCount()).toBe(0)
    // taken out: nothing else is written to them
    levelView.shown = 2
    levelView.overview = false
    applyLevelGroups()
    expect(a.visible).toBe(true)
  })
})

describe('World.tsx wires it', () => {
  const src = readFileSync(join(process.cwd(), 'src/scene/World.tsx'), 'utf8')
  const group = src.slice(src.indexOf('<LevelGroup level={1}>'), src.indexOf('</LevelGroup>'))

  it('mounts the levels frame, and wraps the ground floor\'s rigs (pharmacy, robots, meals, drawers, imaging machines, the W4 layers and screens) in the level-1 group', () => {
    expect(src).toContain('<LevelsFrame />')
    expect(group.length).toBeGreaterThan(50)
    for (const rig of ['PharmacyCore', 'Robots', 'Meals', 'Drawers', 'ImagingMachines', 'KioskLayer', 'DrawCentreLayer', 'LabLayer', 'StatusScreens']) expect(group, rig).toContain(`<${rig} />`)
  })

  it('does not hide the static building, the landscape (both in <Building />), the light, the sky or the people', () => {
    for (const keep of ['Building', 'Lighting', 'Daylight', 'People', 'Effects', 'EmoteLayer', 'SpeechBubbles']) {
      expect(group, keep).not.toContain(`<${keep} />`)
      expect(src, keep).toContain(`<${keep} />`)
    }
    // the levels frame runs before anything reads the view: it is mounted ahead of the group and of the people
    expect(src.indexOf('<LevelsFrame />')).toBeLessThan(src.indexOf('<People />'))
  })
})
