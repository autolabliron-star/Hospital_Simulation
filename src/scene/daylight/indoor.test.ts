import { Color, DirectionalLight, HemisphereLight, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { setScreenLevel } from './dim'
import { DaylightDriver, FOLLOW_SECONDS, type DayTargets } from './driver'
import { INDOOR, INDOOR_SECONDS, indoorFactor, indoorTarget } from './indoor'
import { lightAt } from './lightAt'
import { HOSPITAL_ENV_MATCH } from '@/scene/lighting/look'

function rig() {
  const sun = new DirectionalLight('#fff6ea', 1.75)
  sun.position.set(22, 72, 50)
  sun.castShadow = true
  sun.target.position.set(1, 2, 3)
  const hemi = new HemisphereLight('#f4fbff', '#d9d3c8', 0.75)
  const scene = { background: new Color('#e9eeed'), environmentIntensity: 0.35 }
  const glass = new MeshStandardMaterial({ color: '#d6efec', transparent: true, opacity: 0.2 })
  const panels = new MeshStandardMaterial({ color: '#1fb5ad', emissive: new Color('#1fb5ad'), emissiveIntensity: 2.2 })
  const lamps = new MeshStandardMaterial({ color: '#fff1d6', emissive: new Color('#fff1d6'), emissiveIntensity: 1.2 })
  const strips = new MeshBasicMaterial({ color: 0x000000 })
  const targets: DayTargets = { sun, hemi, scene, glass, panels, lamps, nightLights: { material: strips, setLit: () => undefined } }
  return { sun, hemi, scene, glass, panels, lamps, strips, targets, sunPos: sun.position.clone(), targetPos: new Vector3(1, 2, 3) }
}

function run(d: DaylightDriver, r: ReturnType<typeof rig>, hour: number, seconds: number, indoor: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) d.frame(1 / 60, () => hour, 0, r.targets, indoor)
}

