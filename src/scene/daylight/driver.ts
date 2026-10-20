/**
 * The daylight driver (L1): reads the clock hour once a second, asks `lightAt` for the target and eases the lights toward it every
 * frame (a soft exponential follow, 0.8 s), writing ONLY uniforms and existing properties:
 *
 *   sun         DirectionalLight.color and .intensity          (the position, the target and the shadow are never touched)
 *   fill        HemisphereLight.intensity, Scene.environmentIntensity
 *   sky         Scene.background (a Color, in place)
 *   glass       MAT.glass colour and opacity
 *   panels      MAT.glowTeal emissive colour (toward warm) and intensity (dimmer), MAT.glowWarm intensity (the bedside lamps)
 *   screens     the dimmable colours the ward layer registered (./dim.ts)
 *   night lights  the corridor strips' colour, and whether they write any pixels (off by day)
 *
 * No new lights, no `needsUpdate` on any material or the shadow map, no define changes, so nothing recompiles and the baked shadow
 * map is never rendered again after mount (src/scene/daylight/shadowBake.test.ts greps for it). After a Jump (a new simulation) or a
 * big step in the hour the driver snaps instead of easing, behind the fade. During a skip's time-lapse (S1, ./lapse.ts) it takes the
 * lapse hour every frame and follows it directly; when the lapse ends it snaps to the real hour.
 *
 * Walk mode (W1): the caller passes `indoor` (0 in the overview, 1 while walking); the driver eases a blend toward it and, on top of
 * the light of the hour, applies the LOOK of that blend (src/scene/lighting/look.ts: row 0 is exactly the overview's light, row 1 the
 * realistic walk look): the sun, fill and environment factors, the tone-mapping exposure, the light volume's uniforms (the panels' and the
 * sky's colour at the hour, the AO strength), the floors' roughness, the floor reflection and glass Fresnel strengths, and the colour grade's
 * and vignette's strengths (published in `liveLook` for Effects.tsx). Same properties, same uniforms, never a define or a needsUpdate.
 *
 * Pure of React and of the sim (the hour and the generation are passed in), so it runs in node tests with real three objects.
 */
import { Color, type DirectionalLight, type HemisphereLight, type MeshBasicMaterial, type MeshStandardMaterial, type Scene } from 'three'
import { LIGHTING_FLAGS, type LightingFlags } from '@/scene/lighting/flags'
import { liveLook } from '@/scene/lighting/liveLook'
import {
  ENV_SWAP_AT,
  ENV_SWAP_BAND,
  HOSPITAL_ENV_MATCH,
  PANEL_COLOR,
  PANEL_NIGHT_COLOR,
  PANEL_WARMTH,
  SKY_MIN,
  VIGNETTE_DARKNESS,
  createLook,
  lookAt,
  type Look,
} from '@/scene/lighting/look'
import { lvUniforms } from '@/scene/lighting/volume/uniforms'
import { setScreenLevel } from './dim'
import { INDOOR_SECONDS } from './indoor'
import { copyDayLight, createDayLight, lerpDayLight, lightAt, maxDifference, type DayLight } from './lightAt'
import { lapse } from './lapse'

/** What the driver writes into. Anything may be null (a layer not mounted yet): it is skipped. */
export interface DayTargets {
  sun: DirectionalLight | null
  hemi: HemisphereLight | null
  scene: Pick<Scene, 'background' | 'environmentIntensity'> | null
  glass: MeshStandardMaterial
  /** The teal glow of the in-room panels and sensors. */
  panels: MeshStandardMaterial
  /** The warm glow of the bedside lamps. */
  lamps: MeshStandardMaterial
  /** The corridor night lights: a basic material whose colour is the level, and whether they are lit at all (see `setLit`). */
  nightLights: { material: MeshBasicMaterial; setLit(lit: boolean): void } | null
  /** W3: the renderer (only its `toneMappingExposure` is written: the post-processing tone mapper reads it). */
  renderer?: { toneMappingExposure: number } | null
  /** W3: the interior floors and the roughness each has while walking (the base values are remembered at the first write). */
  floors?: readonly { material: MeshStandardMaterial; walk: number }[] | null
  /** W3: the walk ceiling's panels: their emissive intensity at full brightness, for the radiance the floors reflect. */
  ceilingEmissive?: number
  /** W3: the quality ladder is on its effects-lite rung (no floor reflection). */
  fxLite?: boolean
}

/** Seconds the lights take to catch up with a new target (an exponential follow). */
export const FOLLOW_SECONDS = 0.8
/** The hour is read this often (real seconds). */
export const READ_SECONDS = 1
/** A step in the hour bigger than this (hours) is a Jump or a scrub: snap. */
export const SNAP_HOURS = 0.5
/** The night lights write no pixels below this level. */
export const NIGHT_LIGHT_VISIBLE = 0.02

