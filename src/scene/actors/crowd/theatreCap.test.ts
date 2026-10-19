/**
 * R2: the theatre cap of the realistic people. The converter dropped the Rocketbox avatars' own surgical caps, and the avatar mesh never draws the procedural
 * hair pieces, so a person drawn as an avatar in theatre scrubs wears the crowd's own cap: one geometry on the unit sphere (gear.ts theatreCap), fitted on each
 * avatar's skull (avatars.ts measureCapFit), framed on the head by the model (CAP_FRAME) and drawn by one mesh on the props material. Node only: the converted
 * index and glbs are read from public/assets/people.
 */
import { describe, expect, it } from 'vitest'
import type { Entity } from '@/sim/types'
import { CAP_FRAME, CAP_KIND, P, SLOT } from './constants'
import { CAP_COVER, CAP_GROW_MAX, CAP_PAD, THEATRE, capOverreach, capRadius, capRim, defaultCapFit, measureCapFit } from './avatars'
import { cpuMesh, loadPeopleFromDisk, readIndex, rowParts, skinAll } from './avatars.testkit'
import { attachPeople, capFitOfBody, createCrowdRig, driveCrowd } from './crowdRig'
import { CAP_RINGS, CAP_SEG, buildCapGeometry } from './gear'
import { CrowdModel, type FrameInput } from './model'

const INDEX = readIndex()

function ent(o: Partial<Entity> & { id: string }): Entity {
  return { role: 'nurse', name: o.id, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, anim: 'idle', emote: 'none', mood: 'neutral', tier: 'near', variant: 1, ...o } as Entity
}

function frame(entities: Map<string, Entity>, cam: [number, number, number], t: number): FrameInput {
  return { dt: 1 / 60, time: t, camX: cam[0], camY: cam[1], camZ: cam[2], entities, followId: null, selectedId: null, hoverId: null, driven: null }
}

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

describe('the cap geometry', () => {
  it('is one small dome of kind CAP_KIND in the hair colour slot, its rim above the brows and down the nape', () => {
    const g = buildCapGeometry()
    expect(g.total).toBe(CAP_SEG * (CAP_RINGS - 1) * 2 + CAP_SEG)
    expect(g.total).toBeLessThan(300)
    expect(g.triangles[CAP_KIND]).toBe(g.total)
    const part = g.geometry.getAttribute('aPart')
    for (let i = 0; i < part.count; i++) {
      expect(part.getX(i)).toBe(CAP_KIND)
      expect(part.getY(i)).toBe(SLOT.hair)
    }
    // the rim: high in front, over the ears at the sides, low behind
    expect(capRim(1)).toBeGreaterThan(0.15)
    expect(Math.abs(capRim(0))).toBeLessThan(0.1)
    expect(capRim(-1)).toBeLessThan(-0.5)
    // a bouffant: fuller behind than in front, never smaller than the skull
    expect(capRadius(-1, 0)).toBeGreaterThan(capRadius(1, 0))
    for (let f = -1; f <= 1; f += 0.25) for (let lat = -0.7; lat <= Math.PI / 2; lat += 0.2) expect(capRadius(f, lat)).toBeGreaterThanOrEqual(1)
    // squarer than a sphere between the axes, 1 on them (so the fit's radii are the cap's extents)
    expect(capRadius(0, Math.PI / 4)).toBeGreaterThan(1.05)
    expect(capRadius(1, Math.PI / 2)).toBeCloseTo(1, 9)
    // the crown is the unit pole (the frame puts it CAP_PAD over the skull's top)
    const pos = g.geometry.getAttribute('position')
    let top = -Infinity
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i))
    expect(top).toBeCloseTo(1, 6)
  })
})

