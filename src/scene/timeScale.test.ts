import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loop } from '@/sim'
import { SIM_SPEEDS } from '@/sim/types'
import { VISUAL_DT_MAX, timeScale, visualDt } from './timeScale'

afterEach(() => {
  loop.speed = 1
  loop.paused = false
})

describe('visualDt', () => {
  it('is the frame time at 1x, scaled by the speed at 2x to 30x', () => {
    loop.speed = 1
    expect(visualDt(1 / 60)).toBe(1 / 60)
    for (const s of SIM_SPEEDS) {
      loop.speed = s
      expect(timeScale()).toBe(s)
      expect(visualDt(1 / 240)).toBeCloseTo(s / 240, 12)
    }
  })

  it('is capped, so a hitch at 30x never moves a part across its whole travel', () => {
    loop.speed = 30
    expect(visualDt(1 / 60)).toBe(0.25) // 0.5 s would be asked for
    expect(visualDt(0.1)).toBe(VISUAL_DT_MAX)
    loop.speed = 1
    expect(visualDt(1)).toBe(VISUAL_DT_MAX)
  })

  it('is 0 while the sim is paused, at any speed, and the time scale still reads the speed', () => {
    loop.paused = true
    for (const s of SIM_SPEEDS) {
      loop.speed = s
      expect(visualDt(1 / 60)).toBe(0)
      expect(timeScale()).toBe(s)
    }
  })

  it('is zero for zero frame time', () => {
    loop.speed = 30
    expect(visualDt(0)).toBe(0)
  })

  it('allocates nothing: the module builds no objects, arrays or closures per call', () => {
    const src = readFileSync(join(process.cwd(), 'src/scene/timeScale.ts'), 'utf8')
    const body = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(body).not.toMatch(/new\s|=>|\[|\{\s*\w+:/)
  })

  it('is what the sim-process layers use, and the real-time ones do not', () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
    for (const p of ['src/scene/kiosks/KioskLayer.tsx', 'src/scene/surgery/SurgeryLayer.tsx', 'src/scene/lab/LabLayer.tsx', 'src/scene/meals/MealBotsLayer.tsx', 'src/scene/meals/TraysLayer.tsx', 'src/scene/imaging/machines/index.tsx']) {
      expect(read(p), p).toContain('visualDt(dt)')
    }
    // the crowd gets the scale itself (its gait is measured in sim units), not a scaled dt
    expect(read('src/scene/actors/crowd/CrowdRenderer.tsx')).toContain('timeScale()')
    expect(read('src/scene/actors/crowd/CrowdRenderer.tsx')).not.toContain('visualDt')
  })
})
