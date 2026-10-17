/**
 * The Jump menu as data: the moments of the day (CONFIG.day.moments hours, label and caption from src/content/day.json) and
 * where the clock is among them. Pure, so it is unit-tested in node.
 */
import { DAY_MOMENTS } from '@/content/day'
import { CONFIG } from '@/sim/config'
import { hourText } from './dayStats'

export interface JumpItem {
  hour: number
  /** "07:45". */
  time: string
  label: string
  caption: string
  /** The clock is inside this moment (it has begun, and the next one has not). */
  isNow: boolean
  /** The moment is already over (the clock is past the next one). */
  isPast: boolean
}

/** A clock hour (0..24, wrapping past midnight) placed on the simulated day, which starts at CONFIG.day.startHour (06:30). */
export function dayHour(clockHour: number): number {
  return clockHour < CONFIG.day.startHour ? clockHour + 24 : clockHour
}

export function buildJumpItems(clockHour: number): JumpItem[] {
  const h = dayHour(clockHour)
  let nowIndex = -1
  DAY_MOMENTS.forEach((m, i) => {
    if (m.hour <= h) nowIndex = i
  })
  return DAY_MOMENTS.map((m, i) => ({
    hour: m.hour,
    time: hourText(m.hour),
    label: m.label,
    caption: m.caption,
    isNow: i === nowIndex,
    isPast: i < nowIndex,
  }))
}

/** The index the keyboard focus starts on: the moment the clock is in, or the first one. */
export function startIndex(items: readonly JumpItem[]): number {
  const i = items.findIndex((m) => m.isNow)
  return i < 0 ? 0 : i
}

/** The clock hour from the HUD's "07:45" text (the store publishes text), or null if it does not parse. */
export function clockHourOf(clock: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock)
  return m ? Number(m[1]) + Number(m[2]) / 60 : null
}
