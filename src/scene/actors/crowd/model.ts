// Ported from Waltz City (src/scene/actors/crowd/model.ts): the slot/row bookkeeping, measured motion, fade in and out, LOD lists and rims. New: sit/lie levels, held
// items, wheeled vehicles and their riders, blob shadows, capsule picking, and nothing that allocates in a frame.
// W3: the slot of the entity `player` is driven by the player's true body (`FrameInput.driven`, the contract `walkBody`) instead of a measured velocity, and its heel strikes
// are published in `walkStride` (footsteps, camera bob). Everybody else is measured exactly as before.
// W3 wave B (realistic people, ported from Waltz's wave 10b model): once `setAvatars` hands in the loaded Rocketbox avatars, every person wears one
// (avatars.ts avatarFor: the player medical_male_01, everybody else by role, clothing class, height and seed). Their rig then uses the avatar's own
// skeleton, their skinned part matrices become M_p * B_p^-1 (applyBinds), their garment tint bits go into TEX.size.z, they are always solved (the
// far body of an avatar is skinned too) and they go into per-avatar instance lists instead of the procedural ones. The player's "You" badge rides
// the BADGE_FRAME slot. Until then, or if the assets never load, everybody keeps the procedural body exactly as before.
// R2: a realistic person in theatre scrubs (hair style `theatreCap`) wears the crowd's surgical cap: its frame rides the CAP_FRAME slot (the head, binds
// applied, moved and scaled onto the avatar's skull: avatars.ts CapFit) and the cap mesh draws the rows in `capRows`.
/**
 * The crowd model: every person that is drawn, their state and the pose texture data, with no GL in it.
 *
 * Each frame `update` walks the sim's entities, keeps one `PersonSlot` per person, estimates real motion from how far they
 * actually moved, runs the rig solver and writes the person's row of the pose texture. It decides which of the three bodies (high,
 * mid, far) each person is drawn with, which of them holds a prop or pushes a vehicle, and builds the instance lists of every draw.
 *
 * Nobody pops: a new person fades in over 0.35 s, a person the sim removes keeps standing where they were and fades out, and the
 * sim's own `fade` (0..1) multiplies in on top. Rows of the texture are allocated once per person and stay stable.
 *
 * R2 levels (docs/R2-SURGERY.md): the sim is flat and level 2 lives in its own strip of it (sim x = drawn x + 150, y floor-relative). `visit` is the ONE
 * place an entity's sim position becomes a drawn one (`levelDx`, `LEVEL_Y`): the slot's x, y, z, the pose row's root, the LOD distance, the blob, the pick
 * capsule, the look-at target and the player's driven rest pose are all drawn coordinates from there on. Anybody the screen does not show (`shownAt`: the
 * other level, or a level-1 person under the slab in the overview's Level 2) stays tracked but is not drawn, solved or pickable (presence 0).
 *
 * Riders: a person with `riding` set sits or lies on the vehicle of the person pushing it. Only the pusher's slot draws the vehicle;
 * the rider is drawn ON the vehicle, snapped to the vehicle's place in front of the pusher, so the two can never drift apart. A
 * rider with no pusher nearby (a parked wheelchair) draws its own vehicle under itself.
 */
import { presentationOf, type Presentation } from '@/content/roster'
import { LEVEL_Y, levelDx, levelOf, type LevelId } from '@/sim/levels'
import type { Entity, Outfit, PropKind, Role, VehicleKind } from '@/sim/types'
import { shownAt } from '@/scene/levels/levelView'
import { BADGE_FRAME, CAP_FRAME, MAX_PEOPLE, NOMINAL_BODY, P, PROP, RIM_COLORS, ROW_FLOATS, SEATED_HEAD_CENTRE, STAND_HEAD_CENTRE, TEX, VEHICLE, VEHICLE_AHEAD, BODY } from './constants'
import { inBlanketBed, levelsOf, type Levels } from './head'
import { AVATAR_LOD, LOD, lodBounds, lodWeights, type LodWeights } from './lod'
import { clamp, damp } from './math'
import { modeFor, type Mode, type Posture } from './blend'
import { clothesOf, lookFor, type Look } from './outfit'
import { BADGE, GEAR_BIT } from './staff'
import { applyBinds, avatarBuild, avatarFor, defaultCapFit, type AvatarChoice, type AvatarEntry, type CapFit } from './avatars'
import { aimHead, createRig, makeInput, solveRig, type PersonRig, type RigInput } from './rig'
import { pickRadius, rayVsSegment } from './picking'
import { VEHICLE_FOOTPRINT } from './gear'
import { reclineAngle, reclineOfEntity } from '@/scene/rooms/bedPose'
import { walkStride } from '@/scene/player/state'

export const FADE_SECONDS = 0.35

/**
 * S1: how much faster than real time the legs may cycle at the sim's 10x and 30x speeds (see `FrameInput.timeScale`). People are measured in SIM
 * metres per SIM second, so a stroll still picks the walk gait; the feet step `min(speed, GAIT_RATE_MAX)` times faster than real time and the body
 * outruns them (they slide), which looks busy but not absurd.
 */
export const GAIT_RATE_MAX = 4
const RIM_SECONDS = 0.15
/** Instances the gear draws can hold. */
export const MAX_VEHICLES = 96
export const MAX_PROPS = MAX_PEOPLE
/** "You" badges the badge mesh can hold (there is one player). */
export const MAX_BADGES = 4
/** R2: theatre caps the cap mesh can hold (the theatre team is 9, and you). */
export const MAX_CAPS = 24
/** Blankets the blanket mesh can hold: one per patient lying in a ward bed, an ER trolley or on a stretcher. */
export const MAX_BLANKETS = 64
/** One blob for each person and each vehicle. */
export const MAX_BLOBS = MAX_PEOPLE + MAX_VEHICLES
/** A rider within this distance of the place a vehicle would be is the one on it. */
const RIDER_SNAP = 1.7
/** Height of the footplate of a wheelchair (the rider's feet rest on it). */
const FOOT_REST = 0.178
/** How fast a patient's torso follows the bed head being raised or lowered (per second): the bed layer already smooths, this only catches a step. */
const RECLINE_RATE = 10
/** Blob shadow: a person's footprint and how dark it is. */
const BLOB_PERSON = 0.95
const BLOB_ALPHA = 0.9
const BLOB_LIFT = 0.03

