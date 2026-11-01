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
import { PROCEDURE_SCRIPTS } from '@/content/procedures'
import { LEVEL2_DX, LEVEL_Y, toDisplayInto } from '@/sim/levels'
import { SURGERY, areaById, type AreaId } from '@/sim/places'
import { anchorSpot, applyRoleViews, compiledFor, emptyProcedureView, focusPointInto, newRoleViews, newTargetCtx, setTable } from '@/sim/procedure'
import type { ProcedureId, ProcedureView, Vec3 } from '@/sim/types'
import { anchorInto, newAnchorCtx, syncAnchorCtx } from './anchors'
import { BODY_RADIUS, BODY_TOP, CEILING_MARGIN, ROOM_MARGIN, addPerson, clampEyeInto, furnitureTop, moveObstacle, newPeople, segmentClearOfPeople } from './limits'
import { roomObstacles, roomOfProcedure } from './rooms'
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
    for (const s of shotsOfRoom('or')) {
      expect(s.fov, s.id).toBeGreaterThanOrEqual(FOV_RANGE[0])
      expect(s.fov, s.id).toBeLessThanOrEqual(FOV_RANGE[1])
      expect(() => areaById(s.area), s.id).not.toThrow()
      expect(SHOTS[s.id]).toBe(s)
    }
    for (const plan of Object.values(ROOM_DEFAULT)) for (const c of plan) expect(SHOTS[c.shot], c.shot).toBeDefined()
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

  it('converts every eye to where it is drawn on level 2', () => {
    const out = { x: 0, y: 0, z: 0 }
    for (const s of shotsOfRoom('or')) {
      toDisplayInto(s.eye, out)
      expect(out.x).toBeCloseTo(s.eye.x - LEVEL2_DX, 9)
      expect(out.y).toBeCloseTo(s.eye.y + LEVEL_Y[2], 9)
      expect(out.z).toBe(s.eye.z)
    }
  })
})
