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
 * big step in the hour the driver snaps instead of easing, behind the fade.
 *
 * Walk mode (W1): the caller passes `indoor` (0 in the overview, 1 while walking); the driver eases a blend toward it and, on top of
 * the light of the hour, scales the sun down and the fill and environment up (./indoor.ts). Same properties, same uniforms.
 *
 * Pure of React and of the sim (the hour and the generation are passed in), so it runs in node tests with real three objects.
 */
import { Color, type DirectionalLight, type HemisphereLight, type MeshBasicMaterial, type MeshStandardMaterial, type Scene } from 'three'
import { setScreenLevel } from './dim'
import { INDOOR, INDOOR_SECONDS, indoorFactor } from './indoor'
import { copyDayLight, createDayLight, lerpDayLight, lightAt, maxDifference, type DayLight } from './lightAt'

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
  /** The indoor blend now (eased toward the target the caller passes) and the one last written. */
  private indoor = 0
  private appliedIndoor = 0
  private baseTealEmissive: Color | null = null
  private baseTealIntensity = 0
  private baseLampIntensity = 0
  private readonly tmp = new Color()
  /** Frames on which something was written (for tests). */
  writes = 0

  /**
   * One frame. `hour` is read (at 1 Hz) from `readHour`; `generation` changes when the hospital is rebuilt (a Jump).
   * Allocation-free after the first call.
   */
  frame(dt: number, readHour: () => number, generation: number, t: DayTargets, indoorTarget = 0): void {
    this.timer += dt
    let snap = this.first || generation !== this.generation
    this.generation = generation
    if (this.timer >= READ_SECONDS || snap) {
      this.timer = 0
      const hour = readHour()
      if (!this.first && Math.abs(circularDelta(hour, this.lastHour)) > SNAP_HOURS) snap = true
      this.lastHour = hour
      lightAt(hour, this.target)
    }
    if (snap) copyDayLight(this.target, this.current)
    else lerpDayLight(this.current, this.target, 1 - Math.exp(-Math.min(dt, 0.25) / FOLLOW_SECONDS), this.current)
    // the indoor blend follows its target the same way and comes to an exact rest
    if (snap) this.indoor = indoorTarget
    else if (this.indoor !== indoorTarget) {
      this.indoor += (indoorTarget - this.indoor) * (1 - Math.exp(-Math.min(dt, 0.25) / INDOOR_SECONDS))
      if (Math.abs(indoorTarget - this.indoor) < 1e-3) this.indoor = indoorTarget
    }
    // once the lights have caught up there is nothing left to write
    if (!snap && !this.pending && this.indoor === this.appliedIndoor && maxDifference(this.current, this.applied) < 1e-5) return
    this.apply(this.current, t)
    this.first = false
    this.pending = !t.sun || !t.hemi || !t.scene || !t.nightLights
    copyDayLight(this.current, this.applied)
    this.appliedIndoor = this.indoor
    this.writes++
  }

  /** Write `l` into the targets: colours, intensities, opacities, visibility. Nothing here needs a recompile. */
  apply(l: DayLight, t: DayTargets): void {
    const tmp = this.tmp
    const k = this.indoor
    if (t.sun) {
      t.sun.color.setRGB(l.sun[0], l.sun[1], l.sun[2], 'srgb')
      t.sun.intensity = l.sunIntensity * indoorFactor(INDOOR.sun, k)
    }
    if (t.hemi) t.hemi.intensity = l.hemiIntensity * indoorFactor(INDOOR.hemi, k)
    if (t.scene) {
      t.scene.environmentIntensity = l.envIntensity * indoorFactor(INDOOR.env, k)
      const bg = t.scene.background as Color | null
      if (bg && (bg as Color).isColor) bg.setRGB(l.sky[0], l.sky[1], l.sky[2], 'srgb')
    }
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
}

/** The shortest signed difference between two hours of the day. */
export function circularDelta(a: number, b: number): number {
  let d = (a - b) % 24
  if (d > 12) d -= 24
  else if (d < -12) d += 24
  return d
}

