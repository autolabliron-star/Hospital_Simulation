/**
 * Realism step 2: the daylight driver turns the bake's light on for live objects with the walk look, only once the field is built, never in the
 * overview, with ?bakelight=0 or ?look=model; and reads the bound zone probe at its true radiance (uniforms only).
 */
import { Color, DirectionalLight, HemisphereLight, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { DaylightDriver, type DayTargets } from '@/scene/daylight/driver'
import { parseLightingFlags } from '@/scene/lighting/flags'
import { BAKE_LIGHT } from '@/scene/lighting/look'
import { reflectionUniforms, updateModelReflections } from '@/scene/building/model/reflections'
import { buildBakeField } from './field'
import { bakeState, bakeUniforms, clearBakeField, setBakeField } from './uniforms'

function targets(lobbyEnv = false): DayTargets {
  return {
    sun: new DirectionalLight('#fff6ea', 1.75),
    hemi: new HemisphereLight('#f4fbff', '#d9d3c8', 0.75),
    scene: { background: new Color('#e9eeed'), environmentIntensity: 0.35 },
    glass: new MeshStandardMaterial(),
    panels: new MeshStandardMaterial({ emissive: new Color('#1fb5ad'), emissiveIntensity: 2.2 }),
    lamps: new MeshStandardMaterial({ emissive: new Color('#fff1d6'), emissiveIntensity: 1.2 }),
    nightLights: { material: new MeshBasicMaterial(), setLit: () => undefined },
    renderer: { toneMappingExposure: 1 },
    lobbyEnv,
  }
}

function run(d: DaylightDriver, t: DayTargets, indoor: number, seconds = 4): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) d.frame(1 / 60, () => 12, 0, t, indoor)
}

const field = () => buildBakeField([{ name: 'lobby', level: 1, contains: (x, z) => x > -62 && x < -40 && z > -6 && z < 6, sh: new Float32Array(27).fill(0.2) }])

afterEach(() => {
  clearBakeField()
  bakeState.force = null
})

describe('the bake light, as the daylight driver writes it', () => {
  it('stays off until the field is built, then follows the walk look in and out (the overview keeps its live light)', () => {
    const d = new DaylightDriver(parseLightingFlags(''))
    const t = targets()
    run(d, t, 1)
    expect(bakeUniforms.uBkOn.value).toBe(0) // the probes are not in yet
    setBakeField(field(), ['lobby'])
    expect(bakeState.ready).toBe(true)
    run(d, t, 1, 0.1) // the driver notices on its next frame, although the light itself had settled
    expect(bakeUniforms.uBkOn.value).toBe(1)
    expect(bakeUniforms.uBkGain.value).toBe(BAKE_LIGHT.gain)
    expect(bakeUniforms.uBkKey.value).toBe(BAKE_LIGHT.key)
    expect(bakeUniforms.uBkAo.value).toBe(BAKE_LIGHT.ao)
    run(d, t, 0, 10)
    expect(bakeUniforms.uBkOn.value).toBe(0)
  })

  it('reflects the probe on live objects exactly as the baked materials do (one shared uniform: true radiance while a zone probe is bound)', () => {
    expect(bakeUniforms.uBkSpec).toBe(reflectionUniforms.uReflGain)
    updateModelReflections(1, true, 0.25)
    expect(bakeUniforms.uBkSpec.value).toBeCloseTo(4, 6)
    updateModelReflections(0, true, 0.25)
    expect(bakeUniforms.uBkSpec.value).toBeCloseTo(4, 6)
    updateModelReflections(0, false, 0.25)
    expect(bakeUniforms.uBkSpec.value).toBe(1)
  })

  it('is off with ?bakelight=0 and with ?look=model; ?lv=0 drops only its AO; the probe can pin it', () => {
    setBakeField(field(), ['lobby'])
    for (const q of ['?bakelight=0', '?look=model']) {
      const d = new DaylightDriver(parseLightingFlags(q))
      run(d, targets(), 1)
      expect(bakeUniforms.uBkOn.value, q).toBe(0)
    }
    const lv = new DaylightDriver(parseLightingFlags('?lv=0'))
    run(lv, targets(), 1)
    expect(bakeUniforms.uBkOn.value).toBe(1)
    expect(bakeUniforms.uBkAo.value).toBe(0)
    bakeState.force = 0
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, targets(), 1)
    expect(bakeUniforms.uBkOn.value).toBe(0)
  })
})
