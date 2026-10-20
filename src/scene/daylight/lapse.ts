/**
 * S1 Skip: the sky during the time-lapse. A mutable plain object (no React, no store, no sim import) that the skip cover writes
 * while a skip is lapsing/swapping and the daylight driver reads: while `active` the driver takes `hour` instead of the sim's
 * clock and follows it directly (no easing lag), so the sky visibly runs from the old hour to the new one under the veil. When
 * the skip is over `active` goes false and the driver snaps to the real sim hour.
 */
export const lapse: { active: boolean; hour: number } = { active: false, hour: 0 }

/** Ease in and out, 0..1 -> 0..1 (so the sky starts and ends gently). */
export function lapseEase(p: number): number {
  const x = p < 0 ? 0 : p > 1 ? 1 : p
  return x * x * (3 - 2 * x)
}

/** The hour `p` (0..1) of the way from `fromHour` to `toHour` (forward in time, across midnight if `toHour` < `fromHour`); not wrapped. */
export function lapseHourAt(fromHour: number, toHour: number, p: number): number {
  const to = toHour < fromHour ? toHour + 24 : toHour
  return fromHour + (to - fromHour) * lapseEase(p)
}

/** Start driving the sky from `hour`. */
export function startLapse(hour: number): void {
  lapse.hour = hour
  lapse.active = true
}

/** Stop: the driver goes back to the sim's hour. */
export function endLapse(): void {
  lapse.active = false
}

/** The unwrapped length of a forward skip in hours (0 if the hours are equal; across midnight if `toHour` < `fromHour`). */
export function lapseHours(fromHour: number, toHour: number): number {
  return (toHour < fromHour ? toHour + 24 : toHour) - fromHour
}

/** Start and end angles (degrees, clockwise from 12) of the analogue clock's hour and minute hands for a skip; the end angles are unwrapped, so the minute hand turns once per hour skipped. */
export function clockAngles(fromHour: number, toHour: number): { hourFrom: number; hourTo: number; minuteFrom: number; minuteTo: number } {
  const hours = lapseHours(fromHour, toHour)
  const hourFrom = (fromHour % 12) * 30
  const minuteFrom = (fromHour % 1) * 360
  return { hourFrom, hourTo: hourFrom + hours * 30, minuteFrom, minuteTo: minuteFrom + hours * 360 }
}