const PROP_OF: Record<PropKind, number> = { none: PROP.none, tablet: PROP.tablet, folder: PROP.folder, tray: PROP.tray, coffee: PROP.cup, bag: PROP.bag, flowers: PROP.flowers }
const VEHICLE_OF: Record<VehicleKind, number> = { none: VEHICLE.none, wheelchair: VEHICLE.wheelchair, stretcher: VEHICLE.stretcher, cleaningCart: VEHICLE.cleaningCart, linenCart: VEHICLE.linenCart }

export interface PersonSlot {
  key: string
  row: number
  look: Look
  /** What the look was made from (role and outfit class): it is rebuilt when a patient is admitted and changes into a gown. */
  lookRole: Role
  lookOutfit: Outfit | undefined
  rig: PersonRig
  /** W3 wave B: the avatar the person wears (index into the model's avatars, -1: the procedural body) and its tint bits (avatars.ts TINT). */
  avatar: number
  tint: number
  /** How the person's given name reads (content/roster.ts presentationOf): a woman's body, a man's, or the seeded draw. Fixed for the person's life. */
  presentation: Presentation
  entity: Entity | null
  /** R2: the level the person is on (sim x), and where they stand in the SIM (x, z) as of the last frame the entity was seen. */
  level: LevelId
  simX: number
  simZ: number
  /** R2: the screen shows this person's level (levelView.ts `shownAt`). A person it does not show is tracked but not drawn. */
  shown: boolean
  seen: number
  /** Fade-in ramp 0..1 (and the fade-out of a person the sim removed). */
  ramp: number
  /** The sim's own fade, 0..1. */
  simFade: number
  /** ramp * simFade: what the dither shows. */
  presence: number
  ghost: boolean
  hasPrev: boolean
  px: number
  pz: number
  vx: number
  vz: number
  speed: number
  /**
   * S1: where the gait is planned relative to where the person is drawn. Above `GAIT_RATE_MAX` times real time the body outruns its feet; the planner is
   * given a position that moves only `GAIT_RATE_MAX / timeScale` as far (actual minus this offset), and the feet are drawn back at the person. 0 at 1x to 4x.
   */
  gox: number
  goz: number
  // last state, for picking, rings and ghosts: DRAWN coordinates (the level mapping is applied in `visit`)
  x: number
  y: number
  z: number
  heading: number
  dist: number
  rim: number
  rimKind: 0 | 1 | 2 | 3
  mode: Mode
  posture: Posture
  seatHeight: number
  /** L1: how far the bed head is raised under this person (0..1), smoothed; drives the torso of the 'lie' pose. */
  recline: number
  prop: number
  // vehicles
  /** The vehicle this slot draws (VEHICLE value; 0 = none) and how far in front of its root. */
  vKind: number
  vOff: number
  /** The vehicle kind of a rider / pusher (VEHICLE value) and the partner. */
  rideKind: number
  rider: PersonSlot | null
  pusher: PersonSlot | null
  // capsule for picking
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
}

/**
 * The part of `walkBody` (src/scene/player/state.ts) the crowd reads: the player's body as the player system moved it this frame. A structural type, so
 * `walkBody` itself is passed in (crowdRig.ts) and the model never imports it. Only the slot of the entity `player` is driven by it.
 */
export interface DrivenBody {
  /** The player system has written at least once. */
  live: boolean
  x: number
  z: number
  /** The velocity actually achieved this frame, and what the keys ask for. */
  vx: number
  vz: number
  wishX: number
  wishZ: number
  /** The speed spring's acceleration, the heading rate (+ = a turn to the left), whether the body is coasting to a stop and where it will rest. */
  ax: number
  az: number
  turnRate: number
  stopping: boolean
  restX: number
  restZ: number
}

/** The driven body counts as the entity's own only while it is where the entity is (a Jump or a switch of mode leaves it stale for a frame). */
const DRIVEN_NEAR = 0.5
/** The entity of the player. */
const PLAYER_ID = 'player'

export interface FrameInput {
  dt: number
  time: number
  /** The camera as DRAWN (three.js coordinates: level 2 is up at 4.2 m over the west block), which is what every slot's x, y, z is too. */
  camX: number
  camY: number
  camZ: number
  entities: ReadonlyMap<string, Entity>
  followId: string | null
  selectedId: string | null
  hoverId: string | null
  /** W3: the player's body (see `DrivenBody`, in SIM coordinates), or null/absent: the player is then measured like everybody else. */
  driven?: DrivenBody | null
  /**
   * S1: the sim speed (1, 2, 4, 10, 30; absent = 1). People move this many sim seconds per real second, so a person's ground speed is measured in sim
   * units (metres per sim second) and the gait cycle runs at `min(timeScale, GAIT_RATE_MAX)` times real time. At 1 nothing changes.
   */
  timeScale?: number
}

export interface CrowdStats {
  people: number
  high: number
  mid: number
  far: number
  solved: number
  ghosts: number
  props: number
  vehicles: number
  blobs: number
  riders: number
  /** Entities that did not fit in the pose texture (should be 0). */
  overflow: number
  /** W3 wave B: people drawn as realistic avatars, and their entries in the per-avatar near, mid and far lists. */
  avatars: number
  avatarHigh: number
  avatarMid: number
  avatarFar: number
  /** "You" badges drawn on realistic coats (the player's: 0 or 1). */
  badges: number
  /** R2: theatre caps drawn on realistic people in theatre scrubs. */
  caps: number
  /** Blankets drawn over patients lying in a bed or on a stretcher. */
  blankets: number
}

/** W3 wave B: per-avatar instance lists (rows of the pose texture): rows[lod][avatar] holds counts[lod][avatar] rows (lod 0 near, 1 mid, 2 far). */
export interface AvatarLists {
  rows: [Float32Array[], Float32Array[], Float32Array[]]
  counts: [Int32Array, Int32Array, Int32Array]
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const linearCache = new Map<string, [number, number, number]>()
export function hexToLinear(hex: string): [number, number, number] {
  let v = linearCache.get(hex)
  if (!v) {
    const n = parseInt(hex.slice(1), 16)
    v = [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)]
    linearCache.set(hex, v)
  }
  return v
}

