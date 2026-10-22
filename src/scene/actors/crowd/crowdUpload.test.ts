/**
 * F-43: the crowd uploads only what is live. The pose texture goes up as far as the highest live row (never before the texture has been
 * uploaded in full, and again in full after a lost WebGL context), and the blob buffers go up for the live blobs only, with no per-frame object.
 */
import { BufferAttribute } from 'three'
import { describe, expect, it } from 'vitest'
import type { Entity } from '@/sim/types'
import { glContext } from '@/scene/glContext'
import { MAX_PEOPLE } from './constants'
import { createCrowdRig, driveCrowd, poseRows, uploadFirst } from './crowdRig'

function people(n: number): Map<string, Entity> {
  const out = new Map<string, Entity>()
  for (let i = 0; i < n; i++) {
    out.set(`p-${i}`, { id: `p-${i}`, role: 'nurse', name: `p-${i}`, position: { x: -10 + i * 0.7, y: 0, z: 8 }, heading: 0, speed: 0, anim: 'idle', emote: 'none', mood: 'neutral', tier: 'near', variant: i } as Entity)
  }
  return out
}

const drive = (rig: ReturnType<typeof createCrowdRig>, es: Map<string, Entity>, t: number) => driveCrowd(rig, es, -11, 9, 8, 1 / 60, t)

describe('uploadFirst', () => {
  it('sets one range of the first n elements and reuses the same object every time', () => {
    const attr = new BufferAttribute(new Float32Array(64), 1)
    uploadFirst(attr, 10)
    const first = attr.updateRanges[0]
    expect(attr.updateRanges).toEqual([{ start: 0, count: 10 }])
    attr.clearUpdateRanges() // what the renderer does after the upload
    uploadFirst(attr, 20)
    expect(attr.updateRanges).toHaveLength(1)
    expect(attr.updateRanges[0]).toBe(first)
    expect(attr.updateRanges[0]).toEqual({ start: 0, count: 20 })
  })
})

describe('the crowd rig uploads', () => {
  it('sends all rows until the texture has been uploaded, then only up to the highest live row', () => {
    const rig = createCrowdRig()
    const es = people(30)
    drive(rig, es, 0)
    expect(rig.upload.rows).toBe(MAX_PEOPLE) // not on the GPU yet: the storage must be allocated at the full height
    expect(rig.texture.image.height).toBe(MAX_PEOPLE)
    rig.texture.onUpdate?.(rig.texture) // what three calls after an upload
    expect(rig.upload.uploaded).toBe(true)
    drive(rig, es, 1 / 60)
    expect(rig.upload.rows).toBeLessThan(MAX_PEOPLE / 4)
    expect(rig.upload.rows).toBeGreaterThanOrEqual(30)
    expect(rig.texture.image.height).toBe(rig.upload.rows)
    // everyone leaves: the model frees every row, a handful of rows (never zero) still go up
    es.clear()
    for (let i = 0; i < 400; i++) drive(rig, es, 2 + i / 60)
    expect(rig.upload.rows).toBeGreaterThanOrEqual(1)
    expect(rig.upload.rows).toBeLessThanOrEqual(30)
    rig.dispose()
  })

  it('goes back to the full height after a context restore, until the texture is uploaded again', () => {
    const rig = createCrowdRig()
    const es = people(10)
    drive(rig, es, 0)
    rig.texture.onUpdate?.(rig.texture)
    drive(rig, es, 1 / 60)
    expect(rig.upload.rows).toBeLessThan(MAX_PEOPLE)
    glContext.epoch++
    expect(poseRows(rig.upload, rig.model)).toBe(MAX_PEOPLE)
    expect(rig.upload.uploaded).toBe(false)
    drive(rig, es, 2 / 60)
    expect(rig.texture.image.height).toBe(MAX_PEOPLE)
    rig.texture.onUpdate?.(rig.texture)
    drive(rig, es, 3 / 60)
    expect(rig.upload.rows).toBeLessThan(MAX_PEOPLE)
    rig.dispose()
  })

  it('uploads the live blobs only', () => {
    const rig = createCrowdRig()
    drive(rig, people(12), 0)
    const n = rig.blobs.count
    expect(n).toBeGreaterThan(0)
    expect(rig.blobs.instanceMatrix.updateRanges).toEqual([{ start: 0, count: n * 16 }])
    expect(rig.blobFade.updateRanges).toEqual([{ start: 0, count: n }])
    rig.dispose()
  })
})
