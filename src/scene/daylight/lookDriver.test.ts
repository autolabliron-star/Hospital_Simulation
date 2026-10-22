import { Color, DirectionalLight, HemisphereLight, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseLightingFlags } from '@/scene/lighting/flags'
import { liveLook } from '@/scene/lighting/liveLook'
import {
  ENV_SWAP_AT,
  ENV_SWAP_BAND,
  FLOOR_WALK_ROUGHNESS,
  HOSPITAL_ENV_MATCH,
  LOBBY_ENV_MATCH,
  LOOK_MODEL_WALK,
  LOOK_OVERVIEW,
  LOOK_WALK,
  PANEL_COLOR,
  TONE_EXPOSURE_SCALE,
  VIGNETTE_DARKNESS,
} from '@/scene/lighting/look'
import { skyUniforms } from '@/scene/lighting/env/skyUniforms'
import { lvUniforms } from '@/scene/lighting/volume/uniforms'
import { setScreenLevel } from './dim'
import { DaylightDriver, type DayTargets } from './driver'
import { INDOOR_SECONDS } from './indoor'
import { lightAt } from './lightAt'

const FLOORS = Object.entries(FLOOR_WALK_ROUGHNESS)

function rig() {
  const sun = new DirectionalLight('#fff6ea', 1.75)
  const hemi = new HemisphereLight('#f4fbff', '#d9d3c8', 0.75)
  const scene = { background: new Color('#e9eeed'), environmentIntensity: 0.35 }
  const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.2 })
  const panels = new MeshStandardMaterial({ color: '#1fb5ad', emissive: new Color('#1fb5ad'), emissiveIntensity: 2.2 })
  const lamps = new MeshStandardMaterial({ color: '#fff1d6', emissive: new Color('#fff1d6'), emissiveIntensity: 1.2 })
  const strips = new MeshBasicMaterial({ color: 0x000000 })
  const renderer = { toneMappingExposure: 1 }
  const floors = FLOORS.map(([, walk]) => ({ material: new MeshStandardMaterial({ roughness: 0.6 }), walk }))
  const targets: DayTargets = {
    sun,
    hemi,
    scene,
    glass,
    panels,
    lamps,
    nightLights: { material: strips, setLit: () => undefined },
    renderer,
    floors,
    ceilingEmissive: 1.3,
    fxLite: false,
  }
  return { sun, hemi, scene, renderer, floors, targets }
}

function run(d: DaylightDriver, r: ReturnType<typeof rig>, hour: number, seconds: number, indoor: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) d.frame(1 / 60, () => hour, 0, r.targets, indoor)
}

const luminance = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