const RIM_KIND_COLOR = [RIM_COLORS.hovered, RIM_COLORS.hovered, RIM_COLORS.selected, RIM_COLORS.followed] as const
const RIM_KIND_STRENGTH = [0, 0.5, 0.9, 1.0] as const

const rowsHigh = () => new Float32Array(MAX_PEOPLE)

export class CrowdModel {
  /** The pose texture's pixels: MAX_PEOPLE rows of ROW_FLOATS floats. */
  readonly data = new Float32Array(MAX_PEOPLE * ROW_FLOATS)
  readonly people = new Map<string, PersonSlot>()
  readonly rowsHigh = rowsHigh()
  readonly rowsMid = rowsHigh()
  readonly rowsFar = rowsHigh()
  /** Props draw: carrier row and kind per instance. */
  readonly propRows = new Float32Array(MAX_PROPS)
  readonly propKinds = new Float32Array(MAX_PROPS)
  /** Vehicles draw: pusher (or parked rider) row, kind, and metres in front of that row's root. */
  readonly vehRows = new Float32Array(MAX_VEHICLES)
  readonly vehKinds = new Float32Array(MAX_VEHICLES)
  readonly vehOffs = new Float32Array(MAX_VEHICLES)
  /** Blob shadows: a 4x4 matrix and a fade per instance (written straight into the InstancedMesh's attributes). */
  readonly blobMatrix = new Float32Array(MAX_BLOBS * 16)
  readonly blobFade = new Float32Array(MAX_BLOBS)
  readonly stats: CrowdStats = { people: 0, high: 0, mid: 0, far: 0, solved: 0, ghosts: 0, props: 0, vehicles: 0, blobs: 0, riders: 0, overflow: 0, avatars: 0, avatarHigh: 0, avatarMid: 0, avatarFar: 0, badges: 0, caps: 0, blankets: 0 }
  /** Blankets draw: the row of each covered lying patient (the blanket is in its prop frame), and the kind (always PROP.blanket). */
  readonly blanketRows = new Float32Array(MAX_BLANKETS)
  readonly blanketKinds = new Float32Array(MAX_BLANKETS).fill(PROP.blanket)
  /** W3 wave B: the rows of the people whose "You" badge the badge mesh draws (BADGE_FRAME of their row). */
  readonly badgeRows = new Float32Array(MAX_BADGES)
  /** R2: the rows of the realistic people in theatre scrubs whose cap the cap mesh draws (CAP_FRAME of their row). */
  readonly capRows = new Float32Array(MAX_CAPS)
  /** One set of lists per loaded avatar (empty until setAvatars). */
  readonly avatarLists: AvatarLists = { rows: [[], [], []], counts: [new Int32Array(0), new Int32Array(0), new Int32Array(0)] }
  frame = 0

  private avatarList: AvatarEntry[] = []
  private binds: Float64Array[] = []
  private caps: CapFit[] = []
  private readonly choice: AvatarChoice = { index: -1, tint: 0 }

  private readonly free: number[] = []
  private nextRow = 0
  private readonly inp: RigInput = makeInput()
  private readonly w: LodWeights = { high: 1, mid: 0, far: 0 }
  private readonly bounds: [number, number, number] = [0, 0, 0]
  private readonly lv: Levels = { posture: 'stand', floorY: 0, surface: 0 }
  private readonly pushers: PersonSlot[] = []
  private readonly riders: PersonSlot[] = []
  private nPushers = 0
  private nRiders = 0
  // the frame being processed (so the per-entity and per-slot callbacks can be allocated once)
  private cur: FrameInput = { dt: 0, time: 0, camX: 0, camY: 0, camZ: 0, entities: new Map(), followId: null, selectedId: null, hoverId: null }
  private dt = 0
  /** S1: the sim speed of this frame (>= 1), and the rate the gait cycle runs at (min(speed, GAIT_RATE_MAX)). */
  private scale = 1
  private gait = 1
  private warm = false
  /** Seconds between two of your heel strikes at the moment (see `publishStride`). */
  private stridePeriod = 0.45
  private readonly visitFn = (e: Entity): void => this.visit(e)
  private readonly tickFn = (p: PersonSlot): void => this.tick(p)

  /** Slot of a person by entity id. */
  get(key: string): PersonSlot | undefined {
    return this.people.get(key)
  }

  private allocRow(): number {
    if (this.free.length) return this.free.pop()!
    return this.nextRow < MAX_PEOPLE ? this.nextRow++ : -1
  }

  private writeLook(row: number, look: Look): void {
    const o = row * ROW_FLOATS
    // palette, in slot order (constants.SLOT)
    const pal = [look.skin, look.hair, look.top, look.pants, look.shoes, look.front, look.accent, look.sleeve, look.lowerLeg, look.lanyard, look.upperLeg, look.glasses, look.coat, look.gear, look.badge]
    for (let i = 0; i < pal.length; i++) {
      const c = hexToLinear(pal[i])
      const b = o + (TEX.palette + i) * 4
      this.data[b] = c[0]
      this.data[b + 1] = c[1]
      this.data[b + 2] = c[2]
      this.data[b + 3] = 1
    }
    const s = o + TEX.size * 4
    this.data[s] = look.scale
    this.data[s + 1] = look.scale * (0.5 + 0.5 * look.build)
    // what the close-up body shows of this person's details: the badge, and the stethoscope, dosimeter, apron bib and glasses (staff.ts)
    const g = o + TEX.gear * 4
    this.data[g] = look.badgeKind
    this.data[g + 1] = (look.stethoscope ? GEAR_BIT.stethoscope : 0) | (look.dosimeter ? GEAR_BIT.dosimeter : 0) | (look.apron ? GEAR_BIT.bib : 0) | (look.glassesOn ? GEAR_BIT.glasses : 0)
  }

