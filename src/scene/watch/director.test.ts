/**
 * R5: the watch director's lease and its frames, in node with a real three.js camera, the building's real walls and a fake player and sim
 * (testkit.ts). The lease state machine from walk mode and from the overview (and the exact hand-back), reduced motion (cuts only), a Jump
 * (a clean exit) and our own skip (not an exit), the shots by step and progress, the case ending, and free look.
 */
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { SURGERY } from '@/sim/places'
import { LEVEL2_DX, LEVEL_Y } from '@/sim/levels'
import { DIP_SECONDS, DOLLY_MAX_SECONDS } from './dolly'
import { ENDED_HOLD_SECONDS, FREE_IDLE_SECONDS, REPICK_SECONDS, WATCH_NEAR } from './director'
import { addPerson, newPeople, segmentClearOfPeople } from './limits'
import { SHOTS } from './shots'
import { fillStepView, harness, stepIndexOf } from './testkit'

const ID = 'or-cholecystectomy' as const
const VIEWING = SURGERY.viewing.at

/** The camera is drawn where the shot's sim eye is (level 2: x - 150, y + 4.2). */
function expectDrawnAt(camera: { position: { x: number; y: number; z: number } }, eye: { x: number; y: number; z: number }, digits = 6): void {
  expect(camera.position.x).toBeCloseTo(eye.x - LEVEL2_DX, digits)
  expect(camera.position.y).toBeCloseTo(eye.y + LEVEL_Y[2], digits)
  expect(camera.position.z).toBeCloseTo(eye.z, digits)
}

describe('the watch lease from walk mode', () => {
  it('takes the lens, stands you at the viewing window, cuts into the room, and hands back exactly the pose you had', () => {
    const h = harness({ phase: 'walk', x: -20, z: 3 })
    const before = { pos: h.camera.position.clone(), dir: h.camera.getWorldDirection(new Vector3()), fov: h.camera.fov, near: h.camera.near }
    expect(h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })).toBe(true)
    expect(h.lease.held).toBe(true)
    expect(h.director.phase).toBe('entering')
    // you stand at the corridor's viewing window, but the picture is still yours until the cut
    expect([h.player.x, h.player.z]).toEqual([VIEWING.x, VIEWING.z])
    expect(h.player.calls).not.toContain('requestWalk')
    expect(h.camera.position.distanceTo(before.pos)).toBeLessThan(1e-9)

    // first frame: live. The room is another place: a cut behind a dip to black, the camera held until the screen is black
    h.director.update(1 / 60)
    expect(h.director.phase).toBe('live')
    expect(h.ui.dip).toBe(1)
    expect(h.director.shotId).toBe('or.establish') // no case yet: the room's default
    expect(h.camera.position.distanceTo(before.pos)).toBeLessThan(1e-6)
    h.run(DIP_SECONDS + 0.05)
    expectDrawnAt(h.camera, SHOTS['or.establish'].eye, 1)
    expect(h.camera.near).toBe(WATCH_NEAR)
    // walkCam.camera is the watch eye, in sim coordinates
    expect(h.simCamera.x).toBeCloseTo(h.director.pose.eye.x, 9)
    expect(h.simCamera.y).toBeCloseTo(h.director.pose.eye.y, 9)

    // exit: a dip, then the hand-back at black
    h.director.end()
    expect(h.director.phase).toBe('leaving')
    expect(h.ui.dip).toBe(2)
    expect(h.lease.held).toBe(true)
    h.run(DIP_SECONDS + 0.05)
    expect(h.director.phase).toBe('off')
    expect(h.lease.held).toBe(false)
    expect([h.player.x, h.player.z, h.player.heading]).toEqual([-20, 3, 0.4])
    expect(h.player.lastLook).toEqual({ yaw: 0.5, pitch: 0.12 })
    expect(h.camera.position.distanceTo(before.pos)).toBeLessThan(1e-9)
    expect(h.camera.getWorldDirection(new Vector3()).distanceTo(before.dir)).toBeLessThan(1e-9)
    expect(h.camera.fov).toBe(before.fov)
    expect(h.camera.near).toBe(before.near)
    expect(h.ui.phase).toBe('off')
  })

  it('refuses a second lease holder, and a request while watching switches what is watched', () => {
    const h = harness()
    h.lease.held = true
    expect(h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })).toBe(false)
    h.lease.held = false
    expect(h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })).toBe(true)
    h.director.update(1 / 60)
    expect(h.director.begin({ room: 'or', mode: 'follow', procedureId: null })).toBe(true)
    expect(h.ui.mode).toBe('follow')
    expect(h.director.phase).toBe('live')
  })
})

