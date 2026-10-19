/**
 * The whole hospital as one deterministic fixed-step simulation, outside React.
 *
 * Step order (one 1/60 s step): clock -> crowd snapshot -> medicine pipeline (verification, pods, dispensers, drawers)
 * -> the ER board -> the imaging suite (scanners, bookings, outpatient arrivals, reports) -> the arrival schedule
 * (new patients, visitors, ambient people) -> people -> riders placed ahead of their pushers -> faded-out people removed.
 * The MedPods hang from a ceiling rail (W2), so pods and people never wait for each other and nothing here is shared.
 * `sync(alpha)` then writes poses interpolated between the last two steps for the renderers.
 *
 * People come and go: `addPerson` / `removePerson` keep `people` and `entities` in step, and
 * `rosterVersion` changes whenever the set of entities does (renderers re-read the roster when it moves).
 */
import { staffName } from '@/content/staff'
import { CONFIG } from './config'
import { EventLog } from './events'
import { LivingDay } from './life'
import { BedFlow } from './beds'
import { DayRhythm } from './day'
import { Meals } from './meals'
import { World } from './er/world'
import { ImagingDepartment } from './imaging/department'
import { MedSystem, type PrescribeResult } from './meds/system'
import { Crowd } from './nav/crowd'
import { makeQueue } from './nav/queue'
import { createPeople, Patient, type PeopleContext, type Person } from './people'
import { createErStaff } from './population/staffing'
import { Director } from './population/director'
import { Rng } from './rng'
import { defaultSeats, SeatRegistry } from './seats'
import { newEntity } from './person'
import { Reactions } from './reactions'
import { groundHeightAt, type Spot } from './places'
import type { Entity, OrderItem, PlayerView, RoomId } from './types'
import { makeWalker, type Walker } from './walker'
import { DrawCentre } from './blood'
import { Lab } from './lab'
import { VitalsService } from './vitals'

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  else if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export interface SimulationOptions {
  /** A seat registry to use (tests share a layout); default: the building's seats. */
  seats?: SeatRegistry
  /** Pass `null` for plain solo walkers (no keep-right, no avoidance); default: one Crowd for the whole hospital. */
  crowd?: Crowd | null
  /** `false` builds the hospital with only the ward staff and inpatients (the M1 population). */
  population?: boolean
  /**
   * Clock hour to start at (L1 Jump / `?start=`). Default CONFIG.sim.startHour (07:30). `t` always counts sim
   * seconds from 07:30, so a later start begins at t = (startHour - 7.5) * 3600 and every hour function stays valid.
   */
  startHour?: number
  /** Added to `rosterVersion`, so renderers see a rebuilt hospital as a roster change (L1 Jump). */
  rosterBase?: number
}

export class Simulation {
  /** Sim seconds since 07:30 (CONFIG.sim.startHour), also for a warm start at another hour. */
  t = 0
  readonly seed: number
  readonly log = new EventLog()
  readonly meds: MedSystem
  readonly people: Person[]
  /** Every person by id; renderers read positions from here. */
  readonly entities = new Map<string, Entity>()
  /** Changes whenever somebody joins or leaves `entities`. */
  rosterVersion = 0
  readonly seats: SeatRegistry
  readonly crowd: Crowd | null
  readonly world: World
  readonly director: Director | null
  /** The imaging suite: four scanners (`sim.imaging.scanners[modality]`), their queues and the outpatients. */
  readonly imaging: ImagingDepartment
  /** W4 smart diagnostics: the entrance health kiosks, the robot blood-draw centre and the automated lab. */
  readonly vitals: VitalsService
  readonly blood: DrawCentre
  readonly lab: Lab
  /** Beds, meals and MealBots for the renderers and the HUD (L1). */
  readonly life: LivingDay
  /** L1 services (src/sim/beds, src/sim/day, src/sim/meals); stepped after the director. */
  readonly beds: BedFlow
  readonly day: DayRhythm
  readonly meals: Meals
  /** How people and pods react to you (W1). */
  readonly reactions: Reactions
  /** You (W1 walk-in): null until the player system adds you. The player system writes it every frame. */
  player: PlayerView | null = null
  private playerEntity: Entity | null = null
  private playerWalker: Walker | null = null
  private readonly ctx: PeopleContext
  private readonly leaving: Person[] = []