  /**
   * W3 wave B: hands in the loaded avatars (in the order the renderer's per-avatar meshes use), or an empty list to go back to the procedural
   * bodies. Everybody already drawn is re-dressed at once. R2: `caps` are the theatre caps measured on the avatars' meshes (avatars.ts measureCapFit), in
   * the same order; an avatar without one wears a cap over its skeleton's crown (defaultCapFit).
   */
  setAvatars(avatars: readonly AvatarEntry[], caps: readonly (CapFit | null)[] = []): void {
    this.avatarList = [...avatars]
    this.binds = this.avatarList.map((a) => Float64Array.from(a.bindInverse))
    this.caps = this.avatarList.map((a, i) => caps[i] ?? defaultCapFit(a.body, a.bindInverse.slice(P.head * 12, P.head * 12 + 12)))
    const L = this.avatarLists
    L.rows = [0, 1, 2].map(() => this.avatarList.map(() => new Float32Array(MAX_PEOPLE))) as AvatarLists['rows']
    L.counts = [0, 1, 2].map(() => new Int32Array(this.avatarList.length)) as AvatarLists['counts']
    for (const p of this.people.values()) this.dress(p)
  }

  /** The loaded avatars, in list order (empty: everybody is procedural). */
  get avatars(): readonly AvatarEntry[] {
    return this.avatarList
  }

  /** Chooses the person's avatar (or none) and writes what goes with it: the skeleton, the build, the tint bits and the bottom garment's colour. */
  private dress(p: PersonSlot): void {
    const look = p.look
    const c = this.avatarList.length ? avatarFor({ id: p.key, role: p.lookRole, outfit: p.lookOutfit, seed: look.seed, height: look.height, presentation: p.presentation }, this.avatarList, this.choice) : null
    p.avatar = c ? c.index : -1
    p.tint = c && c.index >= 0 ? c.tint : 0
    const d = p.rig.dims
    if (p.avatar >= 0) {
      d.b = this.avatarList[p.avatar].body
      d.w = avatarBuild(look.seed)
    } else {
      d.b = NOMINAL_BODY
      d.w = look.build
    }
    d.tl = 1 + (d.w - 1) * 0.6
    const o = p.row * ROW_FLOATS
    this.data[o + TEX.size * 4 + 2] = p.tint
    // the bottom garment's colour: a patient's gown is gown all over (the procedural body shows it on the coat piece; its trousers slot is unused)
    const pants = hexToLinear(p.avatar >= 0 && clothesOf(p.lookRole, p.lookOutfit) === 'gown' ? look.coat : look.pants)
    const b = o + (TEX.palette + 3) * 4
    this.data[b] = pants[0]
    this.data[b + 1] = pants[1]
    this.data[b + 2] = pants[2]
  }

  private create(e: Entity, warm: boolean): PersonSlot | null {
    const row = this.allocRow()
    if (row < 0) return null
    const o = row * ROW_FLOATS
    this.data.fill(0, o, o + ROW_FLOATS)
    const presentation = presentationOf(e.name)
    const look = lookFor({ id: e.id, role: e.role, outfit: e.outfit, variant: e.variant, presentation })
    this.writeLook(row, look)
    const slot: PersonSlot = {
      key: e.id,
      row,
      look,
      lookRole: e.role,
      lookOutfit: e.outfit,
      rig: createRig(look),
      avatar: -1,
      tint: 0,
      presentation,
      entity: null,
      level: levelOf(e.position.x),
      simX: e.position.x,
      simZ: e.position.z,
      shown: true,
      seen: 0,
      ramp: warm ? 1 : 0,
      simFade: 1,
      presence: 0,
      ghost: false,
      hasPrev: false,
      px: 0,
      pz: 0,
      vx: 0,
      vz: 0,
      speed: 0,
      gox: 0,
      goz: 0,
      x: e.position.x + levelDx(levelOf(e.position.x)),
      y: e.position.y + LEVEL_Y[levelOf(e.position.x)],
      z: e.position.z,
      heading: e.heading,
      dist: 0,
      rim: 0,
      rimKind: 1,
      mode: 'relaxed',
      posture: 'stand',
      seatHeight: 0,
      recline: 0,
      prop: PROP.none,
      vKind: 0,
      vOff: 0,
      rideKind: 0,
      rider: null,
      pusher: null,
      ax: 0,
      ay: 0,
      az: 0,
      bx: 0,
      by: 0,
      bz: 0,
    }
    this.people.set(e.id, slot)
    if (this.avatarList.length) this.dress(slot)
    return slot
  }

  private release(slot: PersonSlot): void {
    this.people.delete(slot.key)
    const o = slot.row * ROW_FLOATS
    this.data.fill(0, o, o + ROW_FLOATS)
    this.free.push(slot.row)
  }

  /** A person's role or clothing class changed (rare: a gown on admission, theatre scrubs on level 2): rebuild their look and re-dress them. */
  private redress(p: PersonSlot, e: Entity): void {
    p.lookRole = e.role
    p.lookOutfit = e.outfit
    p.look = lookFor({ id: e.id, role: e.role, outfit: e.outfit, variant: e.variant, presentation: p.presentation })
    p.rig.look = p.look
    this.writeLook(p.row, p.look)
    if (this.avatarList.length) this.dress(p)
  }

  /** Pass A, once per entity: find or make the slot, read where the body is. */
  private visit(e: Entity): void {
    let p = this.people.get(e.id)
    if (!p) {
      p = this.create(e, this.warm) ?? undefined
      if (!p) {
        this.stats.overflow++
        return
      }
    }
    p.entity = e
    p.ghost = false
    p.seen = this.frame
    p.rider = null
    p.pusher = null
    p.vKind = 0
    p.vOff = 0
    p.rideKind = 0
    // a patient who is admitted changes into a gown, you change into theatre scrubs in the lift: the clothes follow the role and outfit class
    if (e.role !== p.lookRole || e.outfit !== p.lookOutfit) this.redress(p, e)
    const lv = levelsOf(e, this.lv)
    p.posture = lv.posture
    p.seatHeight = lv.surface
    // R2: sim -> drawn, once (level 2 moves west by LEVEL2_DX and up by 4.2 m; `toDisplayInto` says the same, inlined to stay allocation-free)
    const level = levelOf(e.position.x)
    p.level = level
    p.simX = e.position.x
    p.simZ = e.position.z
    p.x = e.position.x + levelDx(level)
    p.z = e.position.z
    p.y = lv.floorY + LEVEL_Y[level]
    p.heading = e.heading
    const vk = e.vehicle ? VEHICLE_OF[e.vehicle] : VEHICLE.none
    if (vk !== VEHICLE.none) {
      p.rideKind = vk
      if (e.riding) this.riders[this.nRiders++] = p
      else this.pushers[this.nPushers++] = p
    }
  }

