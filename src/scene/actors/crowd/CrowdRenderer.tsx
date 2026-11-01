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
 *
 * R5 probe (`?probe=1`, or `?crowdDebug`): `window.__hospitalCrowd` = { model, stats(), forceAct(id, act, attire?, airway?), forcePatient(id, pose), clearForced() }. `forceAct` makes a
 * person act and dress as given whatever the sim says (model.ts ForcedAct), for screenshots of the procedure poses before the sim fills `Entity.act`:
 *   __hospitalCrowd.forceAct('<staff id>', { action: 'closeSkin', progress: 0.4, left: 'forceps', right: 'needleHolder', work: { x, y, z } }, 7)
 * (work is a SIM point: level 2 is the strip at sim x = drawn x + 150; attire 7 = mask + gown + gloves); `forceAct(id, null)` gives the person back to
 * the sim; `forceAct(patientId, undefined, undefined, 'tube')` puts a breathing tube in a lying patient; a null `work` puts the hands 0.42 m in front of the
 * person at 1.05 m. `near(x, z, r?)` lists the people within r metres of a sim point (id, role, anim, position, heading), to pick whom to force.
 *
 * R5 wave 2 (the patient on the OR table): `forcePatient(id, pose | null)` makes a patient who lies on the OR table (seat `orTable:*`) lie as `pose` says, whatever the sim says:
 * any of { position: 'supine' | 'lithotomy', headTiltDeg, rollDeg, arms: 'out' | 'tucked', airway } (a field left out is the plain level supine patient's); null gives the patient back
 * to the sim. The legs swing into the boots and the arms tuck over about 1.5 s, the whole body tips with the table:
 *   __hospitalCrowd.forcePatient('<patient id>', { position: 'lithotomy', arms: 'tucked', headTiltDeg: -25 })
 * (the live table top and the boots follow `procedure.patient`, not this: force the table with the sim's own pose, or look at the body alone.)
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { sim } from '@/sim'
import type { Airway, PatientPoseView, StaffAct } from '@/sim/types'
import { registerWarmGate } from '@/scene/warmup/registry'
import { timeScale } from '@/scene/timeScale'
import { loadPeople } from './avatarLoader'
import { attachPeople, createCrowdRig, detachPeople, driveCrowd } from './crowdRig'
import { setActiveCrowd } from './runtime'

const debugEnabled = typeof window !== 'undefined' && (new URLSearchParams(window.location.search).has('crowdDebug') || new URLSearchParams(window.location.search).get('probe') === '1')
/** `?people=0` keeps the procedural bodies. */
const peopleEnabled = typeof window === 'undefined' || new URLSearchParams(window.location.search).get('people') !== '0'

/** The instanced crowd: mount once inside the Canvas (in place of the M1 capsule placeholders). */
export function People() {
  const rig = useMemo(createCrowdRig, [])

  useEffect(() => {
    setActiveCrowd(rig.model)
    const w = window as unknown as Record<string, unknown>
    if (debugEnabled)
      w.__hospitalCrowd = {
        model: rig.model,
        stats: () => ({ ...rig.model.stats, people: rig.avatars ? { avatars: rig.avatars.meshes.length, bytes: rig.avatars.bytes } : null }),
        // R5: force an act, attire bits and a patient's airway on an entity (see the header); null act + no attire/airway clears the person
        forceAct: (id: string, act: StaffAct | null | undefined, attire?: number, airway?: Airway) => {
          if (act === null && attire === undefined && airway === undefined) rig.model.forceAct(id, null)
          else rig.model.forceAct(id, { act: act === null ? undefined : act, attire, airway })
        },
        // R5 wave 2: force a patient's pose on the OR table (see the header); null clears it
        forcePatient: (id: string, pose: Partial<PatientPoseView> | null) => rig.model.forcePatient(id, pose),
        clearForced: () => rig.model.clearForced(),
        // R5: who is within r metres of a SIM point (to pick a staff member to force, and a work point in front of them)
        near: (x: number, z: number, r = 3) => {
          const found: { id: string; role: string; anim: string; x: number; y: number; z: number; heading: number }[] = []
          for (const p of rig.model.people.values()) {
            const e = p.entity
            if (!e || (p.simX - x) ** 2 + (p.simZ - z) ** 2 > r * r) continue
            found.push({ id: p.key, role: e.role, anim: e.anim, x: e.position.x, y: e.position.y, z: e.position.z, heading: e.heading })
          }
          return found
        },
      }
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

  useFrame((state, delta) => driveCrowd(rig, sim.entities, state.camera.position.x, state.camera.position.y, state.camera.position.z, delta, state.clock.elapsedTime, timeScale(), sim.t))

  return (
    <>
      {rig.objects.map((o) => (
        <primitive key={o.name} object={o} dispose={null} />
      ))}
      <primitive object={rig.people} dispose={null} />
    </>
  )
}
