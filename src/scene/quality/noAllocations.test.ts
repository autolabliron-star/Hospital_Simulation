import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The per-frame paths of the frame loop and the quality ladder allocate nothing: no vectors, arrays, sets, closures over a frame, no
 * `map`/`filter`/`slice`/spread. Like src/scene/frameAllocations.test.ts (which guards the `useFrame` callbacks) this reads the source,
 * so it sees the pattern, not what the helpers allocate: the pacer's median and the ladder's percentile are written to match.
 */
const FLAGGED =
  /new (Vector[234]|Color|Quaternion|Euler|Matrix[34]|Object3D|Box3|Sphere|Raycaster|Set|Map|Float32Array|Float64Array|Array|Object)\b|\[\.\.\.|\.(map|filter|slice|concat|reduce|forEach)\(|Array\.(from|of)\(|=> \{?\s*$/m

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

/** The text of the `{ ... }` block that starts at the first `{` after `marker` (brace matched). */
function blockAfter(src: string, marker: string): string {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`marker not found: ${marker}`)
  const open = src.indexOf('{', at + marker.length)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`unbalanced block after: ${marker}`)
}

function offenders(label: string, body: string): string[] {
  return body
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && FLAGGED.test(line))
    .map((line) => `${label}: ${line.trim()}`)
}

describe('the per-frame paths', () => {
  it('allocate nothing', () => {
    const loop = read('src/app/PowerLoop.tsx')
    const power = read('src/app/power.ts')
    const ladder = read('src/scene/quality/ladder.ts')
    const quality = read('src/scene/quality/Quality.tsx')
    const timing = read('src/scene/quality/frameTiming.ts')

    const found = [
      ...offenders('PowerLoop tick', blockAfter(loop, 'const tick = (now: number) =>')),
      ...offenders('GameClock.tick', blockAfter(power, '  tick(nowMilliseconds: number, fps: number): number')),
      ...offenders('FramePacer.accept', blockAfter(power, '  accept(now: number, fps: number): boolean')),
      ...offenders('FramePacer.period', blockAfter(power, '  get period(): number')),
      ...offenders('QualityLadder.sample', blockAfter(ladder, '  sample(now: number')),
      ...offenders('QualityLadder.evaluate', blockAfter(ladder, '  private evaluate(now: number, deviceDpr: number): LadderAction')),
      ...offenders('QualityLadder.percentile', blockAfter(ladder, '  private percentile(values: Float32Array, p: number): number')),
      ...offenders('QualityLadder.move', blockAfter(ladder, '  private move(to: number')),
      ...offenders('reportFrame', blockAfter(timing, 'export function reportFrame')),
      ...offenders('Quality frame sink', blockAfter(quality, 'setFrameSink((workMs')),
    ]
    expect(found).toEqual([])
  })

  it('finds the code it guards (the scan is not vacuous)', () => {
    const loop = read('src/app/PowerLoop.tsx')
    expect(blockAfter(loop, 'const tick = (now: number) =>')).toContain('advance(')
    expect(blockAfter(loop, 'const tick = (now: number) =>')).toContain('reportFrame(')
  })
})
