/**
 * R5: every shot of every step of every scripted procedure frames its step from a good place. For each step (and each of its sub-shots), with the cart
 * parked and docked and the team where the script puts them (the real anchor spots), the director's own choice (`pickAltInto`: the designed eye, else the
 * first clear alternate) exists, and its eye (sim coordinates):
 *
 *   - stands inside its room less the 0.3 m margin, under the ceiling less 0.35 m;
 *   - is out of the furniture of its room (footprints, each with its height: the eye may pass over a low stool, not through a console), the cart and the
 *     surgical lights;
 *   - is at least 0.35 m from every member of that step's team, and NOBODY'S BODY (a capsule 0.28 m round, 1.85 m tall) is between it and the look point;
 *   - has its look point 0.4..3.5 m away (6.5 for the wide establishing shots), the step's focus in frame (unless the shot shows it as an inset);
 *   - has no wall between it and what it looks at (the chase camera's own wall probe), so the limits never have to move it;
 *   - converts to where it is drawn on level 2 exactly.
 */
import { describe, expect, it } from 'vitest'
import { getLayout } from '@/scene/building/layout'
import { WallBoxProbe } from '@/scene/player/boomProbe'
import { LIGHTS } from '@/scene/surgery/dims'
import { PROCEDURE_META, PROCEDURE_SCRIPTS } from '@/content/procedures'
import { LEVEL2_DX, LEVEL_Y, toDisplayInto } from '@/sim/levels'
import { CRYO_SUITE, IMAGING, SURGERY, areaById, type AreaId } from '@/sim/places'
import { anchorSpot, applyRoleViews, compiledFor, emptyProcedureView, focusPointInto, newRoleViews, newTargetCtx, setTable } from '@/sim/procedure'
import { cryoAnchorSlots, type CryoAnchor, type CtNeedlePath } from '@/sim/procedure/cryoPlaces'
import type { ProcedureId, ProcedureView, Vec3 } from '@/sim/types'
import { anchorInto, newAnchorCtx, syncAnchorCtx, syncCryoAnchors } from './anchors'
import { BODY_RADIUS, BODY_TOP, CEILING_MARGIN, PERSON_RADIUS, ROOM_MARGIN, addPerson, clampEyeInto, furnitureTop, insideObstacle, moveObstacle, newPeople, segmentClearOfPeople } from './limits'
import { CRADLE, ROBOT_ARM, WATCH_ROOMS, roomCart, roomObstacles, roomOfProcedure, type WatchRoomId, type WatchSim } from './rooms'
import {
  CLOSE_RANGE,
  FOV_RANGE,
  ROOM_DEFAULT,
  SHOTS,
  WIDE_FOREGROUND,
  WIDE_MAX,
  candidateInto,
  cueAt,
  holdDriftInto,
  inFrustum,
  isOverridePlan,
  pickAltInto,
  shotPlanFor,
  shotPoseInto,
  shotsOfRoom,
  type ShotScene,
  type ShotSpec,
} from './shots'
import { fillStepView } from './testkit'

const probe = new WallBoxProbe()
const footprints = getLayout().footprints

/** Is (x, z) within `m` of the footprint? */
function nearFootprint(f: (typeof footprints)[number], x: number, z: number, m: number): boolean {
  const dx = x - f.x
  const dz = z - f.z
  if (f.kind === 'circle') return Math.hypot(dx, dz) < f.hw + m
  const c = Math.cos(f.rotationY)
  const s = Math.sin(f.rotationY)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  return Math.abs(lx) < f.hw + m && Math.abs(lz) < f.hd + m
}

/** The patient cart's floor box at a spot (heading pi/2: its length along x), with its boom up to 2.5 m. */
function nearCart(at: { x: number; z: number }, x: number, z: number, m: number): boolean {
  const { w, l } = SURGERY.cart.size
  return Math.abs(x - at.x) < l / 2 + m && Math.abs(z - at.z) < w / 2 + m
}

/** The view of step `i` of a script as the engine publishes it (roles from the compiled script, the pose after the step, the focus point). */
function viewAt(id: ProcedureId, i: number, cart: { x: number; z: number }): ProcedureView {
  const cs = compiledFor(id)!
  const step = cs.script.steps[i]
  const view = emptyProcedureView()
  view.procedureId = id
  view.caseId = 'case'
  view.watch = true
  view.unit = step.unit
  view.stepIndex = i
  view.stepCount = cs.n
  view.stepId = step.id
  view.focus = step.focus
  view.roles = newRoleViews(cs.machine)
  applyRoleViews(view.roles, cs, i)
  Object.assign(view.patient, cs.poseAfter[i])
  const t = newTargetCtx()
  setTable(t, view.patient.headTiltDeg, view.patient.rollDeg)
  t.cart = cart
  focusPointInto(step.focus, t, view.focusAt)
  return view
}

const SCRIPTED = Object.keys(PROCEDURE_SCRIPTS) as ProcedureId[]
const CARTS = { parked: SURGERY.cart.park.at, docked: SURGERY.cart.dock.at }

/** Where the cart can be during a step: docked through the console, both ends while it drives in or away, parked otherwise. */
function cartsOf(step: { unit: string; slot?: string }): [string, { x: number; z: number }][] {
  if (step.unit === 'console' || step.slot === 'docking' || step.slot === 'targeting' || step.slot === 'undocking') return [['docked', CARTS.docked]]
  if (step.slot === 'driving' || step.slot === 'returning') return Object.entries(CARTS)
  return [['parked', CARTS.parked]]
}

/** Per script: console steps where the bedside hands lead (the endoscope small), and steps where only the surgeon acts or the assistant only suctions (big). */
const BEDSIDE_STEPS: Partial<Record<ProcedureId, { hands: string[]; big: string[] }>> = {
  'or-cholecystectomy': { hands: ['placeClips', 'bagGallbladder', 'divideDuct'], big: ['fireflyCheck', 'criticalView', 'clearCalot', 'freeFromLiver'] },
  'or-hysterectomy': { hands: ['uterineVessels', 'needleDrivers'], big: ['roundLigaments', 'colpotomy', 'cuffClosure', 'finalCheck'] },
  'or-prostatectomy': { hands: ['pedicles', 'bagging', 'leakTest', 'dorsalVein'], big: ['retzius', 'apex', 'anastomosis', 'finalCheck'] },
}