const WARM_PANEL = new Color('#ffd7a3')
const NIGHT_LIGHT_COLOR = new Color('#ffc886')
/** The ceiling panels' light (W3) and the warm white it drifts toward at night, parsed once. */
const PANEL_WHITE = new Color(PANEL_COLOR)
const PANEL_NIGHT = new Color(PANEL_NIGHT_COLOR)

export class DaylightDriver {
  private readonly target = createDayLight()
  private readonly current = createDayLight()
  private readonly applied = createDayLight()
  private timer = READ_SECONDS
  private first = true
  /** A target was missing at the last write (a layer not mounted yet): write again next frame. */
  private pending = false
  private generation = -1
  private lastHour = 0
  /** S1: the sky was driven by a skip's time-lapse on the last frame (when it stops, snap to the real hour). */
  private wasLapsing = false
  /** The indoor blend now (eased toward the target the caller passes) and the one last written. */
  private indoor = 0
  private appliedIndoor = 0
  private baseTealEmissive: Color | null = null
  private baseTealIntensity = 0
  private baseLampIntensity = 0
  private readonly tmp = new Color()
  private readonly look = createLook()
  private readonly panelColor = new Color()
  private floorBase: number[] | null = null
  /** The environment bound now (decided with hysteresis around the swap point), and the effects rung last written. */
  private hospitalEnv = false
  private appliedFxLite = false
  /** Frames on which something was written (for tests). */
  writes = 0

  constructor(private readonly flags: Readonly<LightingFlags> = LIGHTING_FLAGS) {}

  /**
   * One frame. `hour` is read (at 1 Hz) from `readHour`; `generation` changes when the hospital is rebuilt (a Jump).
   * Allocation-free after the first call.
   */
  frame(dt: number, readHour: () => number, generation: number, t: DayTargets, indoorTarget = 0): void {
    this.timer += dt
    let snap = this.first || generation !== this.generation
    this.generation = generation
    // S1: while a skip lapses the sky runs from the lapse hour, read every frame and followed directly (no lag); when it ends, snap to the real hour
    const lapsing = lapse.active
    if (lapsing !== this.wasLapsing) {
      this.wasLapsing = lapsing
      if (!lapsing) snap = true
    }
    if (this.timer >= READ_SECONDS || snap || lapsing) {
      this.timer = 0
      const hour = lapsing ? lapse.hour : readHour()
      if (!lapsing && !this.first && Math.abs(circularDelta(hour, this.lastHour)) > SNAP_HOURS) snap = true
      this.lastHour = hour
      lightAt(hour, this.target)
    }
    if (snap || lapsing) copyDayLight(this.target, this.current)
    else lerpDayLight(this.current, this.target, 1 - Math.exp(-Math.min(dt, 0.25) / FOLLOW_SECONDS), this.current)
    // the indoor blend follows its target the same way and comes to an exact rest
    if (snap) this.indoor = indoorTarget
    else if (this.indoor !== indoorTarget) {
      this.indoor += (indoorTarget - this.indoor) * (1 - Math.exp(-Math.min(dt, 0.25) / INDOOR_SECONDS))
      if (Math.abs(indoorTarget - this.indoor) < 1e-3) this.indoor = indoorTarget
    }
    // which environment is bound: the hospital's once the blend has crossed half way (a band of hysteresis, so a reversed flight never flickers)
    const wantHospital = this.wantsHospitalEnv()
    const fxLite = !!t.fxLite
    // once the lights have caught up there is nothing left to write
    if (
      !snap &&
      !this.pending &&
      this.indoor === this.appliedIndoor &&
      wantHospital === this.hospitalEnv &&
      fxLite === this.appliedFxLite &&
      maxDifference(this.current, this.applied) < 1e-5
    )
      return
    this.hospitalEnv = wantHospital
    this.appliedFxLite = fxLite
    this.apply(this.current, t)
    this.first = false
    this.pending = !t.sun || !t.hemi || !t.scene || !t.nightLights
    copyDayLight(this.current, this.applied)
    this.appliedIndoor = this.indoor
    this.writes++
  }

  /** Hospital environment: on when the blend is past the swap point (plus the band going in, minus it coming out), never with ?look=model or ?env=room. */
  private wantsHospitalEnv(): boolean {
    if (this.flags.model || this.flags.roomEnv) return false
    const k = this.indoor
    return this.hospitalEnv ? k > ENV_SWAP_AT - ENV_SWAP_BAND : k > ENV_SWAP_AT + ENV_SWAP_BAND
  }

