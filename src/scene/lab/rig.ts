/**
 * The automated lab as three.js objects, with no React: the pucks, tube bodies and caps of every sample in `LabState.slots` (three instanced
 * pools on the palette's `tinted` material: they share the canopies' program), the moving machine parts (lids, rotors, probes, grippers: one
 * merged dynamic mesh on MACHINE_BODY), and the lab's light (status LEDs, the camera flash, the launch and arrival rings, the glow trails of
 * tubes in flight: one dynamic mesh on MACHINE_GLOW). FIVE draw calls in all, about 12 k triangles. `step` is the whole per-frame update; the layer
 * (LabLayer.tsx) only mounts the group and calls it once a frame at FRAME_PRIORITY.lab, so the node tests run the same code.
 *
 * Nothing is allocated in `step`: poses and colours go through preallocated objects and typed arrays, and a matrix, a colour or a vertex range is
 * rewritten only when its inputs changed.
 *
 * The render slot of a sample (0..63) is the sim's: slot i of the pools is slot i of `LabState.slots`. Pool entries 64..111 are the cold
 * archive's display tubes, shown for `state.archived` (up to 48), in rack order.
 */
import { Color, CylinderGeometry, Group, InstancedMesh, Mesh, type BufferAttribute, type BufferGeometry } from 'three'
import { LAB_CATALOGUE } from '@/content/lab'
import { MACHINE_BODY, MACHINE_GLOW } from '@/scene/imaging/machines/machineMaterials'
import { setRegionRGB, type GlowRegion } from '@/scene/imaging/machines/geometry'
import { MAT } from '@/scene/materials'
import { LAB_STOPS } from '@/sim/labTrack'
import { pathPointInto } from '@/sim/pneumaticPath'
import type { AnalyserKind, LabState, Sample } from '@/sim/types'
import { ARCHIVE_SHOWN, archiveTubeAt, BENCH, CAP, CFG_COUNT, GRIPPER_IDS, PROBE_IDS, PUCK, TUBE, type ProbeId } from './labDims'
import { buildLabGlow, clearTrail, LED_IDS, RING_COUNT, RING_RECEIVE, TRAIL, type LabGlow, writeTrail } from './labGlow'
import { buildMovingParts, posePart, type MovingParts } from './labParts'
import { BucketTable, composeInto, flashDecay, gripperStroke, gripperTip, hideInstance, lidAngle, probeTip, rotorAdvance, type Quat } from './motion'
import { capBase, CAP_WHITE, lookOf, newLook, TUBE_KINDS, type LookCtx } from './samples'

export const SLOTS = 64
/** Pool size of the tubes and caps: the render slots, then the archive's display tubes. */
export const POOL = SLOTS + ARCHIVE_SHOWN

/** The analyser state each probe follows. */
const KIND_OF: Readonly<Record<ProbeId, AnalyserKind>> = { haem: 'haematology', chem: 'chemistry', immuno: 'immunoassay', coag: 'coagulation' }

export interface LabLike {
  state: LabState
  samples: { get(id: string): Sample | undefined }
}

export interface LabStep {
  lab: LabLike | null
  /** Changes when the hospital is rebuilt (a Jump): every pool and cache snaps. */
  generation: number
  /** Sim seconds (the settle of a tube into its centrifuge bucket). */
  simT: number
  /** Real seconds since the last frame, 0 while paused (rotors, grippers and flashes run on it). */
  dt: number
}

export interface LabRigStats {
  /** Slots drawn this frame, tubes in flight, tubes in centrifuge buckets, tubes of the archive on view. */
  drawn: number
  flights: number
  inBuckets: number
  archiveShown: number
}

export interface LabRig {
  root: Group
  pucks: InstancedMesh
  bodies: InstancedMesh
  caps: InstancedMesh
  moving: Mesh
  glow: Mesh
  parts: MovingParts
  glowGeo: LabGlow
  stats: LabRigStats
  /** The rotors' drawn angles. */
  rotorAngle: Float64Array
  /** The meshes that are drawn (the draw calls). */
  meshes(): Mesh[]
  step(s: LabStep): void
  dispose(): void
}

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

