import { CONFIG } from './config'

/** `?start=12:00` or `?start=12.5`; clamped to the simulated day. Undefined: the default 07:30 start. */
export function parseStartHour(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw)
  const h = m ? Number(m[1]) + Number(m[2]) / 60 : Number(raw)
  if (!Number.isFinite(h)) return undefined
  return Math.min(CONFIG.day.endHour, Math.max(CONFIG.day.startHour, h))
}
