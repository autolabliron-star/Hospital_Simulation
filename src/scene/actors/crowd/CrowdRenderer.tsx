/**
 * The crowd renderer component: mounts the meshes of crowdRig.ts and drives them every frame from `sim.entities`.
 * Eight draw calls at most for the procedural crowd: 3 bodies (high, mid, far), props, vehicles, the blankets of the patients in beds (only while somebody
 * lies in one), ground blobs, and the selection ring (only while it shows). Nothing is frustum culled and nobody is dropped by distance, so nobody ever pops out; no React state is involved per frame.
 * Reads the simulation, never drives it. Mount once inside the <Canvas>.
 *
 * W3 wave B: the realistic people. At mount the Rocketbox avatars start loading (avatarLoader.ts, from public/assets/people, offline); once they are
 * in, the crowd is re-dressed (crowdRig.ts attachPeople: one instanced draw per avatar and LOD band on screen). The load holds the warm-up (a warm
 * gate, at most 10 s) and the gate closes only after the meshes are in the scene, so their one program compiles behind the loading screen. If the
 * load fails the gate closes too and the procedural bodies simply stay. `?people=0` keeps the procedural crowd (for comparisons and cost).
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { sim } from '@/sim'
import { registerWarmGate } from '@/scene/warmup/registry'
import { loadPeople } from './avatarLoader'
import { attachPeople, createCrowdRig, detachPeople, driveCrowd } from './crowdRig'
import { setActiveCrowd } from './runtime'

const debugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('crowdDebug')
/** `?people=0` keeps the procedural bodies. */
const peopleEnabled = typeof window === 'undefined' || new URLSearchParams(window.location.search).get('people') !== '0'

/** The instanced crowd: mount once inside the Canvas (in place of the M1 capsule placeholders). */
export function People() {
  const rig = useMemo(createCrowdRig, [])

  useEffect(() => {
    setActiveCrowd(rig.model)
    const w = window as unknown as Record<string, unknown>
    if (debugEnabled) w.__hospitalCrowd = { model: rig.model, stats: () => ({ ...rig.model.stats, people: rig.avatars ? { avatars: rig.avatars.meshes.length, bytes: rig.avatars.bytes } : null }) }
    return () => {
      setActiveCrowd(null)
      if (debugEnabled) delete w.__hospitalCrowd
      rig.dispose()
    }
  }, [rig])

  // the realistic people: load once, then everybody is re-dressed; on failure (or with ?people=0) the procedural bodies stay
  useEffect(() => {
    if (!peopleEnabled) return
    let live = true
    const work = loadPeople(import.meta.env.BASE_URL)
      .then((loaded) => {
        if (live) attachPeople(rig, loaded)
      })
      .catch((err: unknown) => console.warn('[crowd] the realistic people did not load; keeping the procedural bodies', err))
    // resolves once the meshes are in the scene (attachPeople is synchronous), or once the load has failed
    const unregister = registerWarmGate('people', work)
    return () => {
      live = false
      unregister()
      detachPeople(rig)
    }
  }, [rig])

  useFrame((state, delta) => driveCrowd(rig, sim.entities, state.camera.position.x, state.camera.position.y, state.camera.position.z, delta, state.clock.elapsedTime))

  return (
    <>
      {rig.objects.map((o) => (
        <primitive key={o.name} object={o} dispose={null} />
      ))}
      <primitive object={rig.people} dispose={null} />
    </>
  )
}