describe('the look the driver writes (W3)', () => {
  beforeEach(() => setScreenLevel(1))

  it('the overview is exactly the overview: exposure 1, no volume, no reflection, no grade, no vignette, floors as built, the room environment', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, r, 12, 3, 0)
    const day = lightAt(12)
    expect(r.renderer.toneMappingExposure).toBeCloseTo(TONE_EXPOSURE_SCALE, 12)
    expect(r.sun.intensity).toBeCloseTo(day.sunIntensity, 12)
    expect(r.hemi.intensity).toBeCloseTo(day.hemiIntensity, 12)
    expect(r.scene.environmentIntensity).toBeCloseTo(day.envIntensity, 12) // no match factor: it is RoomEnvironment's
    expect(lvUniforms.uLvOn.value).toBe(0) // the shader skips the fetch altogether
    expect(lvUniforms.uLvIndoor.value).toBe(0)
    expect(lvUniforms.uLvAo.value).toBe(0)
    expect(lvUniforms.uLvReflect.value).toBe(0)
    expect(lvUniforms.uLvGlass.value).toBe(0)
    expect(lvUniforms.uLvPanel.value.r).toBe(0)
    expect(lvUniforms.uLvSky.value.r).toBe(0)
    for (const f of r.floors) expect(f.material.roughness).toBe(0.6)
    expect(liveLook.grade).toBe(0)
    expect(liveLook.vignette).toBe(0)
    expect(liveLook.hospitalEnv).toBe(false)
    expect(LOOK_OVERVIEW.exposure).toBe(1)
  })

  it('walking at noon: the walk look, the volume on, the floors glossy, the grade and vignette up, the hospital environment bound', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, r, 12, 4, 1)
    const day = lightAt(12)
    expect(r.renderer.toneMappingExposure).toBeCloseTo(LOOK_WALK.exposure * TONE_EXPOSURE_SCALE, 9)
    expect(r.sun.intensity).toBeCloseTo(day.sunIntensity * LOOK_WALK.sun, 9)
    expect(r.hemi.intensity).toBeCloseTo(day.hemiIntensity * LOOK_WALK.hemi, 9)
    expect(r.scene.environmentIntensity).toBeCloseTo(day.envIntensity * LOOK_WALK.env * HOSPITAL_ENV_MATCH, 9)
    expect(lvUniforms.uLvOn.value).toBe(1)
    expect(lvUniforms.uLvIndoor.value).toBe(1)
    expect(lvUniforms.uLvAo.value).toBe(LOOK_WALK.ao)
    expect(lvUniforms.uLvReflect.value).toBe(LOOK_WALK.reflect)
    expect(lvUniforms.uLvGlass.value).toBe(LOOK_WALK.glass)
    // the panels' colour is the ceiling's warm white at the walk gain, and the reflection's radiance is that times the panel brightness
    const white = new Color(PANEL_COLOR)
    expect(lvUniforms.uLvPanel.value.r).toBeCloseTo(white.r * LOOK_WALK.panelGain, 6)
    expect(lvUniforms.uLvPanelRad.value.g).toBeCloseTo(white.g * 1.3, 6)
    expect(luminance(lvUniforms.uLvSky.value)).toBeGreaterThan(0.5)
    FLOORS.forEach(([, walk], i) => expect(r.floors[i].material.roughness).toBeCloseTo(walk, 9))
    expect(liveLook.grade).toBe(1)
    expect(liveLook.vignette).toBeCloseTo(VIGNETTE_DARKNESS, 9)
    expect(liveLook.hospitalEnv).toBe(true)
  })

  it('crossfades with the indoor blend and settles on exact values, then stops writing', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, r, 12, 3, 0)
    const sunDay = r.sun.intensity
    let last = r.renderer.toneMappingExposure
    for (let i = 0; i < 20; i++) {
      d.frame(1 / 60, () => 12, 0, r.targets, 1)
      expect(r.renderer.toneMappingExposure).toBeGreaterThanOrEqual(last - 1e-12)
      last = r.renderer.toneMappingExposure
    }
    expect(last).toBeGreaterThan(TONE_EXPOSURE_SCALE)
    expect(last).toBeLessThan(LOOK_WALK.exposure * TONE_EXPOSURE_SCALE)
    expect(r.sun.intensity).toBeLessThan(sunDay)
    run(d, r, 12, INDOOR_SECONDS * 14, 1)
    expect(r.renderer.toneMappingExposure).toBeCloseTo(LOOK_WALK.exposure * TONE_EXPOSURE_SCALE, 9)
    const writes = d.writes
    run(d, r, 12, 3, 1)
    expect(d.writes).toBe(writes)
    // and back
    run(d, r, 12, INDOOR_SECONDS * 14, 0)
    expect(r.renderer.toneMappingExposure).toBeCloseTo(TONE_EXPOSURE_SCALE, 12)
    expect(lvUniforms.uLvOn.value).toBe(0)
    for (const f of r.floors) expect(f.material.roughness).toBeCloseTo(0.6, 9)
  })

  it('swaps the environment once, half way, with a band of hysteresis, and the intensity changes with it', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, r, 12, 3, 0)
    expect(liveLook.hospitalEnv).toBe(false)
    // going in: it flips after the middle plus the band, and only once
    const flips: number[] = []
    let was = liveLook.hospitalEnv
    const jumps: number[] = []
    for (let i = 0; i < 120; i++) {
      const before = r.scene.environmentIntensity
      d.frame(1 / 60, () => 12, 0, r.targets, 1)
      if (liveLook.hospitalEnv !== was) {
        flips.push(liveLook.blend)
        was = liveLook.hospitalEnv
        jumps.push(r.scene.environmentIntensity / before)
      }
    }
    // the ambient does not jump at the swap: the intensity moves by the match and the blend's own step, not by more
    expect(jumps).toHaveLength(1)
    expect(jumps[0]).toBeGreaterThan(HOSPITAL_ENV_MATCH * 0.95)
    expect(jumps[0]).toBeLessThan(HOSPITAL_ENV_MATCH * 1.05)
    expect(flips).toHaveLength(1)
    expect(flips[0]).toBeGreaterThan(ENV_SWAP_AT + ENV_SWAP_BAND - 0.1)
    expect(flips[0]).toBeLessThan(0.75)
    expect(liveLook.hospitalEnv).toBe(true)
    run(d, r, 12, INDOOR_SECONDS * 14, 1) // settle
    const day = lightAt(12)
    expect(r.scene.environmentIntensity).toBeCloseTo(day.envIntensity * LOOK_WALK.env * HOSPITAL_ENV_MATCH, 9)
    // coming out: it flips back below the middle minus the band
    const back: number[] = []
    for (let i = 0; i < 120; i++) {
      d.frame(1 / 60, () => 12, 0, r.targets, 0)
      if (liveLook.hospitalEnv !== was) {
        back.push(liveLook.blend)
        was = liveLook.hospitalEnv
      }
    }
    expect(back).toHaveLength(1)
    expect(back[0]).toBeLessThan(ENV_SWAP_AT)
    expect(liveLook.hospitalEnv).toBe(false)
    run(d, r, 12, INDOOR_SECONDS * 14, 0) // settle
    expect(r.scene.environmentIntensity).toBeCloseTo(day.envIntensity, 9)
  })

  it('night: the rooms are lit by warm, dimmer panels and a dark sky', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, r, 12, 3, 1)
    const panelDay = lvUniforms.uLvPanel.value.clone()
    const skyDay = luminance(lvUniforms.uLvSky.value)
    run(d, r, 23, 4, 1)
    const panelNight = lvUniforms.uLvPanel.value
    expect(luminance(panelNight)).toBeLessThan(luminance(panelDay) * 0.75)
    expect(panelNight.r / panelNight.b).toBeGreaterThan(panelDay.r / panelDay.b) // warmer
    expect(luminance(lvUniforms.uLvSky.value)).toBeLessThan(skyDay * 0.1)
    expect(lvUniforms.uLvPanelRad.value.g).toBeLessThan(1.3 * new Color(PANEL_COLOR).g)
  })

  it('?look=model is the M5 walk look and nothing of W3: legacy factors, no volume, no reflection, no grade, the room environment', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags('?look=model'))
    run(d, r, 12, 4, 1)
    const day = lightAt(12)
    expect(r.sun.intensity).toBeCloseTo(day.sunIntensity * LOOK_MODEL_WALK.sun, 9)
    expect(r.hemi.intensity).toBeCloseTo(day.hemiIntensity * 1.5, 9)
    expect(r.scene.environmentIntensity).toBeCloseTo(day.envIntensity * 2.2, 9)
    expect(r.renderer.toneMappingExposure).toBeCloseTo(TONE_EXPOSURE_SCALE, 12)
    expect(lvUniforms.uLvOn.value).toBe(0) // not even the fetch
    expect(lvUniforms.uLvAo.value).toBe(0)
    expect(lvUniforms.uLvReflect.value).toBe(0)
    expect(lvUniforms.uLvGlass.value).toBe(0)
    expect(lvUniforms.uLvPanel.value.r).toBe(0)
    expect(lvUniforms.uLvSky.value.r).toBe(0)
    expect(liveLook.grade).toBe(0)
    expect(liveLook.vignette).toBe(0)
    expect(liveLook.hospitalEnv).toBe(false)
    for (const f of r.floors) expect(f.material.roughness).toBe(0.6)
  })

  it('?lv=0 skips the volume (the shader fetch) and the AO but keeps the rest of the walk look; ?refl=0 drops the reflection; ?env=room keeps one environment', () => {
    const r = rig()
    run(new DaylightDriver(parseLightingFlags('?lv=0')), r, 12, 4, 1)
    expect(lvUniforms.uLvOn.value).toBe(0)
    expect(lvUniforms.uLvAo.value).toBe(0)
    expect(lvUniforms.uLvReflect.value).toBe(LOOK_WALK.reflect)
    expect(r.renderer.toneMappingExposure).toBeCloseTo(LOOK_WALK.exposure * TONE_EXPOSURE_SCALE, 9)

    const r2 = rig()
    run(new DaylightDriver(parseLightingFlags('?refl=0')), r2, 12, 4, 1)
    expect(lvUniforms.uLvOn.value).toBe(1)
    expect(lvUniforms.uLvReflect.value).toBe(0)

    const r3 = rig()
    run(new DaylightDriver(parseLightingFlags('?env=room')), r3, 12, 4, 1)
    expect(liveLook.hospitalEnv).toBe(false)
    expect(r3.scene.environmentIntensity).toBeCloseTo(lightAt(12).envIntensity * LOOK_WALK.env, 9)
  })

  it('the effects-lite rung turns the reflection off at once, and back on, with no other change', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, r, 12, 4, 1)
    expect(lvUniforms.uLvReflect.value).toBe(LOOK_WALK.reflect)
    const sun = r.sun.intensity
    const writes = d.writes
    r.targets.fxLite = true
    d.frame(1 / 60, () => 12, 0, r.targets, 1)
    expect(d.writes).toBe(writes + 1)
    expect(lvUniforms.uLvReflect.value).toBe(0)
    expect(r.sun.intensity).toBe(sun)
    run(d, r, 12, 1, 1)
    expect(d.writes).toBe(writes + 1) // at rest again
    r.targets.fxLite = false
    d.frame(1 / 60, () => 12, 0, r.targets, 1)
    expect(lvUniforms.uLvReflect.value).toBe(LOOK_WALK.reflect)
  })

  it('asks no material to recompile: the floors and the glass only have their uniforms written', () => {
    const r = rig()
    const versions = r.floors.map((f) => f.material.version)
    const d = new DaylightDriver(parseLightingFlags(''))
    for (const [h, k] of [[12, 1], [12, 0], [3, 1], [19, 0], [12, 1]] as const) run(d, r, h, 2, k)
    expect(r.floors.map((f) => f.material.version)).toEqual(versions)
  })

  it('without the W3 targets (the old rigs, a layer not mounted) it still writes the old lights', () => {
    const r = rig()
    const bare: DayTargets = { ...r.targets, renderer: null, floors: null, ceilingEmissive: undefined, fxLite: undefined }
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, { ...r, targets: bare }, 12, 3, 1)
    expect(r.sun.intensity).toBeCloseTo(lightAt(12).sunIntensity * LOOK_WALK.sun, 9)
    expect(lvUniforms.uLvPanelRad.value.r).toBe(0)
  })
})

