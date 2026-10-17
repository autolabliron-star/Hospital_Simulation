import { Color, DirectionalLight, HemisphereLight, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { screenLevel, registerDimmable, setScreenLevel } from './dim'
import { DaylightDriver, FOLLOW_SECONDS, NIGHT_LIGHT_VISIBLE, READ_SECONDS, circularDelta, type DayTargets } from './driver'
import { lightAt } from './lightAt'

function rig() {
  const sun = new DirectionalLight('#fff6ea', 1.75)
  sun.position.set(22, 72, 50)
  sun.castShadow = true
  const target = new Vector3(1, 2, 3)
  sun.target.position.copy(target)
  const hemi = new HemisphereLight('#f4fbff', '#d9d3c8', 0.75)
  const scene = { background: new Color('#e9eeed'), environmentIntensity: 0.35 }
  const glass = new MeshStandardMaterial({ color: '#d6efec', transparent: true, opacity: 0.2 })
  const panels = new MeshStandardMaterial({ color: '#1fb5ad', emissive: new Color('#1fb5ad'), emissiveIntensity: 2.2 })
  const lamps = new MeshStandardMaterial({ color: '#fff1d6', emissive: new Color('#fff1d6'), emissiveIntensity: 1.2 })
  const strips = new MeshBasicMaterial({ color: 0x000000 })
  let lit = false
  const targets: DayTargets = { sun, hemi, scene, glass, panels, lamps, nightLights: { material: strips, setLit: (v) => (lit = v) } }
  return { sun, hemi, scene, glass, panels, lamps, strips, targets, isVisible: () => lit, sunPos: sun.position.clone(), targetPos: target }
}

/** Run `seconds` of 60 Hz frames at a fixed hour. */
function run(d: DaylightDriver, r: ReturnType<typeof rig>, hour: number, seconds: number, generation = 0): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) d.frame(1 / 60, () => hour, generation, r.targets)
}

