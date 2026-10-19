/**
 * W4 lab: where and how each tube of blood is drawn, as a pure function of the sim's `Sample` (no three.js; nothing allocated per call). The rig
 * (rig.ts) asks `lookOf` for every render slot every frame and writes the answer into its instanced pools.
 *
 *   pneumatic  the tube flies along its source's path at the sim's `sDraw` (src/sim/pneumaticPath.ts), cap end leading, a little larger than
 *              life so the eye can follow it in the clear pipe. It flies exactly while `LabState.pneumatic.inFlight` is its id: queued at its riser
 *              (`s` 0) it is still in the robot (not drawn), and landed (`s` the path length) it sits in the receive hood;
 *   track      a tube in a puck on the belt at `labTrackPointInto(sDraw)` (src/sim/labTrack.ts);
 *   module     in the receive station's hopper (module 'receive'): upright on the hood floor, up to four; in a centrifuge: in its own bucket of the rotor, turned by the rotor's angle and swung out as it speeds up; in any other module: in
 *              its puck at the module's stop on the track;
 *   none, tray hidden (the draw centre draws the tray).
 *
 * The look follows the stage: whole blood is dark red and turns amber serum after the centrifuge (EDTA tubes never spin, so they stay red); the cap
 * lifts away at the decapper, is gone while the analysers sample, comes back white from the recapper on.
 */
import { pathPointInto, PNEUMATIC_PATHS } from '@/sim/pneumaticPath'
import { labTrackPointInto, LAB_STOPS } from '@/sim/labTrack'
import type { Sample, SampleStage, TubeKind } from '@/sim/types'
import { centrifuge, RECEIVE, RECEIVE_HOOD, TUBE, TUBE_BASE_Y } from './labDims'
import { bucketOffset, bucketSwing, BucketTable, ease, quatUpTo, type Quat } from './motion'

export const STAGE_RANK: Readonly<Record<SampleStage, number>> = {
  ordered: 0,
  labelled: 1,
  drawn: 2,
  inTube: 3,
  received: 4,
  onTrack: 5,
  centrifuge: 6,
  decap: 7,
  analysing: 8,
  recap: 9,
  archived: 10,
}
const RANK_DECAP = STAGE_RANK.decap
const RANK_ANALYSING = STAGE_RANK.analysing
const RANK_RECAP = STAGE_RANK.recap

/** The tube kinds in the order of the cap colours table (the rig builds one Color per entry, and a white one at `CAP_WHITE`). */
export const TUBE_KINDS: readonly TubeKind[] = ['citrate', 'serum', 'heparin', 'EDTA', 'fluoride']
export const CAP_WHITE = TUBE_KINDS.length
const TUBE_INDEX: Readonly<Record<TubeKind, number>> = { citrate: 0, serum: 1, heparin: 2, EDTA: 3, fluoride: 4 }
/** Whole blood tubes that are spun in the centrifuge (EDTA, for the blood count, never is). */
const SPUNS: Readonly<Record<TubeKind, boolean>> = { citrate: true, serum: true, heparin: true, EDTA: false, fluoride: true }

/** Fluid colour indexes: whole blood, serum or plasma, and the same two haemolysed (pinker). */
export const FLUID = { blood: 0, serum: 1, bloodHaemolysed: 2, serumHaemolysed: 3 } as const

/** A tube in flight is drawn this much larger than life. */
export const FLIGHT_SCALE = 1.8
/** How long a tube takes to settle into its centrifuge bucket from the track stop (seconds). */
export const LOAD_SECONDS = 0.9

export interface SampleLook {
  show: boolean
  mode: 'none' | 'flight' | 'track' | 'bucket' | 'hopper'
  /** In the air: the sim's `inFlight` tube (it gets a glow trail and the launch and arrival rings). */
  airborne: boolean
  /** A puck under the tube (on the belt or at a module's stop), and a STAT one (orange). */
  puck: boolean
  stat: boolean
  /** The tube's bottom centre, its axis (unit) and its orientation. */
  x: number
  y: number
  z: number
  ux: number
  uy: number
  uz: number
  q: Quat
  scale: number
  fluid: number
  /** Cap colour index (a tube kind's cap, or `CAP_WHITE`), whether the cap is on view, and how far it is lifted off along the tube's axis (m). */
  cap: number
  capShow: boolean
  capLift: number
}