  /** Pass M: put each rider on the vehicle of the nearest pusher without one, or give it a parked vehicle of its own. */
  private matchRiders(): void {
    for (let i = 0; i < this.nPushers; i++) {
      const p = this.pushers[i]
      p.vKind = p.rideKind
      p.vOff = VEHICLE_AHEAD[p.rideKind]
    }
    for (let i = 0; i < this.nRiders; i++) {
      const r = this.riders[i]
      let best: PersonSlot | null = null
      let bestD = RIDER_SNAP * RIDER_SNAP
      for (let j = 0; j < this.nPushers; j++) {
        const p = this.pushers[j]
        // (the drawn plans of the two levels overlap: a pusher on the other level is never the one)
        if (p.rider || p.rideKind !== r.rideKind || p.level !== r.level) continue
        const ahead = VEHICLE_AHEAD[p.rideKind]
        const sx = p.x + Math.sin(p.heading) * ahead
        const sz = p.z + Math.cos(p.heading) * ahead
        const d = (sx - r.x) * (sx - r.x) + (sz - r.z) * (sz - r.z)
        if (d < bestD) {
          bestD = d
          best = p
        }
      }
      if (best) {
        best.rider = r
        r.pusher = best
        const ahead = VEHICLE_AHEAD[best.rideKind]
        // the rider is drawn on the vehicle: its place, the pusher's heading
        r.x = best.x + Math.sin(best.heading) * ahead
        r.z = best.z + Math.cos(best.heading) * ahead
        r.heading = best.heading
      } else {
        // a parked wheelchair or stretcher: it sits under its rider
        r.vKind = r.rideKind
        r.vOff = 0
      }
    }
  }

  update(f: FrameInput): void {
    this.frame++
    this.warm = this.frame <= 1
    this.dt = clamp(f.dt, 0, 0.1)
    const ts = f.timeScale
    this.scale = ts !== undefined && ts > 1 ? ts : 1
    this.gait = this.scale < GAIT_RATE_MAX ? this.scale : GAIT_RATE_MAX
    this.cur = f
    const st = this.stats
    st.people = 0
    st.high = 0
    st.mid = 0
    st.far = 0
    st.solved = 0
    st.ghosts = 0
    st.props = 0
    st.vehicles = 0
    st.blobs = 0
    st.riders = 0
    st.overflow = 0
    st.avatars = 0
    st.avatarHigh = 0
    st.avatarMid = 0
    st.avatarFar = 0
    st.badges = 0
    st.caps = 0
    st.blankets = 0
    const counts = this.avatarLists.counts
    for (let l = 0; l < 3; l++) counts[l].fill(0)
    this.nPushers = 0
    this.nRiders = 0
    f.entities.forEach(this.visitFn)
    this.matchRiders()
    this.people.forEach(this.tickFn)
  }

