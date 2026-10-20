/**
 * R3 "Real screens": the messages between the main thread and the imaging worker. The main thread asks for a picture (a JOB) for a SLOT (one
 * screen: the ultrasound monitor, a CT console, a draw robot's inset); the worker keeps only the newest job per slot, renders, and answers with
 * a FRAME: an ImageBitmap it hands over (or raw RGBA where a worker cannot make bitmaps) plus a little metadata (what the picture shows, how
 * long it took). Plain data only, so the same jobs run through the inline backend in node tests.
 */
import type { BodyPart, ImagingModality } from '@/sim/types'
import type { ProbeFrame } from '../phantom/usViews'
import type { SeqLike } from '../render/spec'

/** An ultrasound frame: the probe's frame on the patient (LPS mm), depth, time (breathing), frame number (noise). */
export interface UsJob {
  t: 'us'
  slot: string
  id: number
  /** The exam's image seed (the patient). */
  seed: number
  frame: ProbeFrame
  depth: number
  time: number
  n: number
  /** The lighter preset (monitors in other rooms, 1 Hz). */
  lite: boolean
  /** Output size (px, square). */
  size: number
}

/** A CT or MR slice, an X-ray view or a CT topogram: slice `k` of a sequence of an exam. */
export interface SliceJob {
  t: 'slice'
  slot: string
  id: number
  /** Which picture this is (the screen matches the answer to what it asked for). */
  key: string
  seed: number
  modality: ImagingModality
  bodyPart: BodyPart
  seq: SeqLike
  k: number
  size: number
}

export type Job = UsJob | SliceJob

/** Shares of the fan taken by the organs a test or the debug hook asks about. */
export interface FrameMeta {
  kidney: number
  liver: number
  gallbladder: number
  spleen: number
  bladder: number
  /** Worker milliseconds spent on the frame. */
  ms: number
}

export interface FrameOut {
  t: 'frame'
  slot: string
  id: number
  /** The slice job's key (empty for ultrasound). */
  key: string
  w: number
  h: number
  meta: FrameMeta
  bitmap?: ImageBitmap
  rgba?: ArrayBuffer
}

/** Jobs are served in this order when several slots wait (live probes first). */
export const SLOT_PRIORITY: Record<string, number> = { us: 0, draw0: 1, draw1: 1, draw2: 1, ct: 2, mri: 2, xray: 2, 'ct:next': 3, 'mri:next': 3, 'xray:next': 3, thumb: 5 }