describe('the cap fitted on every avatar', () => {
  it('sits on the skull: centred over the head, the size of a head, and the hair and scalp under it stay inside', async () => {
    const loaded = await loadPeopleFromDisk()
    const lines: string[] = []
    const ratios: [string, number][] = []
    for (const a of loaded.avatars) {
      const fit = capFitOfBody(a.lods[0])!
      expect(fit, a.entry.id).not.toBeNull()
      const pts = headPoints(cpuMesh(a.lods[0]))
      const top = Math.max(...pts.map((p) => p[1]))
      // the dome's top is CAP_PAD over the head's highest point (more where it grew round a bun)
      expect(fit.cy + fit.ry - top, a.entry.id).toBeGreaterThanOrEqual(CAP_PAD - 1e-9)
      expect(fit.cy + fit.ry - top, a.entry.id).toBeLessThan(CAP_PAD + 0.015)
      // a head's size, padded (hair buns make some deeper)
      expect(fit.rx, a.entry.id).toBeGreaterThan(0.08)
      expect(fit.rx, a.entry.id).toBeLessThan(0.13)
      expect(fit.rz, a.entry.id).toBeGreaterThan(0.1)
      expect(fit.rz, a.entry.id).toBeLessThan(0.17)
      // centred on the head, a little forward of the neck (the head's bind frame: B_head^-1 = [I | t], the neck base at -t)
      const t = a.entry.bindInverse.slice(P.head * 12, P.head * 12 + 12)
      expect(Math.abs(fit.cx + t[3]), a.entry.id).toBeLessThan(0.02)
      expect(fit.cz + t[11], a.entry.id).toBeGreaterThan(-0.04)
      expect(fit.cz + t[11], a.entry.id).toBeLessThan(0.05)
      // what the cap covers (CAP_COVER in from its rim) is inside it: the scalp and the hair, not poking through
      let covered = 0
      let inside = 0
      for (const [x, y, z] of pts) {
        const k = capOverreach(fit, x, y, z)
        if (k === 0) continue
        covered++
        if (k <= 1 + 1e-9) inside++
      }
      expect(covered, a.entry.id).toBeGreaterThan(50)
      lines.push(`${a.entry.id} ${inside}/${covered}`)
      ratios.push([a.entry.id, inside / covered])
      // and the default (no mesh) fit is near the measured one
      const d = defaultCapFit(a.entry.body, t)
      expect(Math.abs(d.cy - fit.cy), a.entry.id).toBeLessThan(0.03)
    }
    // eslint-disable-next-line no-console
    console.log(`covered head vertices inside the cap: ${lines.join(', ')}`)
    // the theatre scrubs avatars are covered entirely; any other (worn when those are not loaded) all but a hair or two
    for (const [id, r] of ratios) expect(r, id).toBeGreaterThanOrEqual([...THEATRE.female, ...THEATRE.male].includes(id) ? 1 : 0.98)
  }, 60_000)

  it('measures nothing on a mesh without a head', () => {
    expect(measureCapFit([0, 1, 0], [P.chest, 0, 0, 0], [1, 0, 0, 0], 1)).toBeNull()
  })

  it('grows round a hairstyle that stands out of the dome, by at most CAP_GROW_MAX', () => {
    // a ring of scalp points, plus one tuft high at the back standing out of the dome: the cap grows to take it in
    const pos: number[] = []
    for (let i = 0; i < 24; i++) {
      const th = (i / 24) * Math.PI * 2
      pos.push(0.09 * Math.cos(th), 1.62, 0.11 * Math.sin(th))
    }
    pos.push(0, 1.73, 0)
    const n = pos.length / 3
    const joints = new Array<number>(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? P.head : 0))
    const weights = new Array<number>(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0))
    const plain = measureCapFit(pos, joints, weights, n)!
    expect(plain.rx).toBeCloseTo(0.09 + CAP_PAD, 6)
    pos.push(0, 1.7, -0.15)
    joints.push(P.head, 0, 0, 0)
    weights.push(1, 0, 0, 0)
    const grown = measureCapFit(pos, joints, weights, n + 1)!
    expect(capOverreach(grown, 0, 1.7, -0.15)).toBeLessThanOrEqual(1 + 1e-9)
    expect(grown.ry / plain.ry).toBeGreaterThan(1.01)
    expect(grown.ry / plain.ry).toBeLessThanOrEqual(CAP_GROW_MAX + 1e-9)
    expect(CAP_COVER).toBeGreaterThan(0)
  })
})