describe('the watch lease from the overview', () => {
  it('asks for your flight down, waits for it, and leaves with your own flight back to the shot and the panel you had', () => {
    const h = harness({ phase: 'overview', x: -30, z: -4 })
    h.level.value = 2
    h.area.value = 'l2Or'
    expect(h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })).toBe(true)
    expect(h.player.calls).toContain('requestWalk')
    expect(h.director.phase).toBe('entering')
    // the flight down is the player's: the director writes nothing until it lands
    const mid = h.camera.position.clone()
    h.run(0.5)
    expect(h.director.phase).toBe('entering')
    expect(h.camera.position.distanceTo(mid)).toBe(0)
    h.player.phase = 'walk'
    h.director.update(1 / 60)
    expect(h.director.phase).toBe('live')
    h.run(1)

    h.director.end()
    // the lens is the player's again at once: its flight out goes to the overview shot you were on, on your level
    expect(h.lease.held).toBe(false)
    expect(h.flights).toHaveLength(1)
    const pose = h.flights[0]!
    expect(pose.target.x).toBeCloseTo(-11, 9)
    expect(pose.target.z).toBeCloseTo(0, 9)
    expect(pose.distance).toBeCloseTo(Math.hypot(80, 66), 6)
    expect(h.level.value).toBe(2)
    expect(h.player.lastTarget).not.toBeNull() // the flight starts from the watch camera's look point
    expect(h.director.phase).toBe('leaving')
    // once it has landed you are put back where you stood, and the room panel reopens
    h.run(0.3)
    expect(h.director.phase).toBe('leaving')
    h.player.phase = 'overview'
    h.director.update(1 / 60)
    expect(h.director.phase).toBe('off')
    expect([h.player.x, h.player.z]).toEqual([-30, -4])
    expect(h.area.value).toBe('l2Or')
  })
})

describe('reduced motion', () => {
  it('moves by plain cuts: no dip, no dolly, the camera at each shot at once', () => {
    const h = harness({ reduced: true })
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    h.director.update(1 / 60)
    expect(h.ui.dip ?? 0).toBe(0)
    expectDrawnAt(h.camera, SHOTS['or.establish'].eye)
    // a step in the room: straight to its shot
    fillStepView(h.view, ID, stepIndexOf(ID, 'firstPort'), h.cart)
    h.director.update(1 / 60)
    expect(h.director.shotId).toBe('or.field')
    expect(h.director.moving).toBe(false)
    h.director.end()
    expect(h.director.phase).toBe('off')
    expect(h.ui.dip ?? 0).toBe(0)
  })
})

describe('a Jump and a skip', () => {
  it('a Jump (the generation changes) ends the watch at once and hands the camera back', () => {
    const h = harness()
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    h.run(1)
    h.gen.value++
    h.director.update(1 / 60)
    expect(h.director.phase).toBe('off')
    expect(h.lease.held).toBe(false)
    expect([h.player.x, h.player.z]).toEqual([-20, 3])
  })

  it('a Jump while you came from the overview flies you back out', () => {
    const h = harness({ phase: 'overview' })
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    h.player.phase = 'walk'
    h.run(0.5)
    h.gen.value++
    h.director.update(1 / 60)
    expect(h.lease.held).toBe(false)
    expect(h.flights).toHaveLength(1)
  })

  it('our own rebuilding skip does not end it (the case is looked for again)', () => {
    const h = harness()
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    h.run(0.5)
    h.director.expectGeneration()
    h.gen.value++
    h.director.update(1 / 60)
    expect(h.director.phase).toBe('live')
    // a second Jump is not ours
    h.gen.value++
    h.director.update(1 / 60)
    expect(h.director.phase).toBe('off')
  })
})