export function newLook(): SampleLook {
  return { show: false, mode: 'none', airborne: false, puck: false, stat: false, x: 0, y: 0, z: 0, ux: 0, uy: 1, uz: 0, q: { x: 0, y: 0, z: 0, w: 1 }, scale: 1, fluid: 0, cap: 0, capShow: true, capLift: 0 }
}

export interface LookCtx {
  /** Sim seconds (for the settle into a bucket). */
  simT: number
  /** The rotors' drawn angles and speeds (0..1), by centrifuge index. */
  rotorAngle: ArrayLike<number>
  rpm: ArrayLike<number>
  /** Bucket assignments: centrifuge 0, centrifuge 1, then the receive hopper (index 2). */
  buckets: BucketTable
  /** The id of the tube flying in the pipe right now (`LabState.pneumatic.inFlight`). */
  inFlight: string | null
}

/** The stops' world positions on the outbound lane, by module id, computed once. */
const STOP_XZ = new Map<string, { x: number; z: number }>(Object.entries(LAB_STOPS).map(([id, s]) => [id, labTrackPointInto(s, { x: 0, z: 0 })]))
const ROTORS = [centrifuge(0).rotor, centrifuge(1).rotor] as const
/** The bucket table's index of the receive hopper (after the two centrifuges). */
export const HOPPER = 2
export const STOP_OF = (id: string): { x: number; z: number } | undefined => STOP_XZ.get(id)

const _a = { x: 0, y: 0, z: 0 }
const _b = { x: 0, y: 0, z: 0 }
const _v = { x: 0, z: 0 }
const _o = { x: 0, z: 0 }

/** Stand a tube upright on the hood floor of the receive station, on a small ring so up to four stand apart. False when the hopper is full. */
function placeInHopper(s: Sample, ctx: LookCtx, out: SampleLook): boolean {
  const k = ctx.buckets.assign(HOPPER, s.id)
  if (k < 0 || k >= RECEIVE_HOOD.slots) return false
  const a = (k * Math.PI * 2) / RECEIVE_HOOD.slots
  out.x = RECEIVE_HOOD.x + Math.cos(a) * RECEIVE_HOOD.ring
  out.y = RECEIVE.h + 0.012
  out.z = RECEIVE_HOOD.z + Math.sin(a) * RECEIVE_HOOD.ring
  out.ux = 0
  out.uy = 1
  out.uz = 0
  out.scale = 1
  out.puck = false
  out.mode = 'hopper'
  return true
}