describe('presentation: the lobby probe and the sky (driver side)', () => {
  beforeEach(() => setScreenLevel(1))

  it('the lobby environment is announced and its intensity re-written when the camera enters the lobby, and ?env=room / ?look=model refuse it', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, r, 12, INDOOR_SECONDS * 14, 1)
    expect(liveLook.lobbyEnv).toBe(false)
    const before = r.scene.environmentIntensity
    r.targets.lobbyEnv = true
    d.frame(1 / 60, () => 12, 0, r.targets, 1)
    expect(liveLook.lobbyEnv).toBe(true)
    expect(r.scene.environmentIntensity).toBeCloseTo((before / HOSPITAL_ENV_MATCH) * LOBBY_ENV_MATCH, 9)
    r.targets.lobbyEnv = false
    d.frame(1 / 60, () => 12, 0, r.targets, 1)
    expect(liveLook.lobbyEnv).toBe(false)
    for (const q of ['?env=room', '?look=model']) {
      const r2 = rig()
      const d2 = new DaylightDriver(parseLightingFlags(q))
      r2.targets.lobbyEnv = true
      run(d2, r2, 12, 2, 1)
      expect(liveLook.lobbyEnv).toBe(false)
    }
  })

  it('the sky uniforms follow the hour, the day share and the indoor blend', () => {
    const r = rig()
    const d = new DaylightDriver(parseLightingFlags(''))
    run(d, r, 12, 3, 0)
    expect(skyUniforms.uBlend.value).toBe(0)
    expect(skyUniforms.uDay.value).toBeCloseTo(1, 6)
    run(d, r, 12, INDOOR_SECONDS * 14, 1)
    expect(skyUniforms.uBlend.value).toBe(1)
    const noon = lightAt(12)
    expect(skyUniforms.uSky.value.getHex()).toBe(new Color().setRGB(noon.sky[0], noon.sky[1], noon.sky[2], 'srgb').getHex())
    run(d, r, 2, 3, 1) // a jump to the small hours snaps
    expect(skyUniforms.uDay.value).toBeCloseTo(0, 6)
    expect(luminance(skyUniforms.uSky.value)).toBeLessThan(0.05)
  })
})
