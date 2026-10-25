/**
 * Realism step 2: the authored building's movable kit (`extras.kitNode`) is lit like the people, not by its rest pose's lightmap, and casts a
 * soft contact shadow that follows it (zoneLoader.ts prepareZoneScene, writeKitShadows).
 */
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Plane, Scene, Texture, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { lookPatchCount } from '@/scene/lighting/palettePatch'
import { ContactBuffer } from '@/scene/lighting/contact/registry'
import { hasBakedLook } from './lightmaps'
import { lightmapFiles, prepareZoneScene, writeKitShadows } from './zoneLoader'

function fixture() {
  const scene = new Group()
  const shared = new MeshStandardMaterial({ name: 'KitPlastic' })
  const floor = new Mesh(new BoxGeometry(10, 0.05, 10).translate(0, -0.025, 0), new MeshStandardMaterial({ name: 'Terrazzo' }))
  floor.name = 'arch_Terrazzo'
  floor.userData = { lightmap: 'lm_Terrazzo.ktx2', lightmapScale: 1 }
  const cabinet = new Mesh(new BoxGeometry(1, 2, 0.5).translate(-3, 1, -3), shared)
  cabinet.name = 'arch_KitPlastic'
  cabinet.userData = { lightmap: 'lm_KitPlastic.ktx2' }
  const bed = new Group()
  bed.name = 'bed:A1'
  bed.userData = { kitNode: 'bed' }
  bed.position.set(3, 0, 4)
  bed.rotation.y = 0.5
  const frame = new Mesh(new BoxGeometry(1, 0.6, 2).translate(0, 0.3, 0), shared)
  frame.userData = { lightmap: 'lm_BedOnly.ktx2' }
  bed.add(frame)
  const door = new Group()
  door.name = 'door:D1'
  door.userData = { kitNode: 'door' }
  door.add(new Mesh(new BoxGeometry(0.9, 2.1, 0.04).translate(0, 1.05, 0), new MeshStandardMaterial()))
  scene.add(floor, cabinet, bed, door)
  return { scene, floor, cabinet, bed, frame, door, shared }
}

describe('the movable kit of a zone (realism step 2)', () => {
  it('loads no lightmap for the kit only, and keeps the static parts baked', () => {
    const f = fixture()
    expect(lightmapFiles(f.scene).sort()).toEqual(['lm_KitPlastic.ktx2', 'lm_Terrazzo.ktx2'])
    const lm = new Texture()
    const prep = prepareZoneScene(f.scene, () => lm, new Plane(new Vector3(0, -1, 0), 1.3))
    expect(prep.missing).toEqual([])
    expect(hasBakedLook(f.floor.material as MeshStandardMaterial)).toBe(true)
    expect(hasBakedLook(f.cabinet.material as MeshStandardMaterial)).toBe(true)
    // the kit's material is its own live clone: no lightmap, not baked, carrying the light volume (and with it the bake field)
    const kit = f.frame.material as MeshStandardMaterial
    expect(kit).not.toBe(f.shared)
    expect(kit).not.toBe(f.cabinet.material)
    expect(kit.lightMap).toBeNull()
    expect(hasBakedLook(kit)).toBe(false)
    expect(lookPatchCount(kit)).toBe(1)
    expect(kit.customProgramCacheKey()).toBe('std+lv0')
    expect(kit.clippingPlanes?.length).toBe(1)
    expect(prep.materials).toContain(kit)
    // matrices: the kit stays live, the rest static
    expect(f.bed.matrixAutoUpdate).toBe(true)
    expect(f.floor.matrixAutoUpdate).toBe(false)
  })

  it('a bed standing on the floor gets a shadow of its own footprint that follows it; a door leaf gets none', () => {
    const f = fixture()
    const prep = prepareZoneScene(f.scene, () => new Texture(), new Plane(new Vector3(0, -1, 0), 1.3))
    expect(prep.kit.map((k) => k.node.name)).toEqual(['bed:A1'])
    const [fp] = prep.kit[0].footprints
    expect(fp.halfX).toBeGreaterThan(0.45)
    expect(fp.halfX).toBeLessThan(0.6)
    expect(fp.halfZ).toBeGreaterThan(0.95)
    expect(fp.halfZ).toBeLessThan(1.1)
    const buf = new ContactBuffer(8)
    writeKitShadows(f.scene, prep.kit, buf)
    expect(buf.count).toBe(0) // not in a scene: not drawn
    new Scene().add(f.scene)
    writeKitShadows(f.scene, prep.kit, buf)
    expect(buf.count).toBe(1)
    expect(buf.matrix[12]).toBeCloseTo(3, 1)
    expect(buf.matrix[14]).toBeCloseTo(4, 1)
    expect(buf.matrix[13]).toBeLessThan(0.05)
    // the bed is wheeled away and turned: the shadow goes with it
    buf.reset()
    f.bed.position.set(6, 0, -2)
    f.bed.rotation.y = 0
    f.scene.updateMatrixWorld(true)
    writeKitShadows(f.scene, prep.kit, buf)
    expect(buf.matrix[12]).toBeCloseTo(6, 1)
    expect(buf.matrix[14]).toBeCloseTo(-2, 1)
    expect(buf.matrix[8]).toBeCloseTo(0, 6) // heading 0: the quad's z axis has no x
  })
})
