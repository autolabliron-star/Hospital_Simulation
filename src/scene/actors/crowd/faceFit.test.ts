/**
 * R5: the surgical mask of the realistic people. One pleated shell on the unit sphere (attire.ts), fitted on each avatar's face (avatars.ts measureFaceFit:
 * the bridge of the nose to under the chin, cheek to cheek), framed on the head by the model (MASK_FRAME) and drawn by one mesh on the props material.
 * Node only: the converted index and glbs are read from public/assets/people.
 */
import { describe, expect, it } from 'vitest'
import { ATTIRE, type Entity } from '@/sim/types'
import { MASK_FRAME, P } from './constants'
import { FACE_GROW_MAX, FACE_INNER, FACE_PAD, MASK_BAND, faceUnit, measureFaceFit } from './avatars'
import { cpuMesh, loadPeopleFromDisk, readIndex, rowParts } from './avatars.testkit'
import { attachPeople, createCrowdRig, driveCrowd, faceFitOfBody } from './crowdRig'
import { MASK_BAND as SHELL, maskPoint } from './attire'

const INDEX = readIndex()

/** The bind-space vertices of an avatar's LOD 0 that belong to its head (at least half their weight on it). */
function headPoints(m: ReturnType<typeof cpuMesh>): number[][] {
  const out: number[][] = []
  for (let v = 0; v < m.count; v++) {
    let w = 0
    for (let k = 0; k < 4; k++) if (Math.round(m.joints[v * 4 + k]) === P.head) w += m.weights[v * 4 + k]
    if (w >= 0.5) out.push([m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]])
  }
  return out
}

