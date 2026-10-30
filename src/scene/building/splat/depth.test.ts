import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Plane, Vector3 } from 'three'
import { SPLAT_DEPTH_RENDER_ORDER, splatDepthStandIn } from './depth'

function model(): { scene: Group; wall: Mesh } {
  const scene = new Group()
  scene.name = 'zone-lobby'
  scene.position.set(2, 0, 0)
  const wall = new Mesh(new BoxGeometry(1, 3, 0.2), new MeshStandardMaterial())
  wall.position.set(0, 1.5, -6)
  const glass = new Mesh(new BoxGeometry(1, 3, 0.02), new MeshStandardMaterial({ transparent: true, opacity: 0.3 }))
  const door = new Mesh(new BoxGeometry(1, 2, 0.05), new MeshStandardMaterial())
  door.matrixAutoUpdate = true // a kit node: it moves
  for (const o of [wall, glass, door]) scene.add(o)
  for (const o of [scene, wall, glass]) {
    o.updateMatrix()
    o.matrixAutoUpdate = false
  }
  door.matrixAutoUpdate = true
  return { scene, wall }
}

describe('the splat depth stand-in', () => {
  it('copies the opaque static meshes only, depth-only, drawn last and hidden', () => {
    const { scene, wall } = model()
    const d = splatDepthStandIn(scene, new Plane(new Vector3(0, -1, 0), 4))
    expect(d.group.visible).toBe(false)
    expect(d.group.children).toHaveLength(1)
    const copy = d.group.children[0] as Mesh
    expect(copy.geometry).toBe(wall.geometry)
    expect(copy.material).toBe(d.material)
    expect(copy.renderOrder).toBe(SPLAT_DEPTH_RENDER_ORDER)
    expect(d.material.colorWrite).toBe(false)
    expect(d.material.depthWrite).toBe(true)
    expect(d.material.transparent).toBe(true)
    expect(d.material.clippingPlanes).toHaveLength(1)
  })

  it('sits where the model draws, under the same parent', () => {
    const { scene, wall } = model()
    const root = new Group()
    root.position.set(0, 0, 5)
    root.add(scene)
    const d = splatDepthStandIn(scene, new Plane())
    root.add(d.group)
    root.updateMatrixWorld(true)
    const copy = d.group.children[0] as Mesh
    expect(copy.matrixWorld.equals(wall.matrixWorld)).toBe(true)
  })

  it('lets go of its material and children', () => {
    const { scene } = model()
    const d = splatDepthStandIn(scene, new Plane())
    d.dispose()
    expect(d.group.children).toHaveLength(0)
  })
})