const FLUID_COL = ['#6e1320', '#e9b24a', '#8d1f2e', '#c4553f'].map((h) => new Color(h))
const CAP_COL: Color[] = [...TUBE_KINDS.map((k) => new Color(LAB_CATALOGUE.tubes[k].hex)), new Color('#f2f4f4')]
const PUCK_COL = [new Color('#dfe5e6'), new Color('#f08a3c')]

/** LED colours by state: 0 idle (dim green), 1 waiting (amber), 2 working (bright green), 3 cold (blue). Linear RGB, above 1 blooms. */
const LED_STATE: readonly (readonly [number, number, number])[] = (
  [
    ['#3fb56b', 0.45],
    ['#f0a33a', 1.5],
    ['#5be28d', 1.9],
    ['#7fd0f0', 1.1],
  ] as const
).map(([hex, gain]) => {
  const c = new Color(hex)
  return [c.r * gain, c.g * gain, c.b * gain] as const
})
const RING_RGB = ((c) => [c.r * 2.4, c.g * 2.4, c.b * 2.4] as const)(new Color('#bff3ee'))
const FLASH_RGB = [2.4, 2.4, 2.4] as const

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

function instanced(geometry: BufferGeometry, count: number, name: string): InstancedMesh {
  const m = new InstancedMesh(geometry, MAT.tinted, count)
  m.name = name
  m.frustumCulled = false
  m.castShadow = false
  m.receiveShadow = false
  m.instanceMatrix.array.fill(0)
  // every instance gets a colour before the first draw, so the shader variant with instance colours compiles once, at start-up
  for (let i = 0; i < count; i++) m.setColorAt(i, PUCK_COL[0])
  if (m.instanceColor) m.instanceColor.needsUpdate = true
  return m
}

