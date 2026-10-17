/**
 * The path of the packs of one delivery, as a pure function of time (no allocation, node-testable).
 *
 * The sim hands a delivery `N * drawers.transferSecondsPerItem` seconds (`MedSystem`: `deliverTimer`), one pack per
 * order item, and loads the drawer when that time is up. The picture matches it pack by pack:
 *
 *   t = 0                the pod is docked overhead and starts to unfold the funnel (`FUNNEL.seconds`)
 *   t = lead             pack 0 leaves the pod's bottom hatch (which is at the pod's centre, `ROBOT.podBottomY`)
 *   + hatch              it drops onto the funnel tray
 *   + slide              it slides down the tray to the tube's mouth
 *   + fall               it falls down the chute and into the cabinet top (the drawer)
 *   t = lead + k * T     pack k leaves the hatch, `T` = seconds per item
 *   journey < T          one pack per pod is in flight at a time, so a pool slot per pod is enough
 *
 * The last pack lands `lead + journey - T` seconds BEFORE the sim loads the drawer, so the packs are in the drawer when the
 * teal tile lights up. Everything is in chute-local metres (see chute.ts): x along the wall, y height, z outward.
 */
import { CONFIG } from '@/sim/config'
import { ROBOT } from '@/sim/places'
import { FUNNEL, type ChuteLayout } from './chute'

/** The packs in transit: small boxes that fit the 0.14 m tube (their corners stay inside a 0.0145 m offset of the axis). */
export const PACK = { x: 0.09, y: 0.04, z: 0.065 } as const

/** Pack pool size (instances at the end of the drawers' pack mesh): at most one in flight per pod. */
export const PACK_POOL = 16

export const FLIGHT = {
  /** The first pack waits for the funnel (as a fraction of `T`), the journey takes this much of each slot, and its three phases split it. */
  leadFrac: 0.34,
  journeyFrac: 0.62,
  hatchFrac: 0.16,
  slideFrac: 0.27,
  /** How far below the cabinet top the pack's centre ends (it is hidden inside the cabinet). */
  sink: 0.03,
} as const

/** Seconds per pack, from the sim's own config (a pure function of time takes it as an argument, this is the default). */
export const SECONDS_PER_ITEM = CONFIG.drawers.transferSecondsPerItem

export interface FlightTimes {
  /** Wait before pack 0 leaves the hatch. */
  lead: number
  /** Time from leaving the hatch to being inside the cabinet. */
  journey: number
  /** Seconds per pack (the sim's pace). */
  slot: number
}

export function flightTimes(secondsPerItem: number = SECONDS_PER_ITEM): FlightTimes {
  const slot = Math.max(1e-3, secondsPerItem)
  return { lead: FLIGHT.leadFrac * slot, journey: FLIGHT.journeyFrac * slot, slot }
}

/** Time at which pack `k` (0-based) is inside the cabinet. */
export function landTime(k: number, secondsPerItem: number = SECONDS_PER_ITEM): number {
  const f = flightTimes(secondsPerItem)
  return f.lead + k * f.slot + f.journey
}

/** How many of a delivery's `n` packs are in the cabinet `t` seconds after the pod docked. */
export function packsLanded(n: number, t: number, secondsPerItem: number = SECONDS_PER_ITEM): number {
  const first = landTime(0, secondsPerItem)
  if (t < first) return 0
  return Math.min(n, Math.floor((t - first) / flightTimes(secondsPerItem).slot + 1e-9) + 1)
}

/** When the sim loads the drawer: every item takes one slot. */
export function simDeliverySeconds(n: number, secondsPerItem: number = SECONDS_PER_ITEM): number {
  return n * secondsPerItem
}

export interface FlightGeom {
  /** The pod's hatch (`funnelTo`), chute-local lateral and outward metres. */
  dropX: number
  dropZ: number
  /** Height of the funnel's hinge, and the cabinet top. */
  pivotY: number
  bottomY: number
}

export interface PackPose {
  visible: boolean
  /** Which pack of the order (index into `order.items`). */
  index: number
  /** Chute-local: lateral, height (of the pack's centre), outward. */
  x: number
  y: number
  z: number
}

export function makePose(): PackPose {
  return { visible: false, index: 0, x: 0, y: 0, z: 0 }
}

const TAN_TILT = Math.tan(FUNNEL.deployTilt)

/** Height of the pack's centre when it lies on the deployed tray at `outward` metres from the tube axis. */
function onTray(g: FlightGeom, outward: number): number {
  return g.pivotY + outward * TAN_TILT + PACK.y / 2
}

/** The pose of the pack of a delivery of `n` packs at `t` seconds after docking. `visible` is false while a pack is inside the pod or the cabinet. */
export function packPose(n: number, t: number, g: FlightGeom, out: PackPose, secondsPerItem: number = SECONDS_PER_ITEM): PackPose {
  out.visible = false
  const { lead, journey, slot } = flightTimes(secondsPerItem)
  const rel = t - lead
  if (rel < 0) return out
  const k = Math.floor(rel / slot)
  if (k >= n) return out
  const u = rel - k * slot
  if (u >= journey) return out
  const f = u / journey
  out.visible = true
  out.index = k
  if (f < FLIGHT.hatchFrac) {
    // out of the pod's bottom hatch onto the tray
    const a = f / FLIGHT.hatchFrac
    const y0 = ROBOT.podBottomY + PACK.y / 2 + 0.02
    const y1 = onTray(g, g.dropZ)
    out.x = g.dropX
    out.z = g.dropZ
    out.y = y0 + (y1 - y0) * a * a
  } else if (f < FLIGHT.hatchFrac + FLIGHT.slideFrac) {
    // down the tray to the tube's mouth, speeding up
    const b = (f - FLIGHT.hatchFrac) / FLIGHT.slideFrac
    const s = b * b
    out.x = g.dropX * (1 - b)
    out.z = g.dropZ * (1 - s)
    out.y = onTray(g, out.z)
  } else {
    // falling down the chute, into the cabinet
    const c = (f - FLIGHT.hatchFrac - FLIGHT.slideFrac) / (1 - FLIGHT.hatchFrac - FLIGHT.slideFrac)
    const yTop = onTray(g, 0)
    const yEnd = g.bottomY - FLIGHT.sink
    out.x = 0
    out.z = 0
    out.y = yTop + (yEnd - yTop) * c * c
  }
  return out
}

export function flightGeom(l: ChuteLayout): FlightGeom {
  return { dropX: l.dropX, dropZ: l.dropZ, pivotY: l.pivotY, bottomY: l.bottomY }
}