describe('the mask on every avatar', () => {
  it('covers the face from the bridge of the nose to under the chin with at most 8 mm to spare over the nose and the chin', async () => {
    const loaded = await loadPeopleFromDisk()
    const report: string[] = []
    for (const a of loaded.avatars) {
      const m = cpuMesh(a.lods[0])
      const fit = measureFaceFit(m.pos, m.joints, m.weights, m.count)
      expect(fit, a.entry.id).not.toBeNull()
      const f = fit!
      const head = headPoints(m)
      // the nose tip: the most forward head point 10 to 20 cm under the crown; the chin: the lowest in front under it
      const top = Math.max(...head.map((p) => p[1]))
      const nose = head.filter((p) => p[1] < top - 0.1 && p[1] > top - 0.2).reduce((b, p) => (p[2] > b[2] ? p : b))
      const chin = head.filter((p) => p[1] < nose[1] && p[2] > nose[2] - 0.045 && Math.abs(p[0] - nose[0]) < 0.035).reduce((b, p) => (p[1] < b[1] ? p : b), nose)
      // the gap: the nearest the mask's (smooth, unpleated) shell comes to a point of the face, sampled finely over the band
      const shell: number[][] = []
      for (let i = 0; i <= 60; i++) {
        for (let j = 0; j <= 60; j++) {
          const th = -MASK_BAND.theta + (2 * MASK_BAND.theta * j) / 60
          const ph = -MASK_BAND.phiLow + ((MASK_BAND.phi + MASK_BAND.phiLow) * i) / 60
          shell.push([f.cx + f.rx * Math.sin(th) * Math.cos(ph), f.cy + f.ry * Math.sin(ph) * (ph > 0 ? MASK_BAND.top : 1), f.cz + f.rz * Math.cos(th) * Math.cos(ph)])
        }
      }
      const gap = (p: number[]): number => Math.min(...shell.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])))
      for (const [name, p] of [
        ['nose', nose],
        ['chin', chin],
      ] as const) {
        const u = faceUnit(f, p[0], p[1], p[2])
        expect(u.covered, `${a.entry.id} ${name} covered`).toBe(true)
        expect(u.len, `${a.entry.id} ${name} inside`).toBeLessThanOrEqual(1 + 1e-6)
        expect(gap(p), `${a.entry.id} ${name} gap`).toBeLessThanOrEqual(0.008)
      }
      // every face point in the middle of the band is under it (the fit grew for it); the band's rim rests on the face
      let worst = 0
      for (const p of head) {
        const u = faceUnit(f, p[0], p[1], p[2], FACE_INNER)
        if (u.covered) worst = Math.max(worst, u.len)
      }
      expect(worst, a.entry.id).toBeLessThanOrEqual(1.001)
      // the band reaches from above the nose tip to below the chin, and over the mouth's corners
      expect(f.cy + f.ry * MASK_BAND.top * Math.sin(MASK_BAND.phi), a.entry.id).toBeGreaterThan(nose[1] + 0.015)
      expect(f.cy - f.ry * Math.sin(MASK_BAND.phiLow), a.entry.id).toBeLessThan(chin[1] + 0.002)
      expect(f.rx * Math.sin(MASK_BAND.theta), a.entry.id).toBeGreaterThan(0.045)
      // the mouth (a patient's breathing tube) is between the nose and the chin, in front
      expect(f.mouth[1]).toBeLessThan(nose[1])
      expect(f.mouth[1]).toBeGreaterThan(chin[1])
      expect(f.mouth[2]).toBeGreaterThan(nose[2] - 0.03)
      report.push(`${a.entry.id}: nose gap ${(gap(nose) * 1000).toFixed(1)} mm, chin gap ${(gap(chin) * 1000).toFixed(1)} mm`)
    }
    console.log(`mask fit: ${report.join('; ')}`)
    expect(FACE_PAD).toBeLessThan(0.008)
    expect(FACE_GROW_MAX).toBeGreaterThan(1)
  }, 60_000)

  it('the shell is the band of the fit: its corners at the band edges, the pleats standing out a little', () => {
    const c0 = maskPoint(0, 0)
    expect(Math.asin(c0[1] / Math.hypot(...c0))).toBeCloseTo(-MASK_BAND.phiLow, 6)
    // the upper half is taller
    expect(maskPoint(SHELL.cols / 2, SHELL.rows)[1]).toBeCloseTo(MASK_BAND.top * Math.sin(MASK_BAND.phi), 6)
    expect(Math.atan2(c0[0], c0[2])).toBeCloseTo(-MASK_BAND.theta, 6)
    expect(Math.hypot(...maskPoint(SHELL.cols / 2, 1))).toBeGreaterThan(1)
    expect(Math.hypot(...maskPoint(SHELL.cols / 2, 2))).toBeCloseTo(1, 9)
  })

  it('is framed on the face of every masked avatar and drawn by one mesh; nobody else wears it', async () => {
    const loaded = await loadPeopleFromDisk()
    const rig = createCrowdRig()
    attachPeople(rig, loaded)
    const es = new Map<string, Entity>()
    const ent = (id: string, x: number, attire: number): Entity => ({ id, role: 'doctor', name: id, outfit: 'theatre', position: { x, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', emote: 'none', mood: 'neutral', tier: 'near', variant: 3, attire }) as Entity
    for (let i = 0; i < 4; i++) es.set(`m${i}`, ent(`m${i}`, i, ATTIRE.mask | ATTIRE.gown | ATTIRE.gloves))
    es.set('plain', ent('plain', 5, 0))
    for (let f = 0; f < 10; f++) driveCrowd(rig, es, 2, 1.7, 4, 1 / 60, f / 60)
    expect(rig.model.stats.masks).toBe(4)
    expect(rig.model.stats.gowns).toBe(4)
    expect(rig.avatars!.mask.visible).toBe(true)
    expect(rig.avatars!.gown.visible).toBe(true)
    for (let i = 0; i < 4; i++) {
      const p = rig.model.get(`m${i}`)!
      const parts = rowParts(rig.model.data, p.row)
      const m = parts.subarray(MASK_FRAME * 12, MASK_FRAME * 12 + 12)
      // the frame maps the unit shell's front (0, 0, 1) onto the face (root frame: face height, in front of the body), its axes scaled to the fit
      expect(m[7] + m[6]).toBeGreaterThan(1.35)
      expect(m[7] + m[6]).toBeLessThan(1.75)
      expect(m[11] + m[10]).toBeGreaterThan(0.02)
      expect(m[11] + m[10]).toBeLessThan(0.25)
      expect(Math.hypot(m[0], m[4], m[8])).toBeGreaterThan(0.03)
      expect(Math.hypot(m[0], m[4], m[8])).toBeLessThan(0.15)
    }
    for (const f of loaded.avatars.map((a) => faceFitOfBody(a.lods[0]))) expect(f).not.toBeNull()
    expect(INDEX.avatars.length).toBe(loaded.avatars.length)
    rig.dispose()
  }, 60_000)
})
