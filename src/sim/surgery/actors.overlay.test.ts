/**
 * R5: a `Staffer`'s procedure overlay. At the task's spot the person carries the step's action, tools, work point and progress on their entity
 * (`act`) and looks where the task says (`lookAt`), but never over a glance at the player; walking clears both; setting the same task again
 * updates the pose in place without sending anybody anywhere.
 */
import { describe, expect, it } from 'vitest'
import type { Staffer, Task } from './actors'
import { DT, suite } from './testkit'
import type { Vec3 } from '../types'

function surgeonAtSpot(): { h: ReturnType<typeof suite>; s: Staffer; task: Task; step: (n?: number) => void } {
  const h = suite(2026, { crowd: false, hour: 8 })
  const s = h.personById('or-surgeon') as Staffer
  expect(s).not.toBeNull()
  s.engagedBy = 'test'
  const task: Task = {
    key: 'test:spot',
    at: { x: s.walker.x + 0.5, z: s.walker.z + 0.5 },
    face: 0,
    anim: 'give',
    act: 'skinPrep',
    left: 'none',
    right: 'prepStick',
    work: { x: 1, y: 1, z: 2 },
    look: { x: 3, y: 1.2, z: 4 },
    progress: () => 0.25,
  }
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) h.step(DT)
  }
  s.setTask(task)
  for (let i = 0; i < 60 * 30 && !s.isAt(task.key); i++) h.step(DT)
  expect(s.isAt(task.key)).toBe(true)
  step(2)
  return { h, s, task, step }
}

describe('Staffer: the R5 pose overlay', () => {
  it('writes the action, tools, work point and progress on the entity at the spot, and the gaze point', () => {
    const { s } = surgeonAtSpot()
    const act = s.entity.act!
    expect(act).toBeTruthy()
    expect(act.action).toBe('skinPrep')
    expect(act.right).toBe('prepStick')
    expect(act.left).toBe('none')
    expect(act.progress).toBe(0.25)
    expect(act.work).toEqual({ x: 1, y: 1, z: 2 })
    expect(s.entity.lookAt).toEqual({ x: 3, y: 1.2, z: 4 })
    expect(s.entity.anim).toBe('give')
  })

  it('reads the progress getter every tick, clamped to 0..1, and reuses one act object', () => {
    const { s, task, step } = surgeonAtSpot()
    const first = s.entity.act
    let p = 0.6
    task.progress = () => p
    step()
    expect(s.entity.act!.progress).toBe(0.6)
    p = 7
    step()
    expect(s.entity.act!.progress).toBe(1)
    p = -3
    step()
    expect(s.entity.act!.progress).toBe(0)
    task.progress = 0.4
    step()
    expect(s.entity.act!.progress).toBe(0.4)
    expect(s.entity.act).toBe(first)
  })

  it('follows a moving look point (the task\'s object is read every tick, the entity keeps its own copy)', () => {
    const { s, task, step } = surgeonAtSpot()
    const look = task.look as Vec3
    const mine = s.entity.lookAt
    look.x = 9
    step()
    expect(s.entity.lookAt!.x).toBe(9)
    expect(s.entity.lookAt).toBe(mine)
    expect(s.entity.lookAt).not.toBe(look)
  })

  it('leaves the eyes to a glance (reactions.ts) while one is on, and takes them back after', () => {
    const { s, step } = surgeonAtSpot()
    const glance: Vec3 = { x: -5, y: 1.6, z: -5 }
    s.entity.lookAt = glance
    step(3)
    expect(s.entity.lookAt).toBe(glance)
    s.entity.lookAt = null
    step()
    expect(s.entity.lookAt).toEqual({ x: 3, y: 1.2, z: 4 })
  })

  it('updates the pose in place when the same task comes again, without walking', () => {
    const { s, task, step } = surgeonAtSpot()
    const x = s.walker.x
    const z = s.walker.z
    const next: Task = { key: task.key, at: { x: 50, z: 50 }, face: 1, anim: 'tablet', act: 'checklist', left: 'tablet', right: 'none', work: null, look: null, progress: () => 0.9 }
    s.setTask(next)
    step(3)
    expect(s.task!.key).toBe('test:spot')
    expect(s.walker.x).toBe(x)
    expect(s.walker.z).toBe(z)
    expect(s.entity.act!.action).toBe('checklist')
    expect(s.entity.act!.left).toBe('tablet')
    expect(s.entity.act!.progress).toBe(0.9)
    expect(s.entity.act!.work).toBeNull()
    expect(s.entity.lookAt).toBeNull()
    expect(s.idleAnim).toBe('tablet')
    expect(s.entity.anim).toBe('tablet')
  })

  it('clears the overlay while walking to another spot, and for a task with no action', () => {
    const { s, step } = surgeonAtSpot()
    s.setTask({ key: 'test:far', at: { x: s.walker.x + 4, z: s.walker.z + 4 }, face: 0, anim: 'idle', act: 'watchField', look: { x: 1, y: 1, z: 1 } })
    step(2)
    expect(s.done).toBe(false)
    expect(s.entity.act).toBeNull()
    expect(s.entity.lookAt).toBeNull()
    for (let i = 0; i < 60 * 30 && !s.isAt('test:far'); i++) step()
    step(2)
    expect(s.entity.act!.action).toBe('watchField')
    s.setTask({ key: 'test:plain', at: { x: s.walker.x, z: s.walker.z }, face: 0, anim: 'idle' })
    for (let i = 0; i < 60 * 30 && !s.isAt('test:plain'); i++) step()
    step(2)
    expect(s.entity.act).toBeNull()
    expect(s.entity.lookAt).toBeNull()
  })
})
