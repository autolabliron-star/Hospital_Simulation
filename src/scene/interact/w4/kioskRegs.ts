/**
 * W4: the E interactions of the two entrance health kiosks. `hkiosk:<i>` is a priority-1 station at the weighing platform (radius 1.2 m, so you stand at the
 * tower facing it): E starts YOUR health check (`sim.vitals.beginPlayer`, driven by healthCheck.ts), E again while it runs leaves it, E with the report open
 * closes it. Somebody else on the kiosk shows "In use" and does nothing. All words come from src/content/kioskUi.json.
 *
 * The things it reads (the kiosks' states, the controller) come through `KioskRegEnv`, so the node tests drive it with fakes; the real ones are the host's live
 * sim (`host.sim().vitals`) and the registry the kiosk layer fills while it is mounted (no import of the sim here: the registrations stay light).
 */
import { KIOSK_UI, fillUi } from '@/content/kioskUi'
import type { Interactable } from '@/scene/interact.store'
import { HEALTH_KIOSKS } from '@/sim/places'
import type { HealthKioskState } from '@/sim/types'
import { healthCheckRegistry, type HealthCheckLike } from '../healthCheck'
import type { RegHost } from '../registrations'

/** How far from the platform's middle the prompt appears. */
export const KIOSK_PROMPT_RADIUS = 1.2

export interface KioskRegEnv {
  kiosks(): readonly HealthKioskState[]
  controller(): HealthCheckLike | null
}

const NONE: readonly HealthKioskState[] = []

/** The real thing: the kiosks of the host's (live) sim and the controller the kiosk layer registered. A host without a vitals service (a test's) has no kiosks. */
function hostEnv(host: RegHost): KioskRegEnv {
  return {
    kiosks: () => (host.sim() as Partial<{ vitals: { kiosks: readonly HealthKioskState[] } }>).vitals?.kiosks ?? NONE,
    controller: () => healthCheckRegistry.current,
  }
}

/** Is kiosk `i` free, or is the session on it yours? (Somebody else's is "in use".) */
export function usable(k: HealthKioskState | undefined, c: HealthCheckLike | null, i: number): boolean {
  if (!k) return false
  return k.phase === 'idle' || k.kind === 'player' || (c?.cardOpenFor(i) ?? false)
}

export function buildKioskInteractables(host: RegHost, env: KioskRegEnv = hostEnv(host)): Interactable[] {
  return HEALTH_KIOSKS.map((anchor, i): Interactable => {
    const n = i + 1
    return {
      id: `hkiosk:${i}`,
      kind: 'station',
      position: { x: anchor.stand.at.x, y: 0, z: anchor.stand.at.z },
      radius: KIOSK_PROMPT_RADIUS,
      priority: 1,
      label: () => {
        const c = env.controller()
        if (c?.runningOn(i)) return fillUi(KIOSK_UI.prompt.leave, { n })
        if (c?.cardOpenFor(i)) return KIOSK_UI.prompt.closeReport
        return fillUi(KIOSK_UI.prompt.use, { n })
      },
      enabled: () => usable(env.kiosks()[i], env.controller(), i),
      lockedLabel: () => fillUi(KIOSK_UI.prompt.inUse, { n }),
      onInteract: () => env.controller()?.press(i),
    }
  })
}
