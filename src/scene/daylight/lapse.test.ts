import { Color, DirectionalLight, HemisphereLight, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setScreenLevel } from './dim'
import { DaylightDriver, FOLLOW_SECONDS, type DayTargets } from './driver'
import { clockAngles, endLapse, lapse, lapseEase, lapseHourAt, lapseHours, startLapse } from './lapse'
import { lightAt } from './lightAt'

function rig() {
  const sun = new DirectionalLight('#fff6ea', 1.75)
  const hemi = new HemisphereLight('#f4fbff', '#d9d3c8', 0.75)
  const scene = { background: new Color('#e9eeed'), environmentIntensity: 0.35 }
  const mat = (c: string) => new MeshStandardMaterial({ color: c, emissive: new Color(c), emissiveIntensity: 1 })
  const targets: DayTargets = {
    sun,
    hemi,
    scene,
    glass: new MeshStandardMaterial({ transparent: true, opacity: 0.2 }),
    panels: mat('#1fb5ad'),
    lamps: mat('#fff1d6'),
    nightLights: { material: new MeshBasicMaterial(), setLit: () => undefined },
  }
  return { sun, hemi, targets }
}

describe('skip time-lapse: the sky', () => {
  beforeEach(() => {
    setScreenLevel(1)
    endLapse()
  })
  afterEach(() => endLapse())

  it('maths: ease is monotonic 0..1, hours run forward (across midnight too)', () => {
    expect(lapseEase(0)).toBe(0)
    expect(lapseEase(1)).toBe(1)
    expect(lapseEase(-1)).toBe(0)
    expect(lapseEase(2)).toBe(1)
    expect(lapseHourAt(7.5, 8.5, 0)).toBe(7.5)
    expect(lapseHourAt(7.5, 8.5, 1)).toBe(8.5)
    expect(lapseHourAt(7.5, 8.5, 0.5)).toBeCloseTo(8, 9)
    expect(lapseHourAt(23.5, 0.5, 1)).toBeCloseTo(24.5, 9)
    expect(lapseHours(23.5, 0.5)).toBe(1)
  })

  it('clock angles: the minute hand turns once per hour skipped, the hour hand a twelfth of that', () => {
    const a = clockAngles(7.5, 8.5)
    expect(a.minuteFrom).toBeCloseTo(180, 9)
    expect(a.minuteTo - a.minuteFrom).toBeCloseTo(360, 9)
    expect(a.hourFrom).toBeCloseTo(225, 9)
    expect(a.hourTo - a.hourFrom).toBeCloseTo(30, 9)
    const q = clockAngles(7.5, 7.75)
    expect(q.minuteTo - q.minuteFrom).toBeCloseTo(90, 9)
  })

  it('follows the lapse hour directly every frame, without the 0.8 s lag', () => {
    const r = rig()
    const d = new DaylightDriver()
    d.frame(1 / 60, () => 7.5, 0, r.targets)
    startLapse(12)
    d.frame(1 / 60, () => 7.5, 0, r.targets) // one frame, and the real hour (7.5) is ignored
    expect(r.sun.intensity).toBeCloseTo(lightAt(12).sunIntensity, 9)
    // it keeps tracking a moving lapse hour frame by frame (not once a second)
    for (const h of [12.1, 12.2, 13.3]) {
      lapse.hour = h
      d.frame(1 / 60, () => 7.5, 0, r.targets)
      expect(r.sun.intensity).toBeCloseTo(lightAt(h).sunIntensity, 9)
    }
  })

  it('runs the whole sky through the dawn, and lets go of the sim hour for good only when it ends', () => {
    const r = rig()
    const d = new DaylightDriver()
    d.frame(1 / 60, () => 5, 0, r.targets)
    const seen: number[] = []
    startLapse(5)
    for (let i = 0; i <= 12; i++) {
      lapse.hour = lapseHourAt(5, 9, i / 12)
      d.frame(1 / 60, () => 5, 0, r.targets)
      seen.push(r.sun.intensity)
    }
    expect(seen.at(-1)).toBeCloseTo(lightAt(9).sunIntensity, 9)
    expect(seen.at(-1)!).toBeGreaterThan(seen[0])
    // the real hour after the swap is 9.2: snap there on the first frame after the lapse
    endLapse()
    d.frame(1 / 60, () => 9.2, 0, r.targets)
    expect(r.sun.intensity).toBeCloseTo(lightAt(9.2).sunIntensity, 9)
  })

  it('snaps back to the real hour when the lapse ends, even if it differs only a little', () => {
    const r = rig()
    const d = new DaylightDriver()
    d.frame(1 / 60, () => 9, 0, r.targets)
    startLapse(9.4)
    d.frame(1 / 60, () => 9, 0, r.targets)
    endLapse()
    d.frame(1 / 60, () => 9, 0, r.targets)
    // no easing: exactly the light of 9:00 on that very frame (an ease over FOLLOW_SECONDS would still be far off)
    expect(FOLLOW_SECONDS).toBeGreaterThan(1 / 60)
    expect(r.sun.intensity).toBeCloseTo(lightAt(9).sunIntensity, 9)
  })

  it('does not touch the sky when no lapse is active (the sim hour rules)', () => {
    const r = rig()
    const d = new DaylightDriver()
    lapse.hour = 3
    d.frame(1 / 60, () => 12, 0, r.targets)
    expect(r.sun.intensity).toBeCloseTo(lightAt(12).sunIntensity, 9)
  })
})
