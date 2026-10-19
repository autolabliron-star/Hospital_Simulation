/**
 * W4 lab internals (agent L): one tube inside the lab and the host interface the lab's parts share. Not part of the frozen port (ports.ts).
 */
import type { CONFIG } from '../config'
import type { Rng } from '../rng'
import type { SampleBook } from '../samples'
import type { LabOrder, LabState, Sample, SampleStage } from '../types'

/** A tube on its way through the lab. The sample is the render-facing record; the rest is the lab's own bookkeeping. */
export interface Job {
  readonly sample: Sample
  readonly order: LabOrder
  /** Module ids still to visit in lane order, ending with 'archive'. 'cfg' is a placeholder resolved when the tube leaves the camera (cfg0 / cfg1). */
  readonly route: string[]
  /** Index of the next module in `route`. */
  step: number
  /** The lane position (metres) of the next module's stop. */
  stopS: number
  /** Where it will (re-)enter the lane (the stop of the module it just left, or 0 from the sorter). */
  exitS: number
  /** The sample's `where.s` at the start of the current step (for the render interpolation). */
  prevS: number
  /** When it entered the module it is in (or the receive station). */
  since: number
}

export type LabConfig = typeof CONFIG.lab

/** What the lab's parts (pneumatic line, lane, modules, desk) need from the lab. */
export interface LabHost {
  readonly cfg: LabConfig
  readonly state: LabState
  readonly samples: SampleBook
  /** The flow stream: durations and chances (never touched by a value). */
  readonly rng: Rng
  dirty(): void
  /** Move the sample on to `stage` (stages only move forward). */
  setStage(job: Job, stage: SampleStage, t: number): void
  /** Put the sample inside a module (or the receive station) at lane position `s`. */
  placeInModule(job: Job, moduleId: string, s: number): void
  /** Put the sample on the lane at `s`. */
  placeOnLane(job: Job, s: number): void
  /** Debug hook for the tests: a tube entered a module. */
  traceVisit(job: Job, moduleId: string, t: number): void
}

/** Stage a sample is in while it is inside this module (the camera leaves the stage 'onTrack'). */
export const MODULE_STAGE: Readonly<Record<string, SampleStage | undefined>> = {
  camera: undefined,
  cfg0: 'centrifuge',
  cfg1: 'centrifuge',
  decap: 'decap',
  haem: 'analysing',
  chem: 'analysing',
  immuno: 'analysing',
  coag: 'analysing',
  recap: 'recap',
  archive: undefined,
}