describe('the shots of a watched case', () => {
  it('follows the steps: the focus picks the shot, the console step changes to the big endoscope picture part-way, and dollies stay short', () => {
    const h = harness()
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    h.run(0.5)
    expect(h.ui.status).toBe('waiting')
    fillStepView(h.view, ID, stepIndexOf(ID, 'monitorsOn'), h.cart)
    h.director.update(1 / 60)
    expect(h.ui.status).toBe('case')
    expect(h.director.shotId).toBe('or.head')
    // establish -> head is inside the room and under 6 m: a dolly, not a cut
    expect(h.ui.dip).toBe(1)
    expect(h.director.moving).toBe(true)
    h.run(DOLLY_MAX_SECONDS + 0.1)
    expect(h.director.moving).toBe(false)
    h.run(3)
    const eye = h.director.pose.eye
    expect(Math.hypot(eye.x - SHOTS['or.head'].eye.x, eye.z - SHOTS['or.head'].eye.z)).toBeLessThan(0.25)

    h.cart.x = SURGERY.cart.dock.at.x
    h.cart.z = SURGERY.cart.dock.at.z
    fillStepView(h.view, ID, stepIndexOf(ID, 'fireflyCheck'), h.cart)
    h.director.update(1 / 60)
    expect(h.director.shotId).toBe('or.console')
    expect(h.ui.inset).toBe('endo')
    expect(h.ui.insetBig).toBe(false)
    h.view.progress = 0.7
    h.director.update(1 / 60)
    expect(h.director.shotId).toBe('or.endoBig')
    expect(h.ui.insetBig).toBe(true)
    // the next console step keeps the big picture from its start (it does not shrink back and grow again)
    fillStepView(h.view, ID, stepIndexOf(ID, 'criticalView'), h.cart)
    h.director.update(1 / 60)
    expect(h.director.shotId).toBe('or.endoBig')
    // the assistant's hands at the bedside: the 3D view of them, the endoscope small
    fillStepView(h.view, ID, stepIndexOf(ID, 'placeClips'), h.cart)
    h.director.update(1 / 60)
    expect(h.director.shotId).toBe('or.fieldInset')
    expect(h.ui.inset).toBe('endo')
    expect(h.ui.insetBig).toBe(false)
    // a step with another focus moves on
    fillStepView(h.view, ID, stepIndexOf(ID, 'releaseArms'), h.cart)
    h.director.update(1 / 60)
    expect(h.director.shotId).toBe('or.armsHigh')
    expect(h.ui.inset).toBeNull()
  })

  it('hands back a while after our case has left the room', () => {
    const h = harness()
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    fillStepView(h.view, ID, stepIndexOf(ID, 'wheelsOut'), h.cart)
    h.run(1)
    expect(h.ui.status).toBe('case')
    h.view.procedureId = null
    h.view.caseId = null
    h.view.version++
    h.director.update(1 / 60)
    expect(h.ui.status).toBe('ended')
    h.run(ENDED_HOLD_SECONDS - 0.5)
    expect(h.director.phase).toBe('live')
    h.run(1 + DIP_SECONDS + 0.1)
    expect(h.director.phase).toBe('off')
  })

  it("does not take another day's case for the watch case, but follows any case in follow mode", () => {
    const h = harness()
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    fillStepView(h.view, ID, 3, h.cart, 'dayCase', false)
    h.run(0.5)
    expect(h.ui.status).toBe('waiting')
    h.director.begin({ room: 'or', mode: 'follow', procedureId: null })
    h.director.update(1 / 60)
    expect(h.ui.status).toBe('case')
  })
})

describe('free look', () => {
  it('a drag orbits the look point; the director takes over again after 8 s without one', () => {
    const h = harness({ reduced: true })
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    h.director.update(1 / 60)
    const target = { ...h.director.pose.target }
    const eye0 = { ...h.director.pose.eye }
    h.director.look(120, 0)
    h.director.update(1 / 60)
    expect(h.ui.free).toBe('drag')
    const eye1 = h.director.pose.eye
    expect(Math.hypot(eye1.x - eye0.x, eye1.z - eye0.z)).toBeGreaterThan(0.2)
    // the look point stays (it orbits it) and the distance is kept
    expect(h.director.pose.target).toEqual(target)
    h.run(FREE_IDLE_SECONDS - 1)
    expect(h.ui.free).toBe('drag')
    h.run(1.1)
    expect(h.ui.free).toBe('off')
    expectDrawnAt(h.camera, SHOTS['or.establish'].eye, 1)
  })

  it('the button holds it until it is pressed again; the wheel stays within 0.6 to 3 m', () => {
    const h = harness({ reduced: true })
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    h.director.update(1 / 60)
    h.director.holdFreeLook(true)
    expect(h.ui.free).toBe('held')
    h.director.zoom(-100000)
    h.director.update(1 / 60)
    const p = h.director.pose
    expect(Math.hypot(p.eye.x - p.target.x, p.eye.y - p.target.y, p.eye.z - p.target.z)).toBeCloseTo(0.6, 1)
    h.run(FREE_IDLE_SECONDS + 1)
    expect(h.ui.free).toBe('held')
    h.director.holdFreeLook(false)
    h.director.update(1 / 60)
    expect(h.ui.free).toBe('off')
  })
})