describe('the crowd model puts the cap on people in theatre scrubs', () => {
  const es = new Map<string, Entity>()
  es.set('or-scrub', ent({ id: 'or-scrub', role: 'nurse', outfit: 'theatre', position: { x: 0, y: 0, z: 3 } }))
  es.set('or-surgeon', ent({ id: 'or-surgeon', role: 'doctor', outfit: 'theatre', anim: 'walk', speed: 1.2, position: { x: 1.5, y: 0, z: 4 }, heading: 0.7 }))
  es.set('ward-nurse', ent({ id: 'ward-nurse', role: 'nurse', position: { x: -1.5, y: 0, z: 4 } }))
  es.set('player', ent({ id: 'player', role: 'doctor', outfit: 'theatre', position: { x: 0.5, y: 0, z: 5 } }))
  const cam: [number, number, number] = [0, 1.7, 0]

  it('lists a cap for every avatar in theatre scrubs (you included, beside your badge) and none for anybody else', async () => {
    const loaded = await loadPeopleFromDisk()
    const m = new CrowdModel()
    m.setAvatars(
      loaded.avatars.map((a) => a.entry),
      loaded.avatars.map((a) => capFitOfBody(a.lods[0])),
    )
    for (let f = 0; f < 20; f++) m.update(frame(es, cam, f / 60))
    const st = m.stats
    const rows = Array.from(m.capRows.subarray(0, st.caps))
    const theatre = ['or-scrub', 'or-surgeon', 'player'].map((id) => m.get(id)!)
    expect(st.caps).toBe(3)
    for (const p of theatre) {
      expect(rows, p.key).toContain(p.row)
      expect(p.look.hairStyle).toBe('theatreCap')
    }
    expect(rows).not.toContain(m.get('ward-nurse')!.row)
    // the theatre scrubs avatars (THEATRE), the player's included; you keep your "You" badge too
    for (const p of theatre) expect([...THEATRE.female, ...THEATRE.male], p.key).toContain(INDEX.avatars[p.avatar].id)
    expect(st.badges).toBe(1)
    // with no avatars the procedural body draws its own cap: the cap mesh draws nobody
    m.setAvatars([])
    m.update(frame(es, cam, 1))
    expect(m.stats.caps).toBe(0)
  }, 60_000)

  it('frames the cap on the head: T(centre) S(radii) on the head row, its top just over the skinned crown, whatever the head does', async () => {
    const loaded = await loadPeopleFromDisk()
    const fits = loaded.avatars.map((a) => capFitOfBody(a.lods[0])!)
    const m = new CrowdModel()
    m.setAvatars(
      loaded.avatars.map((a) => a.entry),
      fits,
    )
    // the scrub nurse looks up at something and the surgeon walks: the cap follows both heads
    es.get('or-scrub')!.lookAt = { x: 2, y: 2.6, z: 4 }
    for (let f = 0; f < 40; f++) m.update(frame(es, cam, f / 60))
    for (const id of ['or-scrub', 'or-surgeon']) {
      const p = m.get(id)!
      const fit = fits[p.avatar]
      const parts = rowParts(m.data, p.row)
      const h = P.head * 12
      const c = CAP_FRAME * 12
      for (let r = 0; r < 3; r++) {
        const i = r * 4
        expect(parts[c + i], id).toBeCloseTo(parts[h + i] * fit.rx, 6)
        expect(parts[c + i + 1], id).toBeCloseTo(parts[h + i + 1] * fit.ry, 6)
        expect(parts[c + i + 2], id).toBeCloseTo(parts[h + i + 2] * fit.rz, 6)
        expect(parts[c + i + 3], id).toBeCloseTo(parts[h + i] * fit.cx + parts[h + i + 1] * fit.cy + parts[h + i + 2] * fit.cz + parts[h + i + 3], 5)
      }
      // skin the avatar's head with the same row: every covered head vertex is inside the cap's ellipsoid as the shader places it
      const mesh = cpuMesh(loaded.avatars[p.avatar].lods[0])
      const skinned = skinAll(mesh, parts)
      // the cap frame's inverse: unit = S^-1 R^T (world - centre), with R the head row's rotation scaled by the person's size k
      const k = Math.hypot(parts[h], parts[h + 4], parts[h + 8])
      const ox = parts[c + 3]
      const oy = parts[c + 7]
      const oz = parts[c + 11]
      const pts = headPoints(mesh)
      let covered = 0
      let inside = 0
      let crown = -Infinity
      for (let v = 0, n = 0; v < mesh.count; v++) {
        let w = 0
        for (let q = 0; q < 4; q++) if (Math.round(mesh.joints[v * 4 + q]) === P.head) w += mesh.weights[v * 4 + q]
        if (w < 0.5) continue
        const [px, py, pz] = pts[n++]
        crown = Math.max(crown, skinned[v * 3 + 1])
        // a vertex on the head alone: back through the cap frame into the bind space it was measured in, it is where the fit saw it
        if (w > 0.999) {
          const dx = skinned[v * 3] - ox
          const dy = skinned[v * 3 + 1] - oy
          const dz = skinned[v * 3 + 2] - oz
          const bx = (parts[h] * dx + parts[h + 4] * dy + parts[h + 8] * dz) / (k * k)
          const by = (parts[h + 1] * dx + parts[h + 5] * dy + parts[h + 9] * dz) / (k * k)
          const bz = (parts[h + 2] * dx + parts[h + 6] * dy + parts[h + 10] * dz) / (k * k)
          expect(bx + fit.cx, id).toBeCloseTo(px, 4)
          expect(by + fit.cy, id).toBeCloseTo(py, 4)
          expect(bz + fit.cz, id).toBeCloseTo(pz, 4)
        }
        const o = capOverreach(fit, px, py, pz)
        if (o === 0) continue
        covered++
        if (o <= 1 + 1e-9) inside++
      }
      expect(covered, id).toBeGreaterThan(50)
      expect(inside / covered, id).toBeGreaterThanOrEqual(0.98)
      // the cap's top (the unit pole) is at the crown (by the pad, give or take the tilt of a head looking up)
      const capTop = parts[c + 5] + oy
      expect(Math.abs(capTop - crown), id).toBeLessThan(0.04)
    }
    delete es.get('or-scrub')!.lookAt
  }, 60_000)
})

describe('the cap mesh', () => {
  it('is one more mesh of the people on the props material, drawn only while somebody wears a cap', async () => {
    const loaded = await loadPeopleFromDisk()
    const rig = createCrowdRig()
    const pm = attachPeople(rig, loaded)
    expect(pm.cap.material).toBe(rig.propsMaterial)
    expect(rig.people.children).toContain(pm.cap)
    const es = new Map<string, Entity>()
    es.set('ward-nurse', ent({ id: 'ward-nurse', role: 'nurse', position: { x: 0, y: 0, z: 4 } }))
    for (let f = 0; f < 3; f++) driveCrowd(rig, es, 0, 1.7, 0, 1 / 60, f / 60)
    expect(pm.cap.visible).toBe(false)
    es.set('or-scrub', ent({ id: 'or-scrub', role: 'nurse', outfit: 'theatre', position: { x: 1, y: 0, z: 4 } }))
    for (let f = 0; f < 3; f++) driveCrowd(rig, es, 0, 1.7, 0, 1 / 60, (3 + f) / 60)
    expect(pm.cap.visible).toBe(true)
    expect((pm.cap.geometry as unknown as { instanceCount: number }).instanceCount).toBe(1)
    rig.dispose()
  }, 60_000)
})