export function lookOf(s: Sample, ctx: LookCtx, out: SampleLook): SampleLook {
  out.show = false
  out.mode = 'none'
  out.airborne = false
  const w = s.where
  const rank = STAGE_RANK[s.stage]
  out.stat = s.priority === 'stat'
  out.scale = 1
  out.puck = false
  out.capLift = 0
  switch (w.line) {
    case 'pneumatic': {
      const path = PNEUMATIC_PATHS[w.source]
      if (!path) return out
      out.airborne = ctx.inFlight === s.id
      if (!out.airborne) {
        // queued at its riser (`s` 0): still inside the robot's cabinet, nothing to draw; landed (`s` the path length): standing in the hood
        if (w.sDraw < 0.5 || !placeInHopper(s, ctx, out)) return out
        break
      }
      pathPointInto(w.source, w.sDraw, _a)
      pathPointInto(w.source, w.sDraw + 0.05, _b)
      let dx = _b.x - _a.x
      let dy = _b.y - _a.y
      let dz = _b.z - _a.z
      let len = Math.hypot(dx, dy, dz)
      if (len < 1e-6) {
        // at the very end of the path (clamped): keep the last leg's direction
        pathPointInto(w.source, w.sDraw - 0.05, _b)
        dx = _a.x - _b.x
        dy = _a.y - _b.y
        dz = _a.z - _b.z
        len = Math.hypot(dx, dy, dz)
        if (len < 1e-6) {
          dx = 0
          dy = w.sDraw > 0.5 ? -1 : 1
          dz = 0
          len = 1
        }
      }
      out.ux = dx / len
      out.uy = dy / len
      out.uz = dz / len
      out.scale = FLIGHT_SCALE
      const half = (TUBE.h * FLIGHT_SCALE) / 2
      out.x = _a.x - out.ux * half
      out.y = _a.y - out.uy * half
      out.z = _a.z - out.uz * half
      out.mode = 'flight'
      break
    }
    case 'track': {
      labTrackPointInto(w.sDraw, _v)
      out.x = _v.x
      out.y = TUBE_BASE_Y
      out.z = _v.z
      out.ux = 0
      out.uy = 1
      out.uz = 0
      out.puck = true
      out.mode = 'track'
      break
    }
    case 'module': {
      const id = w.module
      if (id === null) return out
      if (id === 'receive') {
        // in the receive station, waiting for the sorter
        if (!placeInHopper(s, ctx, out)) return out
        break
      }
      if (id.startsWith('cfg')) {
        const c = id === 'cfg1' ? 1 : 0
        const k = ctx.buckets.assign(c, s.id)
        const rotor = ROTORS[c]
        if (k >= 0) {
          bucketOffset(k, rotor.buckets, rotor.bucketR, ctx.rotorAngle[c], _o)
          const swing = bucketSwing(ctx.rpm[c])
          const r = Math.hypot(_o.x, _o.z) || 1
          const sin = Math.sin(swing)
          out.ux = (_o.x / r) * sin
          out.uy = Math.cos(swing)
          out.uz = (_o.z / r) * sin
          let x = rotor.x + _o.x
          let y = rotor.top
          let z = rotor.z + _o.z
          // loading: from its puck at the stop into the bucket
          const stop = STOP_XZ.get(id)
          const since = ctx.simT - (s.stageAt.centrifuge ?? Number.NEGATIVE_INFINITY)
          if (stop && since < LOAD_SECONDS) {
            const t = ease(since / LOAD_SECONDS)
            x = stop.x + (x - stop.x) * t
            y = TUBE_BASE_Y + (y - TUBE_BASE_Y) * t
            z = stop.z + (z - stop.z) * t
          }
          out.x = x
          out.y = y
          out.z = z
          out.mode = 'bucket'
          break
        }
      }
      const stop = STOP_XZ.get(id)
      if (!stop) return out
      out.x = stop.x
      out.y = TUBE_BASE_Y
      out.z = stop.z
      out.ux = 0
      out.uy = 1
      out.uz = 0
      out.puck = true
      out.mode = 'track'
      break
    }
    default:
      return out
  }
  quatUpTo(out.ux, out.uy, out.uz, out.q)
  // what the tube holds, and its cap
  const spun = SPUNS[s.tube] && rank >= RANK_DECAP
  out.fluid = (spun ? FLUID.serum : FLUID.blood) + (s.qc === 'haemolysed' ? 2 : 0)
  out.cap = rank >= RANK_RECAP ? CAP_WHITE : TUBE_INDEX[s.tube]
  out.capShow = rank < RANK_ANALYSING || rank >= RANK_RECAP
  if (rank === RANK_DECAP) out.capLift = 0.04
  out.show = true
  return out
}

/** The bottom of a tube's cap (it sits on the tube's open end, `capLift` further along the axis). */
export function capBase(look: SampleLook, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const d = TUBE.h * look.scale + look.capLift
  out.x = look.x + look.ux * d
  out.y = look.y + look.uy * d
  out.z = look.z + look.uz * d
  return out
}