  /** Write `l` into the targets: colours, intensities, opacities, visibility. Nothing here needs a recompile. */
  apply(l: DayLight, t: DayTargets): void {
    const tmp = this.tmp
    const k = this.indoor
    const look = lookAt(k, this.flags.model, this.look)
    if (t.sun) {
      t.sun.color.setRGB(l.sun[0], l.sun[1], l.sun[2], 'srgb')
      t.sun.intensity = l.sunIntensity * look.sun
    }
    if (t.hemi) t.hemi.intensity = l.hemiIntensity * look.hemi
    if (t.scene) {
      // the hospital's environment is a little dimmer overhead than RoomEnvironment: HOSPITAL_ENV_MATCH keeps the ambient continuous at the swap
      t.scene.environmentIntensity = l.envIntensity * look.env * (this.hospitalEnv ? HOSPITAL_ENV_MATCH : 1)
      const bg = t.scene.background as Color | null
      if (bg && (bg as Color).isColor) bg.setRGB(l.sky[0], l.sky[1], l.sky[2], 'srgb')
    }
    this.applyLook(l, look, t)
    t.glass.color.setRGB(l.glass[0], l.glass[1], l.glass[2], 'srgb')
    t.glass.opacity = l.glassOpacity
    // the panels keep their own teal at day and move toward warm white as the rooms settle for the evening and the night
    if (this.baseTealEmissive === null) {
      this.baseTealEmissive = t.panels.emissive.clone()
      this.baseTealIntensity = t.panels.emissiveIntensity
      this.baseLampIntensity = t.lamps.emissiveIntensity
    }
    t.panels.emissive.copy(this.baseTealEmissive)
    t.panels.emissive.lerp(tmp.copy(WARM_PANEL), l.panelWarmth * 0.6)
    t.panels.emissiveIntensity = this.baseTealIntensity * l.panelDim
    t.lamps.emissiveIntensity = this.baseLampIntensity * l.lampLevel
    setScreenLevel(l.screens)
    const nl = t.nightLights
    if (nl) {
      const lit = l.nightLights > NIGHT_LIGHT_VISIBLE
      nl.setLit(lit)
      if (lit) nl.material.color.copy(NIGHT_LIGHT_COLOR).multiplyScalar(l.nightLights)
    }
  }

  /**
   * The W3 part of the look: exposure, the light volume's uniforms, the floors, the effects' strengths. Numbers into uniforms and properties
   * that never need a recompile; nothing is allocated.
   */
  private applyLook(l: DayLight, look: Look, t: DayTargets): void {
    const k = this.indoor
    if (t.renderer) t.renderer.toneMappingExposure = look.exposure
    if (t.floors) {
      const floors = t.floors
      const base = (this.floorBase ??= floors.map((f) => f.material.roughness))
      for (let i = 0; i < floors.length; i++) floors[i].material.roughness = base[i] + (floors[i].walk - base[i]) * look.floorRough
    }
    // the light volume: on while there is anything to add (the overview skips the fetch altogether)
    const u = lvUniforms
    u.uLvOn.value = this.flags.volume && !this.flags.model && (k > 0 || look.ao > 0) ? 1 : 0
    u.uLvIndoor.value = k
    u.uLvAo.value = this.flags.volume ? look.ao : 0
    // the panels' light: their colour drifting warm in the evening, as bright as the visible panels are (the screens level dims both)
    this.panelColor.copy(PANEL_WHITE).lerp(PANEL_NIGHT, l.panelWarmth * PANEL_WARMTH)
    u.uLvPanel.value.copy(this.panelColor).multiplyScalar(look.panelGain * l.screens)
    // the sky through the windows, and the open air: its colour at the hour, as strong as the day is
    this.tmp.setRGB(l.sky[0], l.sky[1], l.sky[2], 'srgb')
    u.uLvSky.value.copy(this.tmp).multiplyScalar(look.skyGain * Math.max(SKY_MIN, 1 - l.night))
    // the floors: the panels' reflection (off in the overview, with ?refl=0 and on the effects-lite rung) and the glass's Fresnel
    u.uLvReflect.value = this.flags.reflect && !t.fxLite ? look.reflect : 0
    u.uLvPanelRad.value.copy(this.panelColor).multiplyScalar((t.ceilingEmissive ?? 0) * l.screens)
    u.uLvGlass.value = look.glass
    // the effects read these once a frame and act when `version` moves (Effects.tsx)
    liveLook.blend = k
    liveLook.hospitalEnv = this.hospitalEnv
    liveLook.grade = look.grade
    liveLook.vignette = look.vignette * VIGNETTE_DARKNESS
    liveLook.version++
  }
}

/** The shortest signed difference between two hours of the day. */
export function circularDelta(a: number, b: number): number {
  let d = (a - b) % 24
  if (d > 12) d -= 24
  else if (d < -12) d += 24
  return d
}