export function createLabRig(): LabRig {
  const puckGeo = new CylinderGeometry(PUCK.r, PUCK.r * 1.06, PUCK.h, 12).translate(0, PUCK.h / 2, 0)
  const tubeGeo = new CylinderGeometry(TUBE.r, TUBE.r, TUBE.h, 8).translate(0, TUBE.h / 2, 0)
  const capGeo = new CylinderGeometry(CAP.r, CAP.r * 1.05, CAP.h, 8).translate(0, CAP.h / 2, 0)
  const pucks = instanced(puckGeo, SLOTS, 'lab-pucks')
  const bodies = instanced(tubeGeo, POOL, 'lab-tubes')
  const caps = instanced(capGeo, POOL, 'lab-caps')
  const puckM = pucks.instanceMatrix.array as Float32Array
  const bodyM = bodies.instanceMatrix.array as Float32Array
  const capM = caps.instanceMatrix.array as Float32Array

  const parts = buildMovingParts()
  const moving = new Mesh(parts.geometry, MACHINE_BODY)
  moving.name = 'lab-moving'
  moving.frustumCulled = false
  moving.matrixAutoUpdate = false
  moving.updateMatrix()

  // the parts by index, so a frame never builds a key string
  const lidParts = Array.from({ length: CFG_COUNT }, (_, i) => parts.byId.get(`lid${i}`)!)
  const rotorParts = Array.from({ length: CFG_COUNT }, (_, i) => parts.byId.get(`rotor${i}`)!)
  const probeParts = PROBE_IDS.map((id) => parts.byId.get(`probe:${id}`)!)
  const gripParts = GRIPPER_IDS.map((id) => parts.byId.get(`grip:${id}`)!)
  const cfgLed = Array.from({ length: CFG_COUNT }, (_, i) => `cfg${i}`)

  const glowGeo = buildLabGlow()
  const glow = new Mesh(glowGeo.geometry, MACHINE_GLOW)
  glow.name = 'lab-glow'
  glow.frustumCulled = false
  glow.matrixAutoUpdate = false
  glow.updateMatrix()
  glow.renderOrder = 2

  const root = new Group()
  root.name = 'lab'
  root.add(pucks, bodies, caps, moving, glow)

  // ----- per-frame state (all preallocated) -----
  const rotorAngle = new Float64Array(CFG_COUNT)
  const rotorShown = new Float64Array(CFG_COUNT).fill(Number.NaN)
  const rpm = new Float64Array(CFG_COUNT)
  const lidShown = new Float64Array(CFG_COUNT).fill(Number.NaN)
  const probeShown = new Float64Array(PROBE_IDS.length).fill(Number.NaN)
  const stroke = new Float64Array(GRIPPER_IDS.length)
  const phase = new Float64Array(GRIPPER_IDS.length)
  const strokeShown = new Float64Array(GRIPPER_IDS.length).fill(Number.NaN)
  const working = new Uint8Array(GRIPPER_IDS.length)
  const buckets = new BucketTable(CFG_COUNT + 1, 24)
  const look = newLook()
  const ctx: LookCtx = { simT: 0, rotorAngle, rpm, buckets, inFlight: null }
  const upright: Quat = { x: 0, y: 0, z: 0, w: 1 }
  const capAt = { x: 0, y: 0, z: 0 }

  const shown = new Uint8Array(POOL)
  const fluidShown = new Int8Array(POOL).fill(-1)
  const capShown = new Int8Array(POOL).fill(-1)
  const puckShown = new Int8Array(SLOTS).fill(-1)
  const prevMode = new Uint8Array(SLOTS) // 0 none, 1 airborne, 2 track, 3 bucket, 4 landed or in the hopper
  const prevId: (string | null)[] = new Array<string | null>(SLOTS).fill(null)
  const prevS = new Float64Array(SLOTS)
  const ledState = new Int8Array(LED_IDS.length).fill(-1)
  const ledIndex = new Map<string, number>(LED_IDS.map((id, i) => [id, i]))
  const ledRegions: GlowRegion[] = LED_IDS.map((id) => glowGeo.regions[`led:${id}`])
  const ringRegions: GlowRegion[] = Array.from({ length: RING_COUNT }, (_, i) => glowGeo.regions[`ring:${i}`])
  const ring = new Float64Array(RING_COUNT)
  const ringShown = new Float64Array(RING_COUNT).fill(-1)
  const flashRegion = glowGeo.regions.flash
  const trailLive = new Uint8Array(TRAIL.flights)
  const trailPts = new Float64Array(TRAIL.points * 3)
  const trailPt = { x: 0, y: 0, z: 0 }
  const st = { generation: Number.NaN, flash: 0, archiveShown: -1, camStop: LAB_STOPS.camera, glowDirty: false }
  const stats: LabRigStats = { drawn: 0, flights: 0, inBuckets: 0, archiveShown: 0 }

  const hide = (i: number): void => {
    if (!shown[i]) return
    shown[i] = 0
    if (i < SLOTS) hideInstance(puckM, i)
    hideInstance(bodyM, i)
    hideInstance(capM, i)
    pucks.instanceMatrix.needsUpdate = true
    bodies.instanceMatrix.needsUpdate = true
    caps.instanceMatrix.needsUpdate = true
  }

  const setTube = (i: number, fluid: number, cap: number): void => {
    if (fluidShown[i] !== fluid) {
      fluidShown[i] = fluid
      bodies.setColorAt(i, FLUID_COL[fluid])
      if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
    }
    if (capShown[i] !== cap) {
      capShown[i] = cap
      caps.setColorAt(i, CAP_COL[cap])
      if (caps.instanceColor) caps.instanceColor.needsUpdate = true
    }
  }

  /** A module's light to state `s` (see LED_STATE); rewrites its vertices only when the state changed. */
  const setLed = (id: string, s: number): void => {
    const i = ledIndex.get(id)
    if (i === undefined || ledState[i] === s) return
    ledState[i] = s
    const c = LED_STATE[s]
    setRegionRGB(glowGeo.geometry, ledRegions[i], c[0], c[1], c[2], 1)
    st.glowDirty = true
  }

  const initGlow = (): void => {
    for (let i = 0; i < RING_COUNT; i++) setRegionRGB(glowGeo.geometry, ringRegions[i], RING_RGB[0], RING_RGB[1], RING_RGB[2], 0)
    setRegionRGB(glowGeo.geometry, flashRegion, FLASH_RGB[0], FLASH_RGB[1], FLASH_RGB[2], 0)
    for (let t = 0; t < TRAIL.flights; t++) {
      clearTrail(glowGeo, t)
      trailLive[t] = 0
    }
    ledState.fill(-1)
    for (const id of LED_IDS) setLed(id, id === 'archive' ? 3 : 0)
    ring.fill(0)
    ringShown.fill(0)
    st.flash = 0
    st.glowDirty = true
  }

  const resetAll = (): void => {
    shown.fill(1)
    for (let i = 0; i < POOL; i++) hide(i)
    fluidShown.fill(-1)
    capShown.fill(-1)
    puckShown.fill(-1)
    prevMode.fill(0)
    prevId.fill(null)
    buckets.sweep()
    st.archiveShown = -1
    lidShown.fill(Number.NaN)
    rotorShown.fill(Number.NaN)
    probeShown.fill(Number.NaN)
    strokeShown.fill(Number.NaN)
    stroke.fill(0)
    phase.fill(0)
    initGlow()
  }
  initGlow()

  const step = ({ lab, generation, simT, dt }: LabStep): void => {
    if (st.generation !== generation) {
      st.generation = generation
      resetAll()
    }
    ctx.simT = simT
    const state = lab?.state ?? null
    ctx.inFlight = state ? state.pneumatic.inFlight : null
    let movingDirty = false
    let poolDirty = false
    working.fill(0)
    stats.drawn = 0
    stats.flights = 0
    stats.inBuckets = 0

    // ----- centrifuges: lids and rotors -----
    for (let i = 0; i < CFG_COUNT; i++) {
      const cf = state ? state.centrifuges[i] : undefined
      const r = cf ? cf.rpm01 : 0
      rpm[i] = r
      rotorAngle[i] = rotorAdvance(rotorAngle[i], r, dt)
      const ang = lidAngle(cf ? cf.lid : 0)
      if (!(Math.abs(ang - lidShown[i]) < 1e-4)) {
        lidShown[i] = ang
        posePart(parts, lidParts[i], ang, 0, 0, 0)
        movingDirty = true
      }
      if (rotorAngle[i] !== rotorShown[i]) {
        rotorShown[i] = rotorAngle[i]
        posePart(parts, rotorParts[i], rotorAngle[i], 0, 0, 0)
        movingDirty = true
      }
    }

    // ----- the samples -----
    if (lab && state) {
      const slots = state.slots
      let trailN = 0
      for (let i = 0; i < SLOTS; i++) {
        const id = slots[i]
        const s = id ? lab.samples.get(id) : undefined
        if (!s || !lookOf(s, ctx, look).show) {
          if (prevMode[i] === 1) ring[RING_RECEIVE] = 1 // a flying tube that vanishes has arrived
          hide(i)
          prevMode[i] = 0
          prevId[i] = null
          continue
        }
        const mode = look.airborne ? 1 : look.mode === 'track' ? 2 : look.mode === 'bucket' ? 3 : 4
        const same = prevId[i] === s.id
        // events: the launch ring, the arrival ring, the camera flash as a puck passes the arch
        if (mode === 1 && (!same || prevMode[i] !== 1) && s.where.source >= 0 && s.where.source < RING_RECEIVE) ring[s.where.source] = 1
        if (same) {
          if (prevMode[i] === 1 && mode !== 1) ring[RING_RECEIVE] = 1
          if (mode === 2 && prevMode[i] === 2 && s.where.line === 'track') {
            const a = prevS[i]
            const b = s.where.sDraw
            if (a < st.camStop && b >= st.camStop && b - a < 1) st.flash = 1
          }
        }
        prevMode[i] = mode
        prevId[i] = s.id
        prevS[i] = s.where.sDraw
        if (look.mode === 'bucket') stats.inBuckets++
        // what the grippers are working on: a tube at the decapper or the recapper, one just arrived or just set on the belt for the sorter
        if (s.where.line === 'module') {
          if (s.where.module === 'decap') working[0] = 1
          else if (s.where.module === 'recap') working[1] = 1
        }
        if (s.where.module === 'receive' || (mode === 2 && s.where.sDraw < 0.35)) working[2] = 1

        // the instances
        shown[i] = 1
        if (look.puck) {
          composeInto(puckM, i, look.x, BENCH.y, look.z, upright, 1)
          const pc = look.stat ? 1 : 0
          if (puckShown[i] !== pc) {
            puckShown[i] = pc
            pucks.setColorAt(i, PUCK_COL[pc])
            if (pucks.instanceColor) pucks.instanceColor.needsUpdate = true
          }
        } else hideInstance(puckM, i)
        composeInto(bodyM, i, look.x, look.y, look.z, look.q, look.scale)
        if (look.capShow) {
          capBase(look, capAt)
          composeInto(capM, i, capAt.x, capAt.y, capAt.z, look.q, look.scale)
        } else hideInstance(capM, i)
        setTube(i, look.fluid, look.cap)
        poolDirty = true
        stats.drawn++

        // the glow trail of a flying tube: cap colour, head first, over the last ~1.5 m of its path
        if (mode === 1 && trailN < TRAIL.flights) {
          const src = s.where.source
          for (let j = 0; j < TRAIL.points; j++) {
            pathPointInto(src, s.where.sDraw - j * TRAIL.spacing, trailPt)
            trailPts[j * 3] = trailPt.x
            trailPts[j * 3 + 1] = trailPt.y
            trailPts[j * 3 + 2] = trailPt.z
          }
          const c = CAP_COL[look.cap]
          writeTrail(glowGeo, trailN, trailPts, c.r * 2.2, c.g * 2.2, c.b * 2.2, 0.85)
          trailLive[trailN] = 1
          trailN++
          st.glowDirty = true
          stats.flights++
        }
      }
      for (let t = trailN; t < TRAIL.flights; t++) {
        if (!trailLive[t]) continue
        clearTrail(glowGeo, t)
        trailLive[t] = 0
        st.glowDirty = true
      }
      buckets.sweep()

      // the cold archive's racks: one tube per archived sample, up to what the racks show
      const n = Math.min(state.archived, ARCHIVE_SHOWN)
      if (n !== st.archiveShown) {
        st.archiveShown = n
        for (let k = 0; k < ARCHIVE_SHOWN; k++) {
          const i = SLOTS + k
          if (k < n) {
            archiveTubeAt(k, capAt)
            composeInto(bodyM, i, capAt.x, capAt.y, capAt.z, upright, 1)
            composeInto(capM, i, capAt.x, capAt.y + TUBE.h, capAt.z, upright, 1)
            // a mix of whole blood and serum, fixed by the tube's place (no randomness)
            setTube(i, (k * 7) % 5 < 2 ? 0 : 1, CAP_WHITE)
            shown[i] = 1
          } else {
            shown[i] = 1
            hide(i)
          }
        }
        poolDirty = true
      }
      stats.archiveShown = n
    } else {
      // no lab (not built, or a test without one): nothing on the belt
      for (let i = 0; i < POOL; i++) hide(i)
      for (let i = 0; i < SLOTS; i++) {
        prevMode[i] = 0
        prevId[i] = null
      }
      st.archiveShown = -1
      stats.archiveShown = 0
    }

    // ----- probes, grippers and the modules' lights -----
    for (let i = 0; i < PROBE_IDS.length; i++) {
      const id = PROBE_IDS[i]
      const a = state ? state.analysers[KIND_OF[id]] : undefined
      const tip = probeTip(a ? a.probe : 0)
      if (!(Math.abs(tip - probeShown[i]) < 1e-4)) {
        probeShown[i] = tip
        posePart(parts, probeParts[i], 0, 0, tip, 0)
        movingDirty = true
      }
      // working while it aspirates or runs, waiting with a queue
      setLed(id, a ? (a.aspirating !== null || a.running > 0 ? 2 : a.queue > 0 ? 1 : 0) : 0)
    }
    for (let i = 0; i < GRIPPER_IDS.length; i++) {
      if (working[i]) {
        phase[i] = (phase[i] + dt * 1.6) % 1
        stroke[i] = gripperStroke(true, phase[i])
      } else {
        // ease back up
        stroke[i] = stroke[i] > 0.001 ? Math.max(0, stroke[i] - dt * 3) : 0
        if (stroke[i] === 0) phase[i] = 0
      }
      const tip = gripperTip(stroke[i])
      if (!(Math.abs(tip - strokeShown[i]) < 1e-4)) {
        strokeShown[i] = tip
        posePart(parts, gripParts[i], 0, 0, tip, 0)
        movingDirty = true
      }
    }
    setLed('decap', working[0] ? 2 : 0)
    setLed('recap', working[1] ? 2 : 0)
    setLed('receive', working[2] || stats.flights > 0 ? 2 : 0)
    for (let i = 0; i < CFG_COUNT; i++) {
      const cf = state ? state.centrifuges[i] : undefined
      setLed(cfgLed[i], !cf ? 0 : cf.phase === 'spinning' ? 2 : cf.phase === 'idle' ? 0 : 1)
    }

    // ----- the camera's flash and the rings -----
    const flashWas = st.flash
    st.flash = flashDecay(st.flash, dt, 4)
    setLed('camera', st.flash > 0.01 ? 2 : 0)
    if (st.flash !== flashWas) {
      setRegionRGB(glowGeo.geometry, flashRegion, FLASH_RGB[0], FLASH_RGB[1], FLASH_RGB[2], st.flash)
      st.glowDirty = true
    }
    for (let i = 0; i < RING_COUNT; i++) {
      ring[i] = flashDecay(ring[i], dt, 2.2)
      if (ring[i] !== ringShown[i]) {
        ringShown[i] = ring[i]
        setRegionRGB(glowGeo.geometry, ringRegions[i], RING_RGB[0], RING_RGB[1], RING_RGB[2], ring[i])
        st.glowDirty = true
      }
    }

    if (poolDirty) {
      pucks.instanceMatrix.needsUpdate = true
      bodies.instanceMatrix.needsUpdate = true
      caps.instanceMatrix.needsUpdate = true
    }
    if (movingDirty) {
      ;(parts.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
      ;(parts.geometry.getAttribute('normal') as BufferAttribute).needsUpdate = true
    }
    if (st.glowDirty) {
      st.glowDirty = false
      ;(glowGeo.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true
      ;(glowGeo.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
    }
  }

  return {
    root,
    pucks,
    bodies,
    caps,
    moving,
    glow,
    parts,
    glowGeo,
    stats,
    rotorAngle,
    meshes: () => [pucks, bodies, caps, moving, glow],
    step,
    dispose() {
      puckGeo.dispose()
      tubeGeo.dispose()
      capGeo.dispose()
      parts.geometry.dispose()
      glowGeo.geometry.dispose()
      pucks.dispose()
      bodies.dispose()
      caps.dispose()
    },
  }
}

/** Draw calls of a rig: its meshes that draw anything. */
export function drawCallsOf(rig: LabRig): number {
  return rig.meshes().filter((m) => m.visible && (!(m as InstancedMesh).isInstancedMesh || (m as InstancedMesh).count > 0)).length
}

/** Triangles of a rig as drawn (instanced pools count every instance: a hidden one collapses to nothing but still costs a vertex pass). */
export function trianglesOf(rig: LabRig): number {
  let n = 0
  for (const m of rig.meshes()) {
    const g = m.geometry
    const per = (g.index ? g.index.count : g.getAttribute('position').count) / 3
    n += per * ((m as InstancedMesh).isInstancedMesh ? (m as InstancedMesh).count : 1)
  }
  return n
}