describe('the watch shots', () => {
  it('cover the scripted procedures of every room that can be watched (wave 2: the three da Vinci operations)', () => {
    for (const id of ['or-cholecystectomy', 'or-hysterectomy', 'or-prostatectomy'] as const) {
      expect(SCRIPTED).toContain(id)
      expect(BEDSIDE_STEPS[id], id).toBeDefined()
    }
  })

  it('every shot has a lens in range and an eye in a known area', () => {
    for (const room of ['or', 'cryo', 'us'] as const) {
      expect(shotsOfRoom(room).length, room).toBeGreaterThan(3)
      for (const s of shotsOfRoom(room)) {
        expect(s.room, s.id).toBe(room)
        expect(s.fov, s.id).toBeGreaterThanOrEqual(FOV_RANGE[0])
        expect(s.fov, s.id).toBeLessThanOrEqual(FOV_RANGE[1])
        expect(() => areaById(s.area), s.id).not.toThrow()
        expect(SHOTS[s.id]).toBe(s)
      }
    }
    for (const plan of Object.values(ROOM_DEFAULT)) for (const c of plan) expect(SHOTS[c.shot], c.shot).toBeDefined()
  })

  it('covers the five scripts of the CT suite and the ultrasound room (wave 3): every one of them is checked below', () => {
    for (const id of ['cryo-kidney', 'cryo-lung', 'cryo-liver', 'us-breastCancer', 'us-fibroadenoma'] as const) {
      expect(SCRIPTED).toContain(id)
      expect(NEW_SCRIPTED).toContain(id)
    }
  })

  for (const id of SCRIPTED) {
    const cs = compiledFor(id)!
    const room = roomOfProcedure(id)
    if (room !== 'or') continue
    describe(id, () => {
      it('resolves a shot for every step, and every sub-shot exists', () => {
        for (const step of cs.script.steps) {
          const plan = shotPlanFor(room, id, step.id, step.focus)
          expect(plan.length, step.id).toBeGreaterThan(0)
          expect(plan[0].from, step.id).toBe(0)
          for (const c of plan) expect(SHOTS[c.shot], `${step.id} ${c.shot}`).toBeDefined()
          for (let k = 1; k < plan.length; k++) expect(plan[k].from).toBeGreaterThan(plan[k - 1].from)
          expect(cueAt(plan, 0)).toBe(SHOTS[plan[0].shot])
          expect(cueAt(plan, 1)).toBe(SHOTS[plan[plan.length - 1].shot])
        }
      })

      it('frames every step from inside the room, under the ceiling, clear of furniture, the cart, the lights, the team, their bodies and the walls', () => {
        const problems: string[] = []
        const alternates: string[] = []
        let shots = 0
        const ctx = newAnchorCtx()
        const eye: Vec3 = { x: 0, y: 0, z: 0 }
        const target: Vec3 = { x: 0, y: 0, z: 0 }
        const clamped: Vec3 = { x: 0, y: 0, z: 0 }
        const people = newPeople()
        const obs = roomObstacles('or', footprints)
        const scene: ShotScene = { area: areaById('l2Or').rect, probe, people, obstacles: obs.obstacles, focus: null }
        cs.script.steps.forEach((step, i) => {
          for (const [cartName, cart] of cartsOf(step)) {
            const view = viewAt(id, i, cart)
            syncAnchorCtx(ctx, view, null, cart)
            moveObstacle(obs.obstacles, obs.cartSlot, cart.x, cart.z, SURGERY.cart.dock.heading)
            const team = view.roles.filter((r) => r.anchor !== null).map((r) => ({ role: r.role, at: anchorSpot(r.anchor!).at }))
            people.count = 0
            for (const m of team) addPerson(people, m.at.x, m.at.z)
            const plan = shotPlanFor(room, id, step.id, step.focus, view.roles)
            // a step's own override frames something else on purpose (its own test below); otherwise the step's focus stays in frame
            const focus = isOverridePlan(plan) ? null : view.focusAt
            scene.focus = focus
            for (const cue of plan) {
              const shot: ShotSpec = SHOTS[cue.shot]
              const where = `${step.id} (${cartName}) ${shot.id}`
              const r = areaById(shot.area as AreaId).rect
              scene.area = r
              const alt = pickAltInto(shot, ctx, scene, eye, target)
              shots++
              if (alt < 0) problems.push(`${where}: no clear pose among the alternates`)
              else if (alt > 0) alternates.push(`${where}: alternate ${alt}`)
              if (eye.x < r.x0 + ROOM_MARGIN - 1e-9 || eye.x > r.x1 - ROOM_MARGIN + 1e-9 || eye.z < r.z0 + ROOM_MARGIN - 1e-9 || eye.z > r.z1 - ROOM_MARGIN + 1e-9)
                problems.push(`${where}: eye (${eye.x.toFixed(2)}, ${eye.z.toFixed(2)}) is not inside ${shot.area}`)
              const ceiling = probe.ceilingAt(eye.x, eye.z) ?? 3
              if (eye.y > ceiling - CEILING_MARGIN + 1e-9) problems.push(`${where}: eye ${eye.y} is too near the ceiling (${ceiling})`)
              for (const f of footprints) {
                if (f.area !== shot.area || f.overhead) continue
                if (eye.y < furnitureTop(f.id) + 0.25 && nearFootprint(f, eye.x, eye.z, 0.15)) problems.push(`${where}: eye is in ${f.id}`)
              }
              if (eye.y < 2.6 && nearCart(cart, eye.x, eye.z, 0.2)) problems.push(`${where}: eye is in the cart at (${cart.x}, ${cart.z})`)
              for (const h of LIGHTS.heads) if (eye.y > LIGHTS.faceY - 0.3 && Math.hypot(eye.x - h.x, eye.z - h.z) < LIGHTS.housingDia / 2 + 0.15) problems.push(`${where}: eye is in a surgical light`)
              const dist = Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z)
              for (const m of team) {
                const d = Math.hypot(eye.x - m.at.x, eye.z - m.at.z)
                if (d < 0.35) problems.push(`${where}: eye is ${d.toFixed(2)} m from the ${m.role}`)
                // nobody's body between the lens and the look point (sampled along the line: independent of the director's own test; a wide shot
                // of the room needs only its foreground clear)
                const end = Math.min(1 - 0.3 / dist, shot.kind === 'wide' ? WIDE_FOREGROUND / dist : 1)
                for (let k = 0; k <= 80; k++) {
                  const t = (k / 80) * end
                  const py = eye.y + (target.y - eye.y) * t
                  const h = Math.hypot(eye.x + (target.x - eye.x) * t - m.at.x, eye.z + (target.z - eye.z) * t - m.at.z)
                  if (py < BODY_TOP && h < BODY_RADIUS - 0.01) {
                    problems.push(`${where}: the ${m.role} stands between the lens and the look point`)
                    break
                  }
                }
              }
              const max = shot.kind === 'wide' ? WIDE_MAX : CLOSE_RANGE[1]
              if (dist < CLOSE_RANGE[0] || dist > max) problems.push(`${where}: the look point is ${dist.toFixed(2)} m away`)
              if (shot.inset === undefined && focus !== null && !inFrustum(eye, target, shot.fov, focus)) problems.push(`${where}: the step's focus (${step.focus}) is out of frame`)
              const dx = eye.x - target.x
              const dy = eye.y - target.y
              const dz = eye.z - target.z
              if (probe.cast(target, { x: dx / dist, y: dy / dist, z: dz / dist }, dist, 0.1) !== null) problems.push(`${where}: a wall is between the eye and the look point`)
              clampEyeInto(eye, target, r, probe, people, clamped)
              if (Math.hypot(clamped.x - eye.x, clamped.y - eye.y, clamped.z - eye.z) > 1e-6) problems.push(`${where}: the limits move the eye`)
              // the slow push and orbit of a long hold stay inside the room too
              holdDriftInto(shot, 60, target, eye)
              if (eye.x < r.x0 + ROOM_MARGIN - 0.05 || eye.x > r.x1 - ROOM_MARGIN + 0.05 || eye.z < r.z0 + ROOM_MARGIN - 0.05 || eye.z > r.z1 - ROOM_MARGIN + 0.05)
                problems.push(`${where}: the hold's drift takes the eye out of the room`)
            }
          }
        })
        expect(problems).toEqual([])
        // the designed eyes are good ones: alternates are the exception (they are listed if this fails)
        expect(alternates.length / shots, alternates.join('\n')).toBeLessThan(0.25)
      })

      it('a console step whose assistant or scrub nurse leads with their hands shows their hands, the endoscope small; only the surgeon: big', () => {
        const at = (stepId: string) => {
          const i = cs.script.steps.findIndex((s) => s.id === stepId)
          const view = viewAt(id, i, CARTS.docked)
          return shotPlanFor('or', id, stepId, cs.script.steps[i].focus, view.roles).map((c) => SHOTS[c.shot])
        }
        const { hands, big } = BEDSIDE_STEPS[id]!
        for (const stepId of hands) {
          const plan = at(stepId)
          expect(plan.map((s) => s.id), stepId).toEqual(['or.fieldInset'])
          expect(plan[0].inset, stepId).toBe('endo')
          expect(plan[0].insetBig, stepId).toBeUndefined()
        }
        for (const stepId of big) expect(at(stepId).some((s) => s.insetBig === true), stepId).toBe(true)
      })

      it('the cart steps show the cart and the table together; the arms steps the arms meeting the ports, from above', () => {
        const ctx = newAnchorCtx()
        const eye: Vec3 = { x: 0, y: 0, z: 0 }
        const target: Vec3 = { x: 0, y: 0, z: 0 }
        const table = { x: SURGERY.table.at.x, y: 1.0, z: SURGERY.table.at.z }
        for (const stepId of ['deployCart', 'driveCart', 'cartAway']) {
          const i = cs.script.steps.findIndex((s) => s.id === stepId)
          const shot = cueAt(shotPlanFor('or', id, stepId, cs.script.steps[i].focus), 0)
          expect(shot.id, stepId).toBe('or.dockWide')
          for (const cart of Object.values(CARTS)) {
            syncAnchorCtx(ctx, viewAt(id, i, cart), null, cart)
            shotPoseInto(shot, ctx, eye, target)
            expect(inFrustum(eye, target, shot.fov, { x: cart.x, y: 1.3, z: cart.z }), `${stepId}: the cart`).toBe(true)
            expect(inFrustum(eye, target, shot.fov, table), `${stepId}: the table`).toBe(true)
          }
        }
        for (const stepId of ['dockCamera', 'targetArms', 'instrumentsIn', 'releaseArms']) {
          const i = cs.script.steps.findIndex((s) => s.id === stepId)
          const shot = cueAt(shotPlanFor('or', id, stepId, cs.script.steps[i].focus), 0)
          expect(shot.id, stepId).toBe('or.armsHigh')
          syncAnchorCtx(ctx, viewAt(id, i, CARTS.docked), null, CARTS.docked)
          shotPoseInto(shot, ctx, eye, target)
          expect(eye.y, stepId).toBeGreaterThan(2.3)
          const port = { x: 0, y: 0, z: 0 }
          anchorInto('port1', ctx, port)
          expect(inFrustum(eye, target, shot.fov, port), `${stepId}: the camera port`).toBe(true)
          expect(inFrustum(eye, target, shot.fov, { x: CARTS.docked.x, y: 1.3, z: CARTS.docked.z }), `${stepId}: the cart`).toBe(true)
        }
      })
    })
  }

  it('the establishing shot keeps the consoles out of the foreground', () => {
    const s = SHOTS['or.establish']
    const ctx = newAnchorCtx()
    const eye: Vec3 = { x: 0, y: 0, z: 0 }
    const target: Vec3 = { x: 0, y: 0, z: 0 }
    shotPoseInto(s, ctx, eye, target)
    expect(eye.y).toBeGreaterThanOrEqual(2.35)
    for (const c of [SURGERY.consoles.surgeon.centre, SURGERY.consoles.teach.centre]) {
      const p = { x: c.x, y: 1.6, z: c.z }
      const near = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) < 3
      expect(near && inFrustum(eye, target, s.fov, p)).toBe(false)
    }
  })

  it('the alternates: the designed eye first, then mirrored, raised and orbited round the look point (the distance kept)', () => {
    const id: ProcedureId = 'or-cholecystectomy'
    const i = compiledFor(id)!.script.steps.findIndex((s) => s.id === 'robotPorts')
    const ctx = newAnchorCtx()
    syncAnchorCtx(ctx, viewAt(id, i, CARTS.parked), null, CARTS.parked)
    const shot = SHOTS['or.field']
    const e0 = { x: 0, y: 0, z: 0 }
    const e = { x: 0, y: 0, z: 0 }
    const t = { x: 0, y: 0, z: 0 }
    expect(candidateInto(shot, ctx, 0, e0, t)).toBe(true)
    const flat = (p: Vec3) => Math.hypot(p.x - t.x, p.z - t.z)
    expect(candidateInto(shot, ctx, 1, e, t)).toBe(true) // mirrored: the other side of the assistant
    expect(Math.hypot(e.x - e0.x, e.z - e0.z)).toBeGreaterThan(0.5)
    expect(candidateInto(shot, ctx, 2, e, t)).toBe(true)
    expect(e.y).toBe(2.1)
    // an eye already that high has no raised alternate
    expect(candidateInto(SHOTS['or.establish'], ctx, 2, e, t)).toBe(false)
    for (const alt of [3, 4, 5, 6]) {
      expect(candidateInto(shot, ctx, alt, e, t)).toBe(true)
      expect(flat(e)).toBeCloseTo(flat(e0), 9)
      expect(e.y).toBe(e0.y)
    }
    // a fixed eye has no side to mirror
    expect(candidateInto(SHOTS['or.establish'], ctx, 1, e, t)).toBe(false)
  })

  it('a body on the line of sight blocks it; beside it, over its head, beyond the look point or at the hands, it does not', () => {
    const eye = { x: 0, y: 1.7, z: 0 }
    const target = { x: 2, y: 1.0, z: 0 }
    const people = newPeople()
    const blocked = (x: number, z: number): boolean => {
      people.count = 0
      addPerson(people, x, z)
      return !segmentClearOfPeople(eye, target, people)
    }
    expect(blocked(0.6, 0)).toBe(true)
    expect(blocked(0.6, 0.2)).toBe(true)
    expect(blocked(0.6, 0.35)).toBe(false)
    expect(blocked(2.6, 0)).toBe(false) // beyond the look point
    expect(blocked(2.1, 0)).toBe(false) // standing at the work point: their hands are the subject
    // a wide shot looks past the people far from the lens
    people.count = 0
    addPerson(people, 1.5, 0)
    expect(segmentClearOfPeople(eye, target, people)).toBe(false)
    expect(segmentClearOfPeople(eye, target, people, BODY_RADIUS, BODY_TOP, 0.3, 1.0)).toBe(true)
    people.count = 0
    addPerson(people, 0.3, 0)
    expect(segmentClearOfPeople({ x: 0, y: 2.6, z: 0 }, { x: 2, y: 2.2, z: 0 }, people)).toBe(true) // over their head
  })

  it('over the shoulder: the eye stands beside the role, on the far side from the field, to the camera\'s right', () => {
    const id: ProcedureId = 'or-cholecystectomy'
    const i = compiledFor(id)!.script.steps.findIndex((s) => s.id === 'firstPort')
    const view = viewAt(id, i, CARTS.parked)
    const ctx = newAnchorCtx()
    syncAnchorCtx(ctx, view, null, CARTS.parked)
    const eye = { x: 0, y: 0, z: 0 }
    const target = { x: 0, y: 0, z: 0 }
    shotPoseInto(SHOTS['or.field'], ctx, eye, target)
    const at = SURGERY.staff.assistant.at
    // the assistant stands east of the table facing west: the eye is a little further east, to the north (the right of a camera looking west), high
    expect(eye.x).toBeGreaterThan(at.x + 0.1)
    expect(eye.z).toBeLessThan(at.z - 0.3)
    expect(eye.y).toBe(2.05)
    // with somebody filling the role, it is their position that counts
    const entities = new Map([['nurse', { position: { x: at.x + 0.2, y: 0, z: at.z + 0.1 } }]])
    view.roles.find((r) => r.role === 'assistant')!.entityId = 'nurse'
    syncAnchorCtx(ctx, view, entities, CARTS.parked)
    const eye2 = { x: 0, y: 0, z: 0 }
    shotPoseInto(SHOTS['or.field'], ctx, eye2, target)
    expect(eye2.x - eye.x).toBeGreaterThan(0.1)
  })

  it('anchors follow the table and the cart', () => {
    const view = viewAt('or-cholecystectomy', 0, CARTS.parked)
    const ctx = newAnchorCtx()
    const a = { x: 0, y: 0, z: 0 }
    syncAnchorCtx(ctx, view, null, CARTS.parked)
    anchorInto('cart', ctx, a)
    expect([a.x, a.z]).toEqual([CARTS.parked.x, CARTS.parked.z])
    syncAnchorCtx(ctx, view, null, CARTS.docked)
    anchorInto('cart', ctx, a)
    expect([a.x, a.z]).toEqual([CARTS.docked.x, CARTS.docked.z])
    const flat = { x: 0, y: 0, z: 0 }
    anchorInto('mouth', ctx, flat)
    view.patient.headTiltDeg = 12
    syncAnchorCtx(ctx, view, null, CARTS.docked)
    anchorInto('mouth', ctx, a)
    expect(a.y).toBeGreaterThan(flat.y + 0.05) // head up: the mouth rises with the table
  })

  it('converts every eye to where it is drawn on level 2 (the theatre and the CT suite); the ultrasound room is on level 1, drawn where it is', () => {
    const out = { x: 0, y: 0, z: 0 }
    for (const s of [...shotsOfRoom('or'), ...shotsOfRoom('cryo')]) {
      toDisplayInto(s.eye, out)
      expect(out.x).toBeCloseTo(s.eye.x - LEVEL2_DX, 9)
      expect(out.y).toBeCloseTo(s.eye.y + LEVEL_Y[2], 9)
      expect(out.z).toBe(s.eye.z)
    }
    for (const s of shotsOfRoom('us')) {
      toDisplayInto(s.eye, out)
      expect(out).toEqual(s.eye)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// R5 wave 3: the CT cryo suite and the ultrasound room. The same checks for every step of the five scripts, with the team where the script puts them
// (the CT anchors by their slots: several people at one anchor take its spots in turn, as the suite's team does), the table in and out of the bore for the
// scan steps, and the needle being worked on for the aim steps.
// ---------------------------------------------------------------------------------------------

const NEW_ROOMS = ['cryo', 'us'] as const
const NEW_SCRIPTED = SCRIPTED.filter((id) => (NEW_ROOMS as readonly WatchRoomId[]).includes(roomOfProcedure(id)))
const CT_SPARE = 0.75

/** The place of the `slot`-th person at a CT anchor: its own spots, then spares east of the last one (src/sim/cryoSuite/sites.ts). */
function ctSlot(anchor: CryoAnchor, slot: number): { x: number; z: number } {
  const own = cryoAnchorSlots(anchor)
  if (slot < own.length) return own[slot].at
  const last = own[own.length - 1].at
  return { x: last.x + CT_SPARE * (slot - own.length + 1), z: last.z }
}

interface Member {
  role: string
  at: { x: number; z: number }
}

/** Who stands where in a step: the script's anchors (the CT's by slot, in the roles' order), nobody for a role without a line. */
function teamOf(view: ProcedureView, room: WatchRoomId): Member[] {
  const out: Member[] = []
  view.roles.forEach((r, i) => {
    if (r.anchor === null) return
    if (room === 'cryo') {
      let slot = 0
      for (let o = 0; o < i; o++) if (view.roles[o].anchor === r.anchor) slot++
      out.push({ role: r.role, at: ctSlot(r.anchor as CryoAnchor, slot) })
    } else out.push({ role: r.role, at: anchorSpot(r.anchor).at })
  })
  return out
}

/** The steps whose table rides into the bore: the three CT scans. */
const SCAN_UNITS = new Set(['planningCt', 'checkCt', 'finalCt'])

/** A planned needle path as the planner makes them (mm: about 85 toward the robot, a little above or below), for the needle anchors. */
const NEEDLES: CtNeedlePath[] = [
  { entry: { x: 85, y: -12 }, dz: 18 },
  { entry: { x: 78, y: 14 }, dz: -22 },
]

function inRect(r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, m: number): boolean {
  return x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m
}

describe.each(NEW_SCRIPTED)('the watch shots of %s', (id) => {
  const cs = compiledFor(id)!
  const room = roomOfProcedure(id)
  const def = WATCH_ROOMS[room]
  const key = PROCEDURE_META[id].key
  const probeNow = probe

  it('resolves a shot for every step, every sub-shot exists, and an override or a focus plan names real shots', () => {
    for (const step of cs.script.steps) {
      const plan = shotPlanFor(room, id, step.id, step.focus)
      expect(plan.length, step.id).toBeGreaterThan(0)
      expect(plan[0].from, step.id).toBe(0)
      for (const c of plan) {
        expect(SHOTS[c.shot], `${step.id} ${c.shot}`).toBeDefined()
        expect(SHOTS[c.shot].room, `${step.id} ${c.shot}`).toBe(room)
      }
      for (let k = 1; k < plan.length; k++) expect(plan[k].from).toBeGreaterThan(plan[k - 1].from)
      expect(cueAt(plan, 0)).toBe(SHOTS[plan[0].shot])
      expect(cueAt(plan, 1)).toBe(SHOTS[plan[plan.length - 1].shot])
    }
  })

  it('frames every step from inside its area, under the ceiling, clear of the furniture, the cradle, the robot, the team, their bodies and the walls', () => {
    const problems: string[] = []
    const alternates: string[] = []
    let shots = 0
    const ctx = newAnchorCtx()
    const eye: Vec3 = { x: 0, y: 0, z: 0 }
    const target: Vec3 = { x: 0, y: 0, z: 0 }
    const clamped: Vec3 = { x: 0, y: 0, z: 0 }
    const people = newPeople()
    const obs = roomObstacles(room, footprints)
    const scene: ShotScene = { area: areaById(def.area).rect, probe: probeNow, people, obstacles: obs.obstacles, focus: null }
    const cradle = { tablePos: 0 }
    const fakeSim = { cryoSuite: { state: cradle } } as unknown as WatchSim
    cs.script.steps.forEach((step, i) => {
      const scan = SCAN_UNITS.has(step.unit)
      // the table out, and (a scan) half way and all the way in; an aim or a needle-out step also with a needle under work
      const variants: { tablePos: number; needle: number }[] = [{ tablePos: 0, needle: -1 }]
      if (room === 'cryo' && scan) variants.push({ tablePos: 0.5, needle: -1 }, { tablePos: 1, needle: -1 })
      if (room === 'cryo' && (step.focus === 'needle' || step.id === 'robotAims')) variants.push({ tablePos: 0, needle: 0 }, { tablePos: 0, needle: 1 })
      for (const v of variants) {
        const view = fillStepView(emptyProcedureView(), id, i, SURGERY.cart.park.at, 'case', true, v.tablePos)
        syncAnchorCtx(ctx, view, null, null)
        if (room === 'cryo') {
          syncCryoAnchors(ctx, { tablePos: v.tablePos, target: key as 'kidney', needle: v.needle, needles: NEEDLES })
          cradle.tablePos = v.tablePos
          const c = roomCart(fakeSim, 'cryo')!
          moveObstacle(obs.obstacles, obs.cartSlot, c.x, c.z, c.heading)
        }
        const team = teamOf(view, room)
        const plan = shotPlanFor(room, id, step.id, step.focus, view.roles)
        const focus = isOverridePlan(plan) ? null : view.focusAt
        scene.focus = focus
        for (const cue of plan) {
          const shot: ShotSpec = SHOTS[cue.shot]
          const where = `${step.id} (table ${v.tablePos}, needle ${v.needle}) ${shot.id}`
          const r = areaById(shot.area as AreaId).rect
          scene.area = r
          // the people the director would collect for this shot: those in its area and just round it
          people.count = 0
          for (const m of team) if (inRect(r, m.at.x, m.at.z, 0.5)) addPerson(people, m.at.x, m.at.z)
          const alt = pickAltInto(shot, ctx, scene, eye, target)
          shots++
          if (alt < 0) problems.push(`${where}: no clear pose among the alternates`)
          else if (alt > 0) alternates.push(`${where}: alternate ${alt}`)
          if (!inRect(r, eye.x, eye.z, -ROOM_MARGIN + 1e-9)) problems.push(`${where}: eye (${eye.x.toFixed(2)}, ${eye.z.toFixed(2)}) is not inside ${shot.area}`)
          const ceiling = probeNow.ceilingAt(eye.x, eye.z) ?? 3
          if (eye.y > ceiling - CEILING_MARGIN + 1e-9) problems.push(`${where}: eye ${eye.y} is too near the ceiling (${ceiling})`)
          for (const f of footprints) {
            if (!def.furnitureAreas.includes(f.area as AreaId) || f.overhead || /:ct:table$/.test(f.id)) continue
            if (eye.y < furnitureTop(f.id) + 0.25 && nearFootprint(f, eye.x, eye.z, 0.15)) problems.push(`${where}: eye is in ${f.id}`)
          }
          if (insideObstacle(obs.obstacles, eye.x, eye.y, eye.z) >= 0) problems.push(`${where}: eye is in an obstacle (the cradle, the robot's arm or a piece of furniture)`)
          if (room === 'cryo') {
            const c = roomCart(fakeSim, 'cryo')!
            if (eye.y < CRADLE.top + 0.25 && Math.abs(eye.x - c.x) < CRADLE.halfLength + 0.15 && Math.abs(eye.z - c.z) < CRADLE.halfWidth + 0.15) problems.push(`${where}: eye is over the CT table`)
            if (eye.y < ROBOT_ARM.top + 0.25 && eye.y > ROBOT_ARM.bottom - 0.25 && Math.abs(eye.x - ROBOT_ARM.x) < ROBOT_ARM.halfX + 0.15 && Math.abs(eye.z - ROBOT_ARM.z) < ROBOT_ARM.halfZ + 0.15) problems.push(`${where}: eye is in the robot's arm`)
          }
          const dist = Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z)
          for (const m of team) {
            if (!inRect(r, m.at.x, m.at.z, 0.5)) continue
            const d = Math.hypot(eye.x - m.at.x, eye.z - m.at.z)
            if (d < 0.35) problems.push(`${where}: eye is ${d.toFixed(2)} m from the ${m.role}`)
            const end = Math.min(1 - 0.3 / dist, shot.kind === 'wide' ? WIDE_FOREGROUND / dist : 1)
            for (let k = 0; k <= 80; k++) {
              const t = (k / 80) * end
              const py = eye.y + (target.y - eye.y) * t
              const h = Math.hypot(eye.x + (target.x - eye.x) * t - m.at.x, eye.z + (target.z - eye.z) * t - m.at.z)
              if (py < BODY_TOP && h < BODY_RADIUS - 0.01) {
                problems.push(`${where}: the ${m.role} stands between the lens and the look point`)
                break
              }
            }
          }
          const max = shot.kind === 'wide' ? WIDE_MAX : CLOSE_RANGE[1]
          if (dist < CLOSE_RANGE[0] || dist > max) problems.push(`${where}: the look point is ${dist.toFixed(2)} m away`)
          if (shot.inset === undefined && focus !== null && !inFrustum(eye, target, shot.fov, focus)) problems.push(`${where}: the step's focus (${step.focus}) is out of frame`)
          const dx = eye.x - target.x
          const dy = eye.y - target.y
          const dz = eye.z - target.z
          if (probeNow.cast(target, { x: dx / dist, y: dy / dist, z: dz / dist }, dist, 0.1) !== null) problems.push(`${where}: a wall is between the eye and the look point`)
          clampEyeInto(eye, target, r, probeNow, people, clamped)
          if (Math.hypot(clamped.x - eye.x, clamped.y - eye.y, clamped.z - eye.z) > 1e-6) problems.push(`${where}: the limits move the eye`)
          // the slow push and orbit of a long hold stay in the room, out of the obstacles and off the people too
          holdDriftInto(shot, 60, target, eye)
          if (!inRect(r, eye.x, eye.z, -ROOM_MARGIN + 0.05)) problems.push(`${where}: the hold's drift takes the eye out of the room`)
          if (insideObstacle(obs.obstacles, eye.x, eye.y, eye.z, 0, 0) >= 0) problems.push(`${where}: the hold's drift takes the eye into an obstacle`)
          if (eye.y < 1.95) for (const m of team) if (inRect(r, m.at.x, m.at.z, 0.5) && Math.hypot(eye.x - m.at.x, eye.z - m.at.z) < PERSON_RADIUS) problems.push(`${where}: the hold's drift takes the eye into the ${m.role}`)
        }
      }
    })
    expect(problems).toEqual([])
    // the designed eyes are good ones: alternates are the exception (they are listed if this fails)
    expect(alternates.length / shots, alternates.join('\n')).toBeLessThan(0.25)
  })
})

describe('the CT suite\'s shots by what they show', () => {
  const ctx = newAnchorCtx()
  const eye: Vec3 = { x: 0, y: 0, z: 0 }
  const target: Vec3 = { x: 0, y: 0, z: 0 }
  const at = (id: ProcedureId, stepId: string, tablePos = 0, needle = -1): ProcedureView => {
    const i = compiledFor(id)!.script.steps.findIndex((s) => s.id === stepId)
    expect(i, `${id} ${stepId}`).toBeGreaterThanOrEqual(0)
    const view = fillStepView(emptyProcedureView(), id, i, SURGERY.cart.park.at, 'case', true, tablePos)
    syncAnchorCtx(ctx, view, null, null)
    syncCryoAnchors(ctx, { tablePos, target: PROCEDURE_META[id].key as 'kidney', needle, needles: NEEDLES })
    return view
  }
  const plan = (id: ProcedureId, stepId: string, view: ProcedureView) => shotPlanFor('cryo', id, stepId, view.focus, view.roles).map((c) => SHOTS[c.shot])

  it('the establishing shot is a wide one from a corner of the scan room, high, with the table and the gantry in frame', () => {
    const s = SHOTS['ct.establish']
    expect(s.kind).toBe('wide')
    expect(ROOM_DEFAULT.cryo.map((c) => c.shot)).toEqual(['ct.establish'])
    const view = at('cryo-kidney', 'wheelsIn')
    shotPoseInto(s, ctx, eye, target)
    const r = areaById('l2Cryo').rect
    // a corner: within a metre and a half of two walls
    expect(Math.min(eye.x - r.x0, r.x1 - eye.x)).toBeLessThan(1.5)
    expect(Math.min(eye.z - r.z0, r.z1 - eye.z)).toBeLessThan(1.5)
    expect(eye.y).toBeGreaterThanOrEqual(2.3)
    const g = { x: CRYO_SUITE.ct.machine.x, y: 1.1, z: CRYO_SUITE.ct.machine.z }
    expect(inFrustum(eye, target, s.fov, g)).toBe(true)
    expect(inFrustum(eye, target, s.fov, view.focusAt)).toBe(true)
  })

  it('the bore: a scan shows the table sliding into the gantry with the CT picture big once it is in; the planning shows the plan at the robot station', () => {
    for (const id of ['cryo-kidney', 'cryo-lung', 'cryo-liver'] as const) {
      const scans = ['planningScan', 'checkScan', 'finalScan']
      for (const stepId of scans) {
        for (const tablePos of [0, 0.5, 1]) {
          const view = at(id, stepId, tablePos)
          const p = plan(id, stepId, view)
          expect(p.map((x) => x.id), `${id} ${stepId}`).toEqual(['ct.bore', 'ct.boreCt'])
          expect(p[1].inset).toBe('ctLive')
          expect(p[1].insetBig).toBe(true)
          // the gantry, and the table wherever it is (out, half way, in), are in the 3D picture
          shotPoseInto(p[0], ctx, eye, target)
          const t = CRYO_SUITE.ct.table
          const tableX = t.out.x + (t.in.x - t.out.x) * tablePos
          expect(inFrustum(eye, target, p[0].fov, { x: CRYO_SUITE.ct.machine.x, y: 1.1, z: CRYO_SUITE.ct.machine.z }), `${stepId} gantry`).toBe(true)
          expect(inFrustum(eye, target, p[0].fov, { x: tableX, y: 1.0, z: t.out.z }), `${stepId} table at ${tablePos}`).toBe(true)
        }
      }
      const view = at(id, 'planPaths')
      const p = plan(id, 'planPaths', view)
      expect(p.map((x) => x.id)).toEqual(['ct.plan', 'ct.planBig'])
      expect(p.every((x) => x.inset === 'ctPlan' && x.area === 'l2CryoControl')).toBe(true)
      expect(p[0].insetBig).toBeUndefined()
      expect(p[1].insetBig).toBe(true)
      // the eye stands in the control room and the plan screen is in the picture
      shotPoseInto(p[0], ctx, eye, target)
      const plans = { x: CRYO_SUITE.screens.robotStation.x, y: CRYO_SUITE.screens.robotStation.y, z: CRYO_SUITE.screens.robotStation.z }
      expect(inFrustum(eye, target, p[0].fov, plans)).toBe(true)
      expect(areaById('l2CryoControl').rect.z1).toBeGreaterThan(eye.z)
    }
  })

  it('the ice ball steps show the table with the CT picture small, then big; the active thaw the console with the picture small', () => {
    for (const [id, steps] of [
      ['cryo-kidney', ['freeze1', 'thaw', 'freeze2']],
      ['cryo-lung', ['freezeShort', 'thawFirst', 'freezeMain', 'thawSecond', 'freezeLast']],
      ['cryo-liver', ['freeze1', 'thaw', 'freeze2']],
    ] as const) {
      for (const stepId of steps) {
        const p = plan(id, stepId, at(id, stepId))
        expect(p.map((x) => x.id), `${id} ${stepId}`).toEqual(['ct.ice', 'ct.iceBig'])
        expect(p[0].inset).toBe('ctLive')
        expect(p[0].insetBig).toBeUndefined()
        expect(p[1].insetBig).toBe(true)
      }
      const t = plan(id, 'activeThaw', at(id, 'activeThaw'))
      expect(t.map((x) => x.id)).toEqual(['ct.console'])
      expect(t[0].inset).toBe('ctLive')
    }
  })

  it('the needle steps stand behind the radiologist\'s shoulder and look at the skin entry of the needle at work; the robot step at its guide, with the entry in frame', () => {
    for (const id of ['cryo-kidney', 'cryo-lung', 'cryo-liver'] as const) {
      for (const stepId of ['localAndNick', 'pushNeedle', 'needlesOut', 'dressings']) {
        const view = at(id, stepId, 0, 0)
        const p = plan(id, stepId, view)
        expect(p.map((x) => x.id), `${id} ${stepId}`).toEqual(['ct.needle'])
        expect(p[0].over).toBe('ir')
        shotPoseInto(p[0], ctx, eye, target)
        const entry = { x: 0, y: 0, z: 0 }
        anchorInto('needleEntry', ctx, entry)
        expect(target).toEqual(entry)
        expect(inFrustum(eye, target, p[0].fov, entry)).toBe(true)
      }
      const view = at(id, 'robotAims', 0, 1)
      const p = plan(id, 'robotAims', view)
      expect(p.map((x) => x.id)).toEqual(['ct.robot'])
      expect(isOverridePlan(shotPlanFor('cryo', id, 'robotAims', view.focus, view.roles))).toBe(true)
      shotPoseInto(p[0], ctx, eye, target)
      const guide = { x: 0, y: 0, z: 0 }
      anchorInto('robotGuide', ctx, guide)
      const entry = { x: 0, y: 0, z: 0 }
      anchorInto('needleEntry', ctx, entry)
      expect(inFrustum(eye, target, p[0].fov, guide)).toBe(true)
      expect(inFrustum(eye, target, p[0].fov, entry)).toBe(true)
      // the needle under work moves the entry (and the radiologist's shoulder keeps the camera beside them)
      const other = { x: 0, y: 0, z: 0 }
      syncCryoAnchors(ctx, { tablePos: 0, target: PROCEDURE_META[id].key as 'kidney', needle: 0, needles: NEEDLES })
      anchorInto('needleEntry', ctx, entry)
      syncCryoAnchors(ctx, { tablePos: 0, target: PROCEDURE_META[id].key as 'kidney', needle: 1, needles: NEEDLES })
      anchorInto('needleEntry', ctx, other)
      expect(Math.hypot(entry.x - other.x, entry.y - other.y, entry.z - other.z)).toBeGreaterThan(0.02)
    }
  })

  it('the airway steps show the head end, the turns the whole table, and the plain table steps the table', () => {
    for (const [id, airway, turns] of [
      ['cryo-kidney', ['sedationGiven'], ['rollBack']],
      ['cryo-lung', ['induction', 'breathingTube', 'extubate', 'breathingAlone'], ['turnProne', 'turnBack']],
      ['cryo-liver', ['deepSedation', 'wakes'], ['turnProne', 'turnBack']],
    ] as const) {
      for (const stepId of airway) expect(plan(id, stepId, at(id, stepId)).map((x) => x.id), `${id} ${stepId}`).toEqual(['ct.head'])
      for (const stepId of turns) expect(plan(id, stepId, at(id, stepId)).map((x) => x.id), `${id} ${stepId}`).toEqual(['ct.turn'])
      for (const stepId of ['monitorsOn', 'skinPrep', 'drapes', 'removeDrapes']) {
        if (compiledFor(id)!.script.steps.some((s) => s.id === stepId)) expect(plan(id, stepId, at(id, stepId)).map((x) => x.id), `${id} ${stepId}`).toEqual(['ct.table'])
      }
      for (const stepId of ['wheelsIn', 'ontoTable', 'signIn', 'timeOut', 'signOut', 'wheelsOut']) expect(plan(id, stepId, at(id, stepId)).map((x) => x.id), `${id} ${stepId}`).toEqual(['ct.establish'])
    }
    // the turn shows the patient from head to foot
    const view = at('cryo-lung', 'turnProne')
    const s = SHOTS['ct.turn']
    shotPoseInto(s, ctx, eye, target)
    const t = CRYO_SUITE.ct.table
    expect(inFrustum(eye, target, s.fov, { x: t.out.x - 0.85, y: 0.95, z: t.out.z })).toBe(true)
    expect(inFrustum(eye, target, s.fov, { x: t.out.x + 1.2, y: 0.9, z: t.out.z })).toBe(true)
    expect(view.focus).toBe('ctHead')
  })

  it('has no shot of this room whose lens, area or inset is off', () => {
    for (const s of shotsOfRoom('cryo')) {
      expect(['l2Cryo', 'l2CryoControl']).toContain(s.area)
      if (s.inset !== undefined) expect(['ctLive', 'ctPlan']).toContain(s.inset)
      if (s.insetBig === true) expect(s.inset).toBeDefined()
    }
  })
})

describe('the ultrasound room\'s shots by what they show', () => {
  const ctx = newAnchorCtx()
  const eye: Vec3 = { x: 0, y: 0, z: 0 }
  const target: Vec3 = { x: 0, y: 0, z: 0 }
  const at = (id: ProcedureId, stepId: string): ProcedureView => {
    const i = compiledFor(id)!.script.steps.findIndex((s) => s.id === stepId)
    expect(i, `${id} ${stepId}`).toBeGreaterThanOrEqual(0)
    const view = fillStepView(emptyProcedureView(), id, i, SURGERY.cart.park.at)
    syncAnchorCtx(ctx, view, null, null)
    return view
  }
  const plan = (id: ProcedureId, stepId: string, view: ProcedureView) => shotPlanFor('us', id, stepId, view.focus, view.roles).map((c) => SHOTS[c.shot])

  it('the room is shown wide from its south-east corner, high, with the couch and the cart in frame', () => {
    const s = SHOTS['us.establish']
    expect(s.kind).toBe('wide')
    expect(ROOM_DEFAULT.us.map((c) => c.shot)).toEqual(['us.establish'])
    shotPoseInto(s, ctx, eye, target)
    const r = areaById('ultrasound').rect
    expect(Math.min(eye.x - r.x0, r.x1 - eye.x)).toBeLessThan(1.5)
    expect(Math.min(eye.z - r.z0, r.z1 - eye.z)).toBeLessThan(1.5)
    expect(eye.y).toBeGreaterThanOrEqual(2.3)
    const u = IMAGING.us
    expect(inFrustum(eye, target, s.fov, { x: u.table.in.x, y: 0.9, z: u.table.in.z })).toBe(true)
    expect(inFrustum(eye, target, s.fov, { x: u.machine.x, y: 1.0, z: u.machine.z })).toBe(true)
  })

  it('the survey, the placement and the freezes show the field with the ultrasound picture small, then big; the plain steps the field alone', () => {
    for (const id of ['us-breastCancer', 'us-fibroadenoma'] as const) {
      for (const stepId of ['surveyMarks', 'localAnaesthetic', 'skinNick', 'probeIn', 'saline']) {
        const p = plan(id, stepId, at(id, stepId))
        expect(p.map((x) => x.id), `${id} ${stepId}`).toEqual(['us.fieldUs', 'us.fieldUsBig'])
        expect(p[0].inset).toBe('us')
        expect(p[0].insetBig).toBeUndefined()
        expect(p[1].insetBig).toBe(true)
      }
      for (const stepId of ['freeze1', 'thaw', 'freeze2', 'thawFree']) {
        const p = plan(id, stepId, at(id, stepId))
        expect(p.map((x) => x.id), `${id} ${stepId}`).toEqual(['us.fieldUs', 'us.fieldUsBig'])
      }
      for (const stepId of ['prepSkin', 'probeOut', 'dressing', 'coldPack']) expect(plan(id, stepId, at(id, stepId)).map((x) => x.id), `${id} ${stepId}`).toEqual(['us.field'])
      for (const stepId of ['patientArrives', 'changeGown', 'lieDown', 'drape', 'timeOut', 'signOut', 'walkOut']) expect(plan(id, stepId, at(id, stepId)).map((x) => x.id), `${id} ${stepId}`).toEqual(['us.establish'])
      expect(plan(id, 'consoleCheck', at(id, 'consoleCheck')).map((x) => x.id)).toEqual(['us.prosense'])
      expect(plan(id, 'programme', at(id, 'programme')).map((x) => x.id)).toEqual(['us.prosense'])
    }
    expect(plan('us-fibroadenoma', 'relocate', at('us-fibroadenoma', 'relocate')).map((x) => x.id)).toEqual(['us.fieldUs', 'us.fieldUsBig'])
  })

  it('the field shot stands behind the radiologist\'s shoulder (west of the couch) with the breast and the ProSense screen in frame', () => {
    const s = SHOTS['us.field']
    const view = at('us-breastCancer', 'probeIn')
    shotPoseInto(s, ctx, eye, target)
    const breast = { x: 0, y: 0, z: 0 }
    anchorInto('breast', ctx, breast)
    expect(target).toEqual(breast)
    const doc = IMAGING.us.procedure!.doctor.at
    expect(Math.hypot(eye.x - doc.x, eye.z - doc.z)).toBeLessThan(1.2)
    expect(eye.x).toBeLessThan(IMAGING.us.table.in.x)
    expect(inFrustum(eye, target, s.fov, breast)).toBe(true)
    const prosense = { x: 0, y: 0, z: 0 }
    anchorInto('prosenseScreen', ctx, prosense)
    expect(view.focus).toBe('breast')
    // the console shot looks at its screen, over the sonographer's shoulder
    const c = SHOTS['us.prosense']
    shotPoseInto(c, ctx, eye, target)
    expect(target).toEqual(prosense)
    expect(inFrustum(eye, target, c.fov, prosense)).toBe(true)
  })

  it('has no shot of this room whose area or inset is off, and the watch spot is outside the door, in the imaging hall', () => {
    for (const s of shotsOfRoom('us')) {
      expect(s.area).toBe('ultrasound')
      if (s.inset !== undefined) expect(s.inset).toBe('us')
    }
    const spot = WATCH_ROOMS.us.spot.at
    expect(areaById('imagingHall').rect.z1).toBeGreaterThan(spot.z)
    expect(spot.z).toBeGreaterThan(areaById('imagingHall').rect.z0)
    expect(Math.abs(spot.x - -32.6)).toBeLessThan(0.01)
  })
})

describe('the rooms\' watch spots and obstacles', () => {
  it('the CT suite is watched from its control room, behind the glass; the theatre from its corridor', () => {
    expect(WATCH_ROOMS.cryo.spot).toBe(CRYO_SUITE.viewing)
    expect(WATCH_ROOMS.cryo.area).toBe('l2Cryo')
    const r = areaById('l2CryoControl').rect
    expect(WATCH_ROOMS.cryo.spot.at.z).toBeGreaterThan(r.z0)
    expect(WATCH_ROOMS.cryo.spot.at.z).toBeLessThan(r.z1)
    expect(WATCH_ROOMS.or.spot).toBe(SURGERY.viewing)
  })

  it('the CT cradle obstacle rides with the table and replaces the table\'s footprint; the robot, the anaesthesia machine and the gantry are in', () => {
    const obs = roomObstacles('cryo', footprints)
    expect(obs.cartSlot).toBeGreaterThanOrEqual(0)
    const slotsAt = (x: number, z: number, y = 1.0): boolean => insideObstacle(obs.obstacles, x, y, z, 0, 0) >= 0
    const fakeSim = (tablePos: number) => ({ cryoSuite: { state: { tablePos } } }) as unknown as WatchSim
    const table = footprints.find((f) => f.id === 'l2:cryo:ct:table')!
    // table out: the cradle is at the footprint (the cradle's centre is the layout's)
    let c = roomCart(fakeSim(0), 'cryo')!
    expect(c.x).toBeCloseTo(table.x, 9)
    expect(c.z).toBeCloseTo(table.z, 9)
    expect(CRADLE.halfLength).toBeCloseTo(table.hw, 9)
    moveObstacle(obs.obstacles, obs.cartSlot, c.x, c.z, c.heading)
    expect(slotsAt(table.x, table.z)).toBe(true)
    expect(slotsAt(table.x + 1.3, table.z + 0.1)).toBe(true) // the feet
    // table in: the old place is free again, the cradle is in the bore
    c = roomCart(fakeSim(1), 'cryo')!
    moveObstacle(obs.obstacles, obs.cartSlot, c.x, c.z, c.heading)
    expect(slotsAt(table.x + 1.3, table.z)).toBe(false)
    expect(c.x).toBeLessThan(table.x - 2)
    expect(slotsAt(c.x, c.z)).toBe(true)
    for (const id of [':cryo:robot', ':cryo:anaes', ':cryo:ct:gantry', ':cryo:console']) {
      const f = footprints.find((q) => q.id.endsWith(id))!
      expect(slotsAt(f.x, f.z, 0.5), id).toBe(true)
    }
    // the moving machine is the cradle only in the CT suite and the cart only in the theatre; the ultrasound room has none
    expect(roomObstacles('us', footprints).cartSlot).toBe(-1)
    expect(roomCart({} as WatchSim, 'us')).toBeNull()
    // the ultrasound room: the couch (with the patient), the cart, the stool, the counter, the cabinet and the ProSense console
    const us = roomObstacles('us', footprints)
    for (const f of footprints.filter((q) => q.area === 'ultrasound')) expect(insideObstacle(us.obstacles, f.x, 0.5, f.z, 0, 0), f.id).toBeGreaterThanOrEqual(0)
  })

  it('knows the height of every piece of furniture in the two rooms (none falls back to 2.2 m but the tall ones)', () => {
    for (const f of footprints.filter((q) => ['l2Cryo', 'l2CryoControl', 'ultrasound'].includes(q.area as string) && !q.overhead)) {
      const tall = /gantry|us:cabinet/.test(f.id)
      expect(furnitureTop(f.id) < 2.2 || tall, f.id).toBe(true)
    }
  })
})
