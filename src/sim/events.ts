/**
 * The event log: every transition in the hospital emits one SimEvent with a plain sentence. The event line,
 * the order rail, the KPIs and the inspect card all read from here, and the determinism test compares it.
 */
import { CONFIG } from './config'
import type { SimEvent, SimEventType } from './types'

/** Keep this many events in memory (the KPIs keep their own running totals). */
const MAX_EVENTS = 2000

export class EventLog {
  readonly events: SimEvent[] = []
  private nextId = 1
  /** Bumped on every push so stores can tell when to re-publish. */
  version = 0

  push(t: number, type: SimEventType, text: string, refs: Omit<SimEvent, 'id' | 't' | 'type' | 'text'> = {}): SimEvent {
    const e: SimEvent = { id: this.nextId++, t, type, text, ...refs }
    this.events.push(e)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.version++
    return e
  }

  /** Events with id greater than `afterId`, oldest first. */
  since(afterId: number): SimEvent[] {
    const out: SimEvent[] = []
    for (let i = this.events.length - 1; i >= 0 && this.events[i].id > afterId; i--) out.push(this.events[i])
    return out.reverse()
  }
}

/** "07:42" for a sim time in seconds since the start of the day. */
export function clockText(t: number): string {
  const totalMin = Math.floor(CONFIG.sim.startHour * 60 + t / 60)
  const h = Math.floor(totalMin / 60) % 24
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Hour of day (fractional) for a sim time. */
export function hourOf(t: number): number {
  return (CONFIG.sim.startHour + t / 3600) % 24
}