describe('daylight driver', () => {
  beforeEach(() => setScreenLevel(1))

  it('snaps to the light of the hour on the first frame', () => {
    const r = rig()
    const d = new DaylightDriver()
    d.frame(1 / 60, () => 2, 0, r.targets)
    const want = lightAt(2)
    expect(r.sun.intensity).toBeCloseTo(want.sunIntensity, 9)
    expect(r.hemi.intensity).toBeCloseTo(want.hemiIntensity, 9)
    expect(r.scene.environmentIntensity).toBeCloseTo(want.envIntensity, 9)
    expect(r.glass.opacity).toBeCloseTo(want.glassOpacity, 9)
    expect(r.isVisible()).toBe(true)
    expect(r.strips.color.r).toBeGreaterThan(0)
  })

  it('never moves the sun, its target or its shadow, and never asks for a recompile', () => {
    const r = rig()
    const d = new DaylightDriver()
    const versions = [r.glass.version, r.panels.version, r.lamps.version, r.strips.version]
    const shadow = { mapSize: r.sun.shadow.mapSize.clone(), bias: r.sun.shadow.bias, autoUpdate: r.sun.shadow.autoUpdate, needsUpdate: r.sun.shadow.needsUpdate }
    for (const h of [3, 6.5, 7.2, 9, 12, 17.9, 18.8, 20, 22.5, 3]) run(d, r, h, 3)
    expect(r.sun.position.equals(r.sunPos)).toBe(true)
    expect(r.sun.target.position.equals(r.targetPos)).toBe(true)
    expect(r.sun.castShadow).toBe(true)
    expect(r.sun.shadow.mapSize.equals(shadow.mapSize)).toBe(true)
    expect(r.sun.shadow.bias).toBe(shadow.bias)
    expect(r.sun.shadow.autoUpdate).toBe(shadow.autoUpdate)
    expect(r.sun.shadow.needsUpdate).toBe(shadow.needsUpdate)
    // material.version only moves when someone sets needsUpdate: a changed define or program would show here
    expect([r.glass.version, r.panels.version, r.lamps.version, r.strips.version]).toEqual(versions)
    expect(r.glass.transparent).toBe(true)
  })

  it('eases toward a new target (no jump), then settles on it and stops writing', () => {
    const r = rig()
    const d = new DaylightDriver()
    run(d, r, 18, 2)
    expect(r.sun.intensity).toBeCloseTo(lightAt(18).sunIntensity, 6)
    // a step of 0.4 h (under the snap limit) across the sunset ramp: the sun's light moves, a little each frame
    const from = r.sun.intensity
    const to = lightAt(18.4).sunIntensity
    expect(from - to).toBeGreaterThan(0.1)
    let last = from
    for (let i = 0; i < Math.round(READ_SECONDS * 60) + 30; i++) {
      d.frame(1 / 60, () => 18.4, 0, r.targets)
      expect(last - r.sun.intensity).toBeGreaterThanOrEqual(0)
      expect(last - r.sun.intensity).toBeLessThan(0.1)
      last = r.sun.intensity
    }
    expect(last).toBeLessThan(from)
    expect(last).toBeGreaterThan(to - 1e-9)
    run(d, r, 18.4, FOLLOW_SECONDS * 12, 0)
    expect(r.sun.intensity).toBeCloseTo(to, 3)
    const writes = d.writes
    run(d, r, 18.4, 3)
    expect(d.writes).toBe(writes)
  })

  it('a long step in the hour (a Jump or a scrub) snaps instead of easing', () => {
    const r = rig()
    const d = new DaylightDriver()
    run(d, r, 12, 2)
    expect(r.sun.intensity).toBeCloseTo(1.75, 6)
    // the next hour read is far away: the very frame that reads it lands on it
    for (let i = 0; i < Math.ceil(READ_SECONDS * 60) + 1; i++) d.frame(1 / 60, () => 22.5, 0, r.targets)
    expect(r.sun.intensity).toBeCloseTo(lightAt(22.5).sunIntensity, 6)
    // a rebuilt hospital (a new generation) snaps on its first frame even for a small step
    run(d, r, 22.6, 0.05, 1)
    expect(r.sun.intensity).toBeCloseTo(lightAt(22.6).sunIntensity, 6)
  })

  it('reads the clock only once a second', () => {
    const r = rig()
    const d = new DaylightDriver()
    let reads = 0
    for (let i = 0; i < 60 * 5; i++)
      d.frame(1 / 60, () => {
        reads++
        return 12
      }, 0, r.targets)
    expect(reads).toBeGreaterThanOrEqual(5)
    expect(reads).toBeLessThanOrEqual(7)
  })

  it('the panels move toward warm and dim at night and come back by day; the lamps dim a little', () => {
    const r = rig()
    const d = new DaylightDriver()
    const day = r.panels.emissive.clone()
    run(d, r, 12, 1)
    expect(r.panels.emissiveIntensity).toBeCloseTo(2.2, 6)
    expect(r.panels.emissive.equals(day)).toBe(true)
    run(d, r, 23, 1)
    expect(r.panels.emissiveIntensity).toBeLessThan(2.2 * 0.62)
    expect(r.panels.emissive.r).toBeGreaterThan(day.r) // warmer: more red
    expect(r.lamps.emissiveIntensity).toBeLessThan(1.2)
    run(d, r, 12, 1)
    // ...and back again to exactly the day look (the base is remembered, so it never drifts)
    run(d, r, 12, 8)
    expect(r.panels.emissiveIntensity).toBeCloseTo(2.2, 3)
    expect(r.panels.emissive.r).toBeCloseTo(day.r, 3)
  })

  it('the night lights are lit by night and dark by day', () => {
    const r = rig()
    const d = new DaylightDriver()
    run(d, r, 12, 1)
    expect(r.isVisible()).toBe(false)
    run(d, r, 23, 1)
    expect(r.isVisible()).toBe(true)
    expect(lightAt(23).nightLights).toBeGreaterThan(NIGHT_LIGHT_VISIBLE)
  })

  it('dims the registered screens with the night level', () => {
    const c = new Color('#ffffff')
    const off = registerDimmable(c, 1.1, 1)
    expect(c.r).toBeCloseTo(1.1)
    const r = rig()
    const d = new DaylightDriver()
    run(d, r, 23, 1)
    expect(screenLevel()).toBeCloseTo(lightAt(23).screens, 6)
    expect(c.r).toBeCloseTo(1.1 * lightAt(23).screens, 6)
    off()
    run(d, r, 12, 10)
    expect(c.r).toBeCloseTo(1.1 * lightAt(23).screens, 6) // unregistered: left alone
  })

  it('writes the sky colour in place, and tolerates layers that are not mounted yet', () => {
    const r = rig()
    const bg = r.scene.background
    const d = new DaylightDriver()
    d.frame(1 / 60, () => 2, 0, { ...r.targets, sun: null, hemi: null, scene: null, nightLights: null })
    // missing targets: it writes again next frame, now that they exist
    d.frame(1 / 60, () => 2, 0, r.targets)
    expect(r.scene.background).toBe(bg)
    expect(bg.r).toBeLessThan(0.2)
    expect(r.sun.intensity).toBeCloseTo(lightAt(2).sunIntensity, 6)
  })

  it('circularDelta is the shortest way round the clock', () => {
    expect(circularDelta(23.5, 0.5)).toBeCloseTo(-1)
    expect(circularDelta(0.5, 23.5)).toBeCloseTo(1)
    expect(circularDelta(12, 11)).toBeCloseTo(1)
  })
})