describe('nobody in the way', () => {
  /** A point on the line from the head shot's designed eye to the mouth, `along` metres out horizontally (a body there blocks it; R5 wave 2: the head
   * shot looks from the head end now, 1.2 m from the mouth, so 0.6 m out is between the lens and the hands). */
  function onTheLine(h: ReturnType<typeof harness>, along: number): { x: number; z: number } {
    const eye = SHOTS['or.head'].eye
    const t = h.director.pose.target
    const dx = t.x - eye.x
    const dz = t.z - eye.z
    const l = Math.hypot(dx, dz)
    return { x: eye.x + (dx / l) * along, z: eye.z + (dz / l) * along }
  }

  function lineClear(h: ReturnType<typeof harness>, p: { x: number; z: number }): boolean {
    const people = newPeople()
    addPerson(people, p.x, p.z)
    return segmentClearOfPeople(h.director.pose.eye, h.director.pose.target, people)
  }

  it('a body between the lens and the look point: the director takes the first clear alternate, the same every time', () => {
    const eyes: string[] = []
    for (let run = 0; run < 2; run++) {
      const h = harness({ reduced: true })
      h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
      fillStepView(h.view, ID, stepIndexOf(ID, 'monitorsOn'), h.cart)
      h.director.update(1 / 60)
      expect(h.director.shotId).toBe('or.head')
      const p = onTheLine(h, 0.6)
      expect(lineClear(h, p)).toBe(false)
      // somebody steps into the line and stays there: after a moment the camera moves to a clear alternate of the same shot
      h.sim.entities.set('nurse', { position: { x: p.x, y: 0, z: p.z } })
      h.run(REPICK_SECONDS + 0.1)
      expect(h.director.shotId).toBe('or.head')
      expect(lineClear(h, p)).toBe(true)
      eyes.push(JSON.stringify(h.director.pose.eye))
    }
    expect(eyes[0]).toBe(eyes[1])
  })

  it('a new shot avoids a body at once; you and the patient on the table are not in the way', () => {
    const h = harness({ reduced: true })
    h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
    h.director.update(1 / 60)
    // you (the player's avatar) and the patient lying there are no obstacle
    h.sim.entities.set('player', { position: { x: 101.0, y: 0, z: 6.0 } })
    h.sim.entities.set('patient', { position: { x: 100.95, y: 0, z: 5.75 }, anim: 'lie' })
    fillStepView(h.view, ID, stepIndexOf(ID, 'monitorsOn'), h.cart)
    h.director.update(1 / 60)
    expect(h.director.pose.eye).toEqual(SHOTS['or.head'].eye)
    // somebody already standing in the line when the step begins
    fillStepView(h.view, ID, stepIndexOf(ID, 'signIn'), h.cart)
    const p = onTheLine(h, 0.6)
    h.sim.entities.set('nurse', { position: { x: p.x, y: 0, z: p.z } })
    fillStepView(h.view, ID, stepIndexOf(ID, 'wakeUp'), h.cart)
    h.director.update(1 / 60)
    expect(h.director.shotId).toBe('or.head')
    expect(h.director.pose.eye).not.toEqual(SHOTS['or.head'].eye)
    expect(lineClear(h, p)).toBe(true)
  })
})

describe('the sim speed', () => {
  it('is put back to what you had, however the watch ends', () => {
    for (const how of ['exit', 'caseEnd', 'jump'] as const) {
      const h = harness({ reduced: true })
      h.clock.speed = 1
      h.director.begin({ room: 'or', mode: 'watch', procedureId: ID })
      fillStepView(h.view, ID, stepIndexOf(ID, 'wheelsOut'), h.cart)
      h.run(0.5)
      h.clock.speed = 4 // the overlay's 4x
      if (how === 'exit') h.director.end()
      else if (how === 'jump') h.gen.value++
      else {
        h.view.procedureId = null
        h.view.caseId = null
        h.view.version++
        h.run(ENDED_HOLD_SECONDS + 0.2)
      }
      h.run(0.1)
      expect(h.director.phase, how).toBe('off')
      expect(h.clock.speed, how).toBe(1)
    }
  })
})
