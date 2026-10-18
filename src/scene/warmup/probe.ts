/**
 * `?probe=1` helpers on `window.__hospitalWarm`, so the orchestrator can check in a real browser that nothing compiles after the loading
 * screen: read `programs()` after Enter, press Tab, V, walk through a door, wait for a MealBot, open a scan image, Jump, and read it again.
 * The number must not change (a new program is a first-use compile, which is a hitch). `missing()` lists what was never compiled at all.
 *
 *   programs()   gl.info.programs.length: every shader program the renderer holds
 *   missing()    materials of the mounted scene (and the extras) with no compiled, ready program, named `object:material#uuid8`
 *   materials()  how many distinct materials the traversal reaches now
 *   state()      the warm-up's snapshot (phase, progress, ready, stats: programs before and after, timings, counts)
 *
 * Off unless the URL has `?probe=1` (the caller decides; this file never reads the URL).
 */
import type { Material, Scene } from 'three'
import { collectMaterialUses, collectMaterials, useName } from './collect'
import type { WarmExtras } from './registry'
import { hasProgram, type WarmupGl, type WarmupRun, type WarmupSnapshot } from './run'

export interface WarmProbe {
  programs(): number
  missing(): string[]
  materials(): number
  state(): WarmupSnapshot
}

export function createWarmProbe(gl: WarmupGl, scene: Scene, run: Pick<WarmupRun, 'snapshot'>, extras: () => WarmExtras): WarmProbe {
  return {
    programs: () => gl.info?.programs?.length ?? 0,
    missing() {
      const props = gl.properties
      if (!props) return []
      const missing: string[] = []
      const seen = new Set<Material>()
      for (const use of collectMaterialUses(scene)) {
        if (seen.has(use.material)) continue
        seen.add(use.material)
        if (!hasProgram(props, use.material)) missing.push(useName(use))
      }
      for (const m of extras().materials) {
        if (seen.has(m)) continue
        seen.add(m)
        if (!hasProgram(props, m)) missing.push(`extra:${m.name || m.type}#${m.uuid.slice(0, 8)}`)
      }
      return missing
    },
    materials: () => collectMaterials(scene).length,
    state: () => run.snapshot,
  }
}

type WarmWindow = { __hospitalWarm?: WarmProbe }

/** Put the probe on `target` (the window). Returns the function that takes it off again. */
export function installWarmProbe(target: object, probe: WarmProbe): () => void {
  const w = target as WarmWindow
  w.__hospitalWarm = probe
  return () => {
    if (w.__hospitalWarm === probe) delete w.__hospitalWarm
  }
}