  /** Pass B, once per slot: motion, rig, texels and the instance lists. */
  private tick(p: PersonSlot): void {
    const f = this.cur
    const st = this.stats
    const frame = this.frame
    const dt = this.dt
    if (p.seen !== frame && !p.ghost) {
      // left the world (entity removed): stand where they were and fade out
      p.ghost = true
      p.entity = null
      p.rider = null
      p.pusher = null
    }
    const e = p.entity
    if (e) p.simFade = e.fade === undefined ? 1 : clamp(e.fade, 0, 1)
    const rampTarget = p.ghost ? 0 : 1
    p.ramp += clamp(rampTarget - p.ramp, -dt / FADE_SECONDS, dt / FADE_SECONDS)
    // R2: the screen shows one level (or the ground floor around level 2): everybody else is tracked but not drawn. It switches at once, with the building
    p.shown = shownAt(p.simX, p.simZ)
    p.presence = p.shown ? p.ramp * p.simFade : 0
    const o = p.row * ROW_FLOATS
    if (p.ghost && p.ramp <= 0.001) {
      this.release(p)
      return
    }
    const d = this.data
    if (p.presence <= 0.001) {
      // invisible for now (the sim has it at fade 0): keep tracking where it is, draw nothing. Your own legs go on: the footsteps and the camera bob
      // read them, and in first person your avatar is invisible
      d[o + TEX.lod * 4 + 2] = 0
      if (e) {
        if (p.key === PLAYER_ID && p.shown) this.legsOnly(p, e, f, dt, o)
        else this.trackMotion(p, dt)
      }
      // (out of sight on the other level: the feet are planted again where the person is when they come back into view)
      if (!p.shown) p.rig.planter.initialised = false
      return
    }
    st.people++
    if (p.ghost) st.ghosts++
    if (e && p.rideKind !== 0 && e.riding) st.riders++

    if (e) {
      const posture = p.posture
      this.fillInput(p, e, f, dt)
      const inp = this.inp
      const k = p.look.scale
      // distance first: the far figure needs no skeleton
      const cdx = p.x - f.camX
      const cdy = p.y + 1 - f.camY
      const cdz = p.z - f.camZ
      p.dist = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz)
      lodWeights(p.dist, this.w, p.avatar >= 0 ? AVATAR_LOD : LOD)
      // a realistic person's far body is skinned and animated too: they are always solved
      if (this.w.far < 1 || p.avatar >= 0) {
        aimHead(p.rig, dt, inp, this.headYOf(p, posture, k))
        solveRig(p.rig, inp, d, o + TEX.parts * 4)
        if (p.avatar >= 0) this.bindAvatar(p, o)
        if (p.key === PLAYER_ID) this.publishStride(p, dt)
        const face = p.rig.face
        const fo = o + TEX.face * 4
        d[fo] = face.eyeYaw
        d[fo + 1] = face.eyePitch
        d[fo + 2] = face.expression
        d[fo + 3] = face.blink
        d[o + TEX.gear * 4 + 3] = face.mouthOpen
        st.solved++
      } else {
        // far only: keep the feet planted under the body so nothing is stale when the camera comes in
        p.rig.planter.initialised = false
        p.rig.propDraw = PROP.none
      }
      this.capsule(p, posture, k)
    } else {
      const cdx = p.x - f.camX
      const cdy = p.y + 1 - f.camY
      const cdz = p.z - f.camZ
      p.dist = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz)
      lodWeights(p.dist, this.w, p.avatar >= 0 ? AVATAR_LOD : LOD)
    }

    const w = this.w
    lodBounds(w, p.presence, this.bounds)
    d[o] = p.x
    d[o + 1] = p.y
    d[o + 2] = p.z
    d[o + 3] = p.heading

    // emphasis: followed > selected > hovered
    let kind: 0 | 1 | 2 | 3 = 0
    let want = 0
    if (f.followId === p.key) {
      kind = 3
      want = RIM_KIND_STRENGTH[3]
    } else if (f.selectedId === p.key) {
      kind = 2
      want = RIM_KIND_STRENGTH[2]
    } else if (f.hoverId === p.key) {
      kind = 1
      want = RIM_KIND_STRENGTH[1]
    }
    if (want > 0) p.rimKind = kind
    p.rim = damp(p.rim, want, 1 / RIM_SECONDS, dt)
    if (p.rim < 0.003) p.rim = 0
    const rc = hexToLinear(RIM_KIND_COLOR[p.rimKind])
    const lo = o + TEX.lod * 4
    d[lo] = this.bounds[0]
    d[lo + 1] = this.bounds[1]
    d[lo + 2] = this.bounds[2]
    d[lo + 3] = p.rim
    const ro = o + TEX.rim * 4
    d[ro] = rc[0]
    d[ro + 1] = rc[1]
    d[ro + 2] = rc[2]

    const a = p.avatar
    if (a >= 0) {
      const L = this.avatarLists
      st.avatars++
      if (w.high > 0) {
        L.rows[0][a][L.counts[0][a]++] = p.row
        st.avatarHigh++
      }
      if (w.mid > 0) {
        L.rows[1][a][L.counts[1][a]++] = p.row
        st.avatarMid++
      }
      if (w.far > 0) {
        L.rows[2][a][L.counts[2][a]++] = p.row
        st.avatarFar++
      }
      // the player's gold "You" badge on the coat
      if (p.look.badgeKind === BADGE.you && st.badges < MAX_BADGES) this.badgeRows[st.badges++] = p.row
      // R2: the surgical cap over theatre scrubs
      if (p.look.hairStyle === 'theatreCap' && st.caps < MAX_CAPS) this.capRows[st.caps++] = p.row
    } else {
      if (w.high > 0) this.rowsHigh[st.high++] = p.row
      if (w.mid > 0) this.rowsMid[st.mid++] = p.row
      if (w.far > 0) this.rowsFar[st.far++] = p.row
    }
    if (p.rig.propDraw === PROP.blanket) {
      // the cover of a patient in a bed: its own draw (it is not held)
      if (p.rig.propScale > 0.01 && st.blankets < MAX_BLANKETS) this.blanketRows[st.blankets++] = p.row
    } else if (p.rig.propDraw !== PROP.none && p.rig.propScale > 0.01 && st.props < MAX_PROPS) {
      this.propRows[st.props] = p.row
      this.propKinds[st.props++] = p.rig.propDraw
    }
    if (p.vKind !== 0 && st.vehicles < MAX_VEHICLES) {
      this.vehRows[st.vehicles] = p.row
      this.vehKinds[st.vehicles] = p.vKind
      this.vehOffs[st.vehicles++] = p.vOff
    }
    this.blobs(p)
  }

  /**
   * Everything the rig is told about a person this frame (motion, held item, pose mode, posture, look-at) into `this.inp`. For the player this is
   * where the true body replaces the measured one (see `takeDriven`).
   */
  private fillInput(p: PersonSlot, e: Entity, f: FrameInput, dt: number): void {
    const dv = f.driven ?? null
    const posture = p.posture
    // W3: the player's legs are planned from the body's true velocity and what its keys ask for (the contract `walkBody`), everybody else from the measured one
    // (the body is in sim coordinates: this slot's drawn ones are shifted by its level)
    const ox = levelDx(p.level)
    const driven = dv !== null && p.key === PLAYER_ID && dv.live && posture === 'stand' && Math.abs(dv.x + ox - p.x) < DRIVEN_NEAR && Math.abs(dv.z - p.z) < DRIVEN_NEAR && !this.staleBody(p, dv, dt)
    if (driven) this.takeDriven(p, dv)
    else this.trackMotion(p, dt)
    // what is in the right hand
    let prop = e.prop ? PROP_OF[e.prop] : PROP.none
    if (posture === 'lie') prop = PROP.none
    else if (prop === PROP.none && posture === 'stand') {
      if (e.anim === 'tablet') prop = PROP.tablet
      else if (e.anim === 'carry') prop = PROP.folder
    }
    p.prop = prop
    // whoever has a vehicle in front of them and is not riding it is pushing it, whatever the sim called the animation
    p.mode = p.rideKind !== 0 && !e.riding && posture === 'stand' ? 'push' : modeFor(e.anim, posture, prop === PROP.tablet ? 'tablet' : 'none')
    const inp = this.inp
    inp.dt = dt
    inp.time = f.time
    // (the planner's frame: the person's own at 1x to 4x; see `PersonSlot.gox`. The look-at target moves with it)
    inp.x = p.x - p.gox
    inp.y = p.y
    inp.z = p.z - p.goz
    inp.gaitRate = driven ? 1 : this.gait
    inp.heading = p.heading
    inp.vx = p.vx
    inp.vz = p.vz
    inp.speed = p.speed
    inp.mode = p.mode
    inp.posture = posture
    inp.mood = e.mood
    inp.seatHeight = p.seatHeight
    // a patient in a bed follows the head of the bed (src/scene/rooms/bedPose.ts); everybody else is flat
    p.recline = posture === 'lie' ? damp(p.recline, reclineOfEntity(e), RECLINE_RATE, dt) : 0
    if (p.recline < 0.002) p.recline = 0
    p.rig.ctx.recline = p.recline
    inp.footRest = e.riding && e.vehicle === 'wheelchair' ? FOOT_REST : 0
    inp.prop = prop
    // a patient in a ward bed, an ER trolley or on a stretcher is under a blanket (the rig carries it as the prop of the lying body)
    inp.covered = posture === 'lie' && inBlanketBed(e)
    const target = e.lookAt
    inp.hasLook = !!target
    if (target) {
      // a look-at target is a sim point too: drawn where it is drawn (its own level)
      const tl = levelOf(target.x)
      inp.lookX = target.x + levelDx(tl) - p.gox
      inp.lookY = target.y + LEVEL_Y[tl]
      inp.lookZ = target.z - p.goz
    }
    inp.driven = driven
    if (driven) {
      inp.ax = dv.ax
      inp.az = dv.az
      inp.turnRate = dv.turnRate
      inp.wishX = dv.wishX
      inp.wishZ = dv.wishZ
      inp.stopping = dv.stopping
      inp.restX = dv.restX + ox
      inp.restZ = dv.restZ
    }
  }

  /**
   * A realistic person's skinned parts become M_p * B_p^-1, and the player's badge frame is the chest's (binds applied) moved to the avatar's badge
   * anchor: a point of its bind pose, so the badge stays on the cloth however the chest turns. R2: in theatre scrubs the cap frame is the head's (binds
   * applied) times T(centre) S(radii) of the avatar's cap fit, so the unit dome of the cap mesh sits on the skull and turns with it. Allocates nothing.
   */
  private bindAvatar(p: PersonSlot, o: number): void {
    const d = this.data
    const parts = o + TEX.parts * 4
    applyBinds(d, parts, this.binds[p.avatar])
    if (p.look.hairStyle === 'theatreCap') {
      const f = this.caps[p.avatar]
      const h = parts + P.head * 12
      const c = parts + CAP_FRAME * 12
      for (let r = 0; r < 3; r++) {
        const i = r * 4
        const a = d[h + i]
        const b = d[h + i + 1]
        const e = d[h + i + 2]
        d[c + i] = a * f.rx
        d[c + i + 1] = b * f.ry
        d[c + i + 2] = e * f.rz
        d[c + i + 3] = a * f.cx + b * f.cy + e * f.cz + d[h + i + 3]
      }
    }
    if (p.look.badgeKind !== BADGE.you) return
    const anchor = this.avatarList[p.avatar].badge
    const c = parts + P.chest * 12
    const b = parts + BADGE_FRAME * 12
    for (let r = 0; r < 3; r++) {
      const i = r * 4
      d[b + i] = d[c + i]
      d[b + i + 1] = d[c + i + 1]
      d[b + i + 2] = d[c + i + 2]
      d[b + i + 3] = d[c + i] * anchor[0] + d[c + i + 1] * anchor[1] + d[c + i + 2] * anchor[2] + d[c + i + 3]
    }
  }

  /** The head centre's height above the root, for the head look-at. */
  private headYOf(p: PersonSlot, posture: Posture, k: number): number {
    return posture === 'stand' ? STAND_HEAD_CENTRE * k : posture === 'sit' ? p.seatHeight + SEATED_HEAD_CENTRE * k : p.seatHeight + 0.2 + (BODY.neck + BODY.headCentre) * k * Math.sin(reclineAngle(p.recline))
  }

  /** Your legs while your avatar is invisible (first person): solved all the same, into your row of the pose texture, which nothing draws. */
  private legsOnly(p: PersonSlot, e: Entity, f: FrameInput, dt: number, o: number): void {
    this.fillInput(p, e, f, dt)
    aimHead(p.rig, dt, this.inp, this.headYOf(p, p.posture, p.look.scale))
    solveRig(p.rig, this.inp, this.data, o + TEX.parts * 4)
    this.publishStride(p, dt)
  }

  /**
   * Your heel strikes, for the footsteps and the camera bob (state.ts `walkStride`). Called once per frame after your legs were solved, so each foot that
   * landed in that frame counts as one strike. `phase` runs half a cycle from one strike to the next (0 at a left strike, 0.5 at a right) at the rate the
   * last two strikes had, and holds while you stand.
   */
  private publishStride(p: PersonSlot, dt: number): void {
    const pl = p.rig.planter
    const ws = walkStride
    if (pl.landed > 0) {
      // the time between this strike and the last one is the half cycle the phase has to cover
      if (ws.sinceStrike > 0.12 && ws.sinceStrike < 1) this.stridePeriod = damp(this.stridePeriod, ws.sinceStrike, 8, 1 / 60)
      ws.steps += pl.landed
      ws.foot = pl.lastLanded === 1 ? 1 : 0
      ws.sinceStrike = 0
      ws.strikeSpeed = p.speed
      ws.phase = ws.foot === 0 ? 0 : 0.5
    } else {
      ws.sinceStrike += dt
      if (pl.moving) ws.phase = (ws.foot === 0 ? 0 : 0.5) + 0.49 * clamp(ws.sinceStrike / this.stridePeriod, 0, 1)
    }
    ws.run = p.rig.run
  }

  /**
   * The body says it is going somewhere fast and the avatar did not move: nobody is writing it any more (the overview, where the player system is idle,
   * leaves the last velocity in it). Then the slot is measured like everybody else's.
   */
  private staleBody(p: PersonSlot, dv: DrivenBody, dt: number): boolean {
    if (!p.hasPrev || dt < 1e-5) return false
    const sp = Math.sqrt(dv.vx * dv.vx + dv.vz * dv.vz)
    if (sp < 0.5) return false
    const dx = p.x - p.px
    const dz = p.z - p.pz
    return Math.sqrt(dx * dx + dz * dz) < 0.25 * sp * dt
  }

  /** The player's true ground velocity (the contract `walkBody`) instead of the measured one; the bookkeeping `trackMotion` keeps goes on, so a switch back is seamless. */
  private takeDriven(p: PersonSlot, dv: DrivenBody): void {
    const sp = Math.sqrt(dv.vx * dv.vx + dv.vz * dv.vz)
    if (sp < 0.02) {
      p.vx = 0
      p.vz = 0
      p.speed = 0
    } else {
      p.vx = dv.vx
      p.vz = dv.vz
      p.speed = sp
    }
    p.gox = 0
    p.goz = 0
    p.px = p.x
    p.pz = p.z
    p.hasPrev = true
  }

  /** The measured, smoothed ground velocity: how far the body actually moved this frame. */
  private trackMotion(p: PersonSlot, dt: number): void {
    if (!p.hasPrev) {
      p.px = p.x
      p.pz = p.z
      p.hasPrev = true
    }
    // S1: at the sim's 10x and 30x a person covers `scale` sim seconds of walking per real second: the speed is measured per SIM second (so a stroll is
    // still a stroll), a jump is judged by the sim distance, and the gait is planned in a frame that moved only `gait / scale` as far as the person
    const scale = this.scale
    if (p.posture !== 'stand') {
      p.vx = 0
      p.vz = 0
      p.speed = 0
      p.gox = 0
      p.goz = 0
    } else if (dt > 1e-5) {
      const dx = p.x - p.px
      const dz = p.z - p.pz
      const jump = dx * dx + dz * dz
      if (jump > 6.25 * scale * scale) {
        p.vx = 0
        p.vz = 0
        p.speed = 0
        p.gox = 0
        p.goz = 0
      } else {
        const slip = 1 - this.gait / scale
        p.gox += dx * slip
        p.goz += dz * slip
        let rx = dx / dt / scale
        let rz = dz / dt / scale
        if (rx * rx + rz * rz < 0.0064) {
          rx = 0
          rz = 0
        }
        p.vx = damp(p.vx, rx, this.gait / 0.1, dt)
        p.vz = damp(p.vz, rz, this.gait / 0.1, dt)
        p.speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz)
        if (p.speed < 0.02) {
          p.vx = 0
          p.vz = 0
          p.speed = 0
        }
      }
    }
    p.px = p.x
    p.pz = p.z
  }

  /** The pick capsule: feet to head, seat to head, or hips-to-feet and head along a bed. */
  private capsule(p: PersonSlot, posture: Posture, k: number): void {
    const sx = Math.sin(p.heading)
    const cz = Math.cos(p.heading)
    if (posture === 'stand') {
      p.ax = p.x
      p.ay = p.y + 0.12
      p.az = p.z
      p.bx = p.x
      p.by = p.y + p.look.height - 0.12
      p.bz = p.z
    } else if (posture === 'sit') {
      p.ax = p.x
      p.ay = p.y + p.seatHeight + 0.15
      p.az = p.z
      p.bx = p.x
      p.by = p.y + p.seatHeight + SEATED_HEAD_CENTRE * k
      p.bz = p.z
    } else {
      const y = p.y + p.seatHeight + 0.12
      const head = (BODY.waist + BODY.neck + BODY.headCentre) * k
      p.ax = p.x - sx * head
      p.ay = y
      p.az = p.z - cz * head
      p.bx = p.x + sx * 0.8 * k
      p.by = y
      p.bz = p.z + cz * 0.8 * k
    }
  }

  /** The soft ground blobs of a person and of the vehicle this slot draws. */
  private blobs(p: PersonSlot): void {
    const st = this.stats
    const fade = BLOB_ALPHA * p.presence
    if (p.posture !== 'lie' && st.blobs < MAX_BLOBS) {
      const s = BLOB_PERSON * p.look.scale
      this.setBlob(st.blobs, p.x, p.y + BLOB_LIFT, p.z, p.heading, s, s, fade)
      st.blobs++
    }
    if (p.vKind !== 0 && st.blobs < MAX_BLOBS) {
      const [hw, hl] = VEHICLE_FOOTPRINT[p.vKind]
      const sn = Math.sin(p.heading)
      const cs = Math.cos(p.heading)
      this.setBlob(st.blobs, p.x + sn * p.vOff, p.y + BLOB_LIFT * 1.2, p.z + cs * p.vOff, p.heading, hw * 2.3, hl * 2.1, fade)
      st.blobs++
    }
  }

  /** A column-major matrix: width sx on the heading's X, length sz on its Z, at (x, y, z). */
  private setBlob(i: number, x: number, y: number, z: number, heading: number, sx: number, sz: number, fade: number): void {
    const m = this.blobMatrix
    const o = i * 16
    const c = Math.cos(heading)
    const s = Math.sin(heading)
    m[o] = c * sx
    m[o + 1] = 0
    m[o + 2] = -s * sx
    m[o + 3] = 0
    m[o + 4] = 0
    m[o + 5] = 1
    m[o + 6] = 0
    m[o + 7] = 0
    m[o + 8] = s * sz
    m[o + 9] = 0
    m[o + 10] = c * sz
    m[o + 11] = 0
    m[o + 12] = x
    m[o + 13] = y
    m[o + 14] = z
    m[o + 15] = 1
    this.blobFade[i] = fade
  }

  /**
   * Which person is under a ray (origin o, unit direction u), nearest first; null if none. The pick radius grows with distance
   * so somebody 150 m away is still about 14 px wide to click. People who are mostly faded out are not pickable.
   */
  pick(ox: number, oy: number, oz: number, ux: number, uy: number, uz: number, maxDist = 1e9): string | null {
    let best: string | null = null
    let bestT = maxDist
    for (const p of this.people.values()) {
      if (p.ghost || p.presence < 0.4 || !p.entity) continue
      const hit = rayVsSegment(ox, oy, oz, ux, uy, uz, p.ax, p.ay, p.az, p.bx, p.by, p.bz, pickRadius(p.dist))
      if (hit && hit.t < bestT) {
        bestT = hit.t
        best = p.key
      }
    }
    return best
  }
}