  constructor(seed: number = CONFIG.sim.worldSeed, options: SimulationOptions = {}) {
    this.seed = seed
    const startHour = options.startHour ?? CONFIG.sim.startHour
    const t0 = (startHour - CONFIG.sim.startHour) * 3600
    this.t = t0
    this.rosterVersion = options.rosterBase ?? 0
    const root = new Rng(seed)
    this.seats = options.seats ?? new SeatRegistry(defaultSeats())
    this.crowd = options.crowd === undefined ? new Crowd() : options.crowd
    const crowd = this.crowd
    const walkerFor = (id: string): Walker => makeWalker(crowd ?? undefined, { id })

    this.meds = new MedSystem(this.log, { name: (id) => (id === 'presenter' ? 'You' : staffName(id)) })
    this.meds.pharmacist = { A: 'pharm-A', B: 'pharm-B' }
    this.people = createPeople(walkerFor)
    const patients = new Map<RoomId, Patient>()
    for (const p of this.people) {
      if (p instanceof Patient) {
        patients.set(p.roomId, p)
        this.seats.claimId(`bed:${p.roomId}`, p.entity.id)
      }
      const seatId = p.entity.seated?.seatId
      if (seatId && seatId.startsWith('command:desk:')) this.seats.claimId(seatId, p.entity.id)
      this.entities.set(p.entity.id, p.entity)
    }

    this.life = new LivingDay(
      startHour,
      [...patients].map(([roomId, p]) => ({ roomId, patientId: p.entity.id, patientName: p.entity.name })),
    )

    this.world = new World(
      this.log,
      this.seats,
      root.fork('population'),
      { add: (p) => this.addPerson(p), remove: (p) => this.removePerson(p) },
      makeQueue('reception'),
      [makeQueue('kiosk0'), makeQueue('kiosk1')],
      patients,
      walkerFor,
    )
    this.world.t = t0
    this.imaging = new ImagingDepartment(this.world, root.fork('imaging'), walkerFor)
    this.world.imaging = this.imaging
    // W4: the lab first (the draw centre orders from it), then the kiosks and the draw centre
    this.lab = new Lab(this.world, root.fork('lab'))
    this.world.lab = this.lab
    this.vitals = new VitalsService(this.world, root.fork('vitals'), walkerFor)
    this.vitals.playerOf = () => this.playerAvatar
    this.world.vitals = this.vitals
    this.blood = new DrawCentre(this.world, root.fork('blood'), walkerFor)
    this.world.blood = this.blood
    this.ctx = {
      t: t0,
      meds: this.meds,
      rng: root.fork('people'),
      world: this.world,
    }

    const lifeDeps = (label: string) => ({ world: this.world, life: this.life, meds: this.meds, rng: root.fork(label) })
    this.beds = new BedFlow(lifeDeps('beds'))
    this.day = new DayRhythm(lifeDeps('day'))
    // the ward staff and coordinators are built by people.ts; the roster needs them for their shift changes
    this.day.attachPeople(this.people)
    this.meals = new Meals(lifeDeps('meals'))

    if (options.population === false) {
      this.director = null
    } else {
      for (const p of createErStaff(this.world, root.fork('staff'), walkerFor)) this.addPerson(p)
      this.imaging.startOutpatients(t0)
      this.director = new Director(this.world, root.fork('director'), walkerFor, (p) => this.addPerson(p), t0)
      // visitors go to whoever lies in the bed now (L1 bed flow), not the morning's catalogue patient
      this.director.occupantName = (r) => this.beds.occupantName(r)
      this.director.start()
    }
    this.day.doseWaves.occupantMeds = (r) => this.beds.occupantMeds(r)
    this.reactions = new Reactions({
      world: this.world,
      rng: root.fork('reactions'),
      player: () => this.player,
      people: this.people,
      meds: this.meds,
      life: this.life,
      meals: this.meals,
    })
    if (t0 !== 0) {
      // a warm start: the machine timers and the meds clock start at t0, or every timer fires on the first step
      this.world.clock.advanceTo(t0 * 1000)
      this.meds.syncClock(t0)
      this.beds.warmStart(startHour)
      this.day.warmStart(startHour)
      this.meals.warmStart(startHour)
      this.lab.warmStart(startHour)
      this.vitals.warmStart(startHour)
      this.blood.warmStart(startHour)
    }
    this.sync(1)
  }

  /** Somebody arrives (a patient, a visitor, a paramedic): they join the simulation and, if `fadeIn()` was called, fade in. */
  addPerson(p: Person): void {
    this.people.push(p)
    this.entities.set(p.entity.id, p.entity)
    this.rosterVersion++
    p.snapshot()
  }

  /** Somebody has left (faded out): take them out of everything. */
  removePerson(p: Person): void {
    const i = this.people.indexOf(p)
    if (i < 0) return
    this.people.splice(i, 1)
    if (this.entities.get(p.entity.id) === p.entity) this.entities.delete(p.entity.id)
    p.walker.remove()
    p.onRemoved(this.world)
    this.rosterVersion++
  }