describe('the indoor light preset (walk mode)', () => {
  beforeEach(() => setScreenLevel(1))

  it('the factors (W3 retune): the sun to about a third, the fill and the environment turned down from the W1 boosts', () => {
    expect(INDOOR.sun).toBeGreaterThan(0.2)
    expect(INDOOR.sun).toBeLessThan(0.4)
    // the light volume brings the rooms' own bounce now: the W1 boosts (hemisphere x1.5, environment x2.2) come down
    expect(INDOOR.hemi).toBeGreaterThan(0.7)
    expect(INDOOR.hemi).toBeLessThan(1.5)
    expect(INDOOR.env).toBeLessThan(2.2)
    expect(INDOOR.env).toBeGreaterThan(0.5)
    expect(indoorFactor(INDOOR.sun, 0)).toBe(1)
    expect(indoorFactor(INDOOR.sun, 1)).toBeCloseTo(INDOOR.sun, 12)
    expect(indoorFactor(INDOOR.hemi, 0.5)).toBeCloseTo((1 + INDOOR.hemi) / 2, 12)
  })

  it('the mode decides the target: any mode but the overview is indoors, and no player means the overview', () => {
    expect(indoorTarget('overview')).toBe(0)
    expect(indoorTarget(undefined)).toBe(0)
    for (const m of ['walk', 'toWalk', 'toOverview']) expect(indoorTarget(m)).toBe(1)
  })

  it('walking at noon: the sun at about 30 %, the hemisphere and the environment at the walk look, the sky and the glass untouched', () => {
    const r = rig()
    const d = new DaylightDriver()
    run(d, r, 12, 3, 1)
    const day = lightAt(12)
    expect(r.sun.intensity).toBeCloseTo(day.sunIntensity * INDOOR.sun, 6)
    expect(r.sun.intensity / day.sunIntensity).toBeGreaterThan(0.2)
    expect(r.sun.intensity / day.sunIntensity).toBeLessThan(0.4)
    expect(r.hemi.intensity).toBeCloseTo(day.hemiIntensity * INDOOR.hemi, 6)
    // the hospital environment is bound by now: its intensity carries the match that keeps the ambient continuous at the swap
    expect(r.scene.environmentIntensity).toBeCloseTo(day.envIntensity * INDOOR.env * HOSPITAL_ENV_MATCH, 6)
    // the windows stay bright: the glass and the sky are the day's, untouched by the preset
    expect(r.glass.opacity).toBeCloseTo(day.glassOpacity, 9)
    expect(r.glass.color.r).toBeCloseTo(new Color().setRGB(day.glass[0], day.glass[1], day.glass[2], 'srgb').r, 6)
    expect(r.scene.background.r).toBeCloseTo(new Color().setRGB(day.sky[0], day.sky[1], day.sky[2], 'srgb').r, 6)
    // the sun's colour is still the sun's colour
    expect(r.sun.color.r).toBeCloseTo(new Color().setRGB(day.sun[0], day.sun[1], day.sun[2], 'srgb').r, 6)
  })

  it('eases in and out (no jump), settles on exact values and stops writing', () => {
    const r = rig()
    const d = new DaylightDriver()
    run(d, r, 12, 3, 0)
    const full = r.sun.intensity
    let last = full
    const writes0 = d.writes
    // walk mode begins: the sun comes down steadily over about INDOOR_SECONDS
    for (let i = 0; i < Math.round(INDOOR_SECONDS * 60 * 0.5); i++) {
      d.frame(1 / 60, () => 12, 0, r.targets, 1)
      expect(r.sun.intensity).toBeLessThanOrEqual(last + 1e-12)
      expect(last - r.sun.intensity).toBeLessThan(0.1)
      last = r.sun.intensity
    }
    expect(last).toBeLessThan(full)
    expect(last).toBeGreaterThan(full * INDOOR.sun)
    run(d, r, 12, INDOOR_SECONDS * 14, 1)
    expect(r.sun.intensity).toBeCloseTo(full * INDOOR.sun, 9)
    const settled = d.writes
    expect(settled).toBeGreaterThan(writes0)
    run(d, r, 12, 2, 1)
    expect(d.writes).toBe(settled) // at rest: nothing is written any more
    // and back to the overview
    run(d, r, 12, INDOOR_SECONDS * 14, 0)
    expect(r.sun.intensity).toBeCloseTo(full, 9)
    expect(r.hemi.intensity).toBeCloseTo(lightAt(12).hemiIntensity, 9)
    expect(r.scene.environmentIntensity).toBeCloseTo(lightAt(12).envIntensity, 9)
  })

  it('the first frame snaps to the mode (a hospital that starts on foot starts indoors)', () => {
    const r = rig()
    new DaylightDriver().frame(1 / 60, () => 12, 0, r.targets, 1)
    expect(r.sun.intensity).toBeCloseTo(lightAt(12).sunIntensity * INDOOR.sun, 9)
  })

  it('multiplies the light of the hour, so night stays night (and the golden evening sun keeps its tint)', () => {
    const r = rig()
    const d = new DaylightDriver()
    run(d, r, 2, 3, 1)
    expect(r.sun.intensity).toBeCloseTo(lightAt(2).sunIntensity * INDOOR.sun, 6)
    expect(r.hemi.intensity).toBeCloseTo(lightAt(2).hemiIntensity * INDOOR.hemi, 6)
    expect(r.hemi.intensity).toBeLessThan(lightAt(12).hemiIntensity)
    run(d, r, 18.4, FOLLOW_SECONDS * 14, 1)
    const evening = lightAt(18.4)
    expect(r.sun.color.r).toBeCloseTo(new Color().setRGB(evening.sun[0], evening.sun[1], evening.sun[2], 'srgb').r, 6)
  })

  it('writes uniforms and intensities only: the sun does not move, no shadow property changes, no material asks to recompile', () => {
    const r = rig()
    const d = new DaylightDriver()
    const versions = [r.glass.version, r.panels.version, r.lamps.version, r.strips.version]
    const shadow = { mapSize: r.sun.shadow.mapSize.clone(), bias: r.sun.shadow.bias, autoUpdate: r.sun.shadow.autoUpdate, needsUpdate: r.sun.shadow.needsUpdate }
    for (const [h, k] of [[12, 1], [12, 0], [3, 1], [7.2, 1], [19, 0], [12, 1]] as const) run(d, r, h, 2, k)
    expect(r.sun.position.equals(r.sunPos)).toBe(true)
    expect(r.sun.target.position.equals(r.targetPos)).toBe(true)
    expect(r.sun.castShadow).toBe(true)
    expect(r.sun.shadow.mapSize.equals(shadow.mapSize)).toBe(true)
    expect(r.sun.shadow.bias).toBe(shadow.bias)
    expect(r.sun.shadow.autoUpdate).toBe(shadow.autoUpdate)
    expect(r.sun.shadow.needsUpdate).toBe(shadow.needsUpdate)
    expect([r.glass.version, r.panels.version, r.lamps.version, r.strips.version]).toEqual(versions)
  })

  it('the overview is exactly what it was: with indoor 0 nothing differs from the L1 driver', () => {
    const r = rig()
    const d = new DaylightDriver()
    run(d, r, 9, 3, 0)
    const day = lightAt(9)
    expect(r.sun.intensity).toBeCloseTo(day.sunIntensity, 9)
    expect(r.hemi.intensity).toBeCloseTo(day.hemiIntensity, 9)
    expect(r.scene.environmentIntensity).toBeCloseTo(day.envIntensity, 9)
  })
})
