/**
 * R3 live patient monitors: `?probe=1` helpers on `window.__hospitalMonitors`, for the orchestrator's browser checks.
 *
 *   stats()      the pump's counters: runs, paints, copies, the last and the longest run (ms), hot monitors, live rows, rows waiting, patients
 *   monitors()   one line per monitor: id, level, hot, and per row the patient, live or waiting, the numbers shown
 *   atlas()      the atlas's size (px) and its GPU memory with mipmaps (MB)
 *   pump()       run the pump once now, with no budget (for a screenshot right after a Jump)
 *
 * Off unless the caller installs it (PatientMonitors does so with `?probe=1`).
 */
import type { HubStats, MonitorHub } from './hub'

export interface MonitorProbe {
  stats(): HubStats
  monitors(): { id: string; level: number; hot: boolean; rows: { patient: string; live: boolean; hr: number; spo2: number; nibp: string }[] }[]
  atlas(): { width: number; height: number; mb: number }
  pump(): void
}

export function createMonitorProbe(hub: MonitorHub): MonitorProbe {
  return {
    stats: () => ({ ...hub.stats }),
    monitors: () =>
      hub.monitors.map((m) => ({
        id: m.def.id,
        level: m.def.level,
        hot: m.hot,
        rows: m.rows.map((r) => ({
          patient: r.occ.name && r.key ? r.occ.name : '',
          live: r.live,
          hr: r.live ? r.numbers.hr : 0,
          spo2: r.live ? r.numbers.spo2 : 0,
          nibp: r.live && r.numbers.nibp.has ? `${r.numbers.nibp.sys}/${r.numbers.nibp.dia}` : '',
        })),
      })),
    atlas: () => ({ width: hub.plan.width, height: hub.plan.height, mb: Math.round(((hub.plan.width * hub.plan.height * 4 * 4) / 3 / 1048576) * 10) / 10 }),
    pump: () => hub.pump(Infinity),
  }
}

type MonitorWindow = { __hospitalMonitors?: MonitorProbe }

/** Put the probe on `target` (the window). Returns the function that takes it off again. */
export function installMonitorProbe(target: object, probe: MonitorProbe): () => void {
  const w = target as MonitorWindow
  w.__hospitalMonitors = probe
  return () => {
    if (w.__hospitalMonitors === probe) delete w.__hospitalMonitors
  }
}