  step(dt: number): void {
    this.t += dt
    this.ctx.t = this.t
    this.crowd?.beginStep()
    this.meds.step(dt, this.t)
    this.world.step(this.t, dt)
    this.imaging.step(this.t, dt)
    this.vitals.step(this.t, dt)
    this.blood.step(this.t, dt)
    this.lab.step(this.t, dt)
    this.director?.step(this.t, dt)
    this.beds.step(this.t, dt)
    this.day.step(this.t, dt)
    this.meals.step(this.t, dt)
    this.reactions.step(this.t, dt)
    const people = this.people
    for (let i = 0; i < people.length; i++) {
      const p = people[i]
      p.snapshot()
      p.update(dt, this.ctx)
      // a greeting or a talk with you shows the talking pose, also for staff whose controller rewrote `anim` (W1)
      if (p.wantsTalkPose(this.t)) p.talkPose()
      p.stepFade(dt)
      if (p.gone) this.leaving.push(p)
    }
    this.world.placeRiders()
    if (this.leaving.length > 0) {
      for (const p of this.leaving) this.removePerson(p)
      this.leaving.length = 0
    }
  }

  /** Write poses interpolated by `alpha` (0..1) between the previous and the current step. */
  sync(alpha: number): void {
    this.meds.fleet.sync(alpha)
    this.meds.dispensers.A.sync(alpha)
    this.meds.dispensers.B.sync(alpha)
    this.meals.sync(alpha)
    this.vitals.sync(alpha)
    this.blood.sync(alpha)
    this.lab.sync(alpha)
    const people = this.people
    for (let i = 0; i < people.length; i++) {
      const p = people[i]
      const e = p.entity
      const w = p.walker
      e.position.x = p.prevX + (w.x - p.prevX) * alpha
      e.position.z = p.prevZ + (w.z - p.prevZ) * alpha
      e.heading = lerpAngle(p.prevHeading, w.heading, alpha)
    }
  }

  // --- you (W1 walk-in) -----------------------------------------------------------------------------

  /**
   * Put you in the hospital: an avatar entity `player` (a doctor in a white coat, named "You") that the crowd renderer
   * draws and a static crowd proxy the NPCs steer around. (The pods ride a ceiling rail above you and never stop for you.) The player
   * system owns where you are and calls `movePlayer` every frame; the sim never moves you.
   */
  addPlayer(at: Spot): PlayerView {
    if (this.player) return this.player
    const view: PlayerView = { id: 'player', x: at.at.x, z: at.at.z, heading: at.heading, speed: 0, mode: 'walk', view: 'third' }
    this.player = view
    const e = newEntity('player', 'doctor', 'You', at.at, at.heading, 'role')
    this.playerEntity = e
    this.entities.set(e.id, e)
    this.rosterVersion++
    if (this.crowd) {
      const w = this.crowd.createWalker({ id: 'player', radius: CONFIG.player.crowdRadius })
      w.place(at.at.x, at.at.z, at.heading)
      w.setStatic(true)
      this.playerWalker = w
    }
    return view
  }

  /** Where you are now (call every frame while walking). Writes the avatar and the crowd proxy. */
  movePlayer(x: number, z: number, heading: number, speed: number): void {
    const p = this.player
    const e = this.playerEntity
    if (!p || !e) return
    p.x = x
    p.z = z
    p.heading = heading
    p.speed = speed
    e.position.x = x
    e.position.y = groundHeightAt(x, z)
    e.position.z = z
    e.heading = heading
    e.speed = speed
    // walking or standing; a pose another system set (sitting, the tablet) is kept while you stand still
    if (e.anim === 'walk' || e.anim === 'idle' || speed > 0.05) e.anim = speed > 0.05 ? 'walk' : 'idle'
    this.playerWalker?.place(x, z, heading)
  }

  /** Take you out (the overview with no avatar, or a test). */
  removePlayer(): void {
    if (!this.player) return
    this.player = null
    if (this.playerEntity) this.entities.delete(this.playerEntity.id)
    this.playerEntity = null
    this.playerWalker?.remove()
    this.playerWalker = null
    this.rosterVersion++
  }

  /** Your avatar entity (the player system sets `fade` in first person, and `anim`/`prop` for sitting or the tablet). */
  get playerAvatar(): Entity | null {
    return this.playerEntity
  }

  /** Run `seconds` of sim headless (a Jump's hidden pre-roll), then write the poses once. */
  preRoll(seconds: number): void {
    const n = Math.round(seconds / CONFIG.sim.step)
    for (let i = 0; i < n; i++) this.step(CONFIG.sim.step)
    this.sync(1)
  }

  /** The presenter's live order from the doctor's tablet panel. */
  prescribe(roomId: RoomId, items: OrderItem[]): PrescribeResult {
    return this.meds.prescribe({ roomId, items, prescriberId: 'presenter', source: 'presenter' })
  }
}
