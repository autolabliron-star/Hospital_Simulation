import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A Jump (L1) replaces the running Simulation, so `sim` is a live binding. Anything that copies a piece of it at module load
 * (`const PODS = sim.meds.fleet.drivers`) keeps pointing at the OLD hospital for the rest of the session: pods that never
 * move, drawers that never open. Read `sim.…` where you use it, or refresh a cache when `sim` or `sim.rosterVersion` changes.
 *
 * This guard fails on any module-level `const x = … sim.…` / `loop.…` it does not know. KNOWN lists the ones found when the Jump
 * was built; each has a change request to read the sim per frame instead. When a file is fixed, delete its entry here (the
 * second test fails on a stale entry, so the list cannot rot).
 */
const KNOWN = new Set<string>()

/** A top-level declaration (no indentation) whose first line reads from the live sim or loop. */
const CAPTURE = /^(?:export )?(?:const|let|var)\s+[^=\n]+=\s*.*\b(?:sim|loop)\./

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

function captures(): string[] {
  const root = process.cwd()
  const found: string[] = []
  for (const dir of ['src/scene', 'src/audio', 'src/ui']) {
    for (const file of sources(join(root, dir))) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (CAPTURE.test(line)) found.push(`${file.replace(`${root}/`, '')}: ${line.trim()}`)
      }
    }
  }
  return found
}

describe('modules that read the running sim', () => {
  it('copy nothing from it at module load (a Jump would leave them on the old hospital)', () => {
    const unknown = captures().filter((c) => !KNOWN.has(c))
    expect(unknown).toEqual([])
  })

  it('and the list of known captures has no stale entries', () => {
    const now = new Set(captures())
    const stale = [...KNOWN].filter((k) => !now.has(k))
    expect(stale).toEqual([])
  })
})
