import { describe, expect, it } from 'vitest'
import { BANDS, DOORS, areaAt } from '@/sim/places'
import { NIGHT_LIGHT, nightLightSpots, nightLightsGeometry } from './nightLights'

describe('corridor night lights', () => {
  const spots = nightLightSpots()

  it('are a few dozen strips in the ward corridors and the spine', () => {
    expect(spots.length).toBeGreaterThan(40)
    expect(spots.length).toBeLessThan(120)
    expect(spots.some((s) => s.alongX)).toBe(true)
    expect(spots.some((s) => !s.alongX)).toBe(true)
  })

  it('lie in a corridor or the spine, at the inner wall, never in a doorway of the inner wall', () => {
    for (const s of spots) {
      const area = areaAt(s.x, s.z)?.id
      expect(['corridorA', 'corridorB', 'spine'], `${s.x},${s.z} is in ${area}`).toContain(area)
      if (!s.alongX) continue
      expect(Math.abs(s.z)).toBeLessThan(BANDS.innerWall + 0.5)
      const sign = s.z < 0 ? -1 : 1
      for (const d of DOORS) {
        if (d.wallAxis !== 'x' || Math.abs(d.center.z - sign * BANDS.innerWall) > 0.01) continue
        expect(Math.abs(s.x - d.center.x), `${s.x},${s.z} in door ${d.id}`).toBeGreaterThan(d.width / 2 + NIGHT_LIGHT.length / 2)
      }
    }
  })

  it('merge into one geometry (one draw call), flat on the floor', () => {
    const g = nightLightsGeometry()
    g.computeBoundingBox()
    expect(g.boundingBox!.max.y).toBeLessThan(0.05)
    expect(g.getAttribute('position').count / 24).toBe(spots.length)
    g.dispose()
  })

  it('are deterministic', () => {
    expect(JSON.stringify(nightLightSpots())).toBe(JSON.stringify(spots))
  })
})
