import { describe, expect, it } from 'vitest'
import { Simulation } from '@/sim/Simulation'
import { CONFIG } from '@/sim/config'
import { CIRCUITS, pointAt, type PathPoint } from '@/sim/meds/circuit'
import { PHARMACY, ROBOT } from '@/sim/places'
import { HATCH as POD_HATCH, POD } from '../robots/podParts'
import { buildCoreStatic } from './coreParts'
import { followTray, handTargets, type HandTargets } from './gantryMotion'
import {
  DOCK_LANE_OUT,
  dockIndex,
  DOCKS,
  FACE_SIGN,
  faceGlassPanels,
  GLASS_OUT,
  HAND_Y,
  HATCH,
  ISLAND,
  MV,
  PACK,
  PORT,
  TRAY,
  TRAY_TRAVEL,
  WARDS,
} from './layout'

const DT = CONFIG.sim.step

describe('the top dock port, the tray and the docked pod\'s side hatch line up', () => {
  it('there is a port at every dock of the contract, on its own face, at the height of the held pack', () => {
    expect(DOCKS).toHaveLength(4)
    for (const d of DOCKS) {
      expect(d.x).toBe(PHARMACY.docks[d.ward][d.port].x)
      expect(Math.sign(d.z)).toBe(FACE_SIGN[d.ward])
    }
    // the sim's carriage height IS the contract's port height
    expect(CONFIG.pharmacy.dropHeight).toBe(PHARMACY.dockPortY)
    expect(HAND_Y).toBeCloseTo(PHARMACY.dockPortY + MV.handMount, 9)
    // the opening surrounds the plate and the pack standing on it with a clear margin all round
    expect(PORT.y0).toBeLessThanOrEqual(TRAY.topY - TRAY.t - 0.01)
    expect(PORT.y1).toBeGreaterThanOrEqual(HAND_Y + PACK.y / 2 + 0.02)
    expect(PORT.w / 2).toBeGreaterThanOrEqual(PACK.x / 2 + 0.04)
    expect(PORT.y0).toBeGreaterThan(MV.kick)
    expect(PORT.y1).toBeLessThan(MV.headerY)
    // it is near the top of the face
    expect(PORT.y0).toBeGreaterThan(PHARMACY.dockPortY - 0.2)
    expect(PORT.y1).toBeLessThan(PHARMACY.dockPortY + 0.2)
  })

  it('the glass of each face is the full pane with exactly the port openings cut out', () => {
    const area = (r: { x0: number; x1: number; y0: number; y1: number }) => (r.x1 - r.x0) * (r.y1 - r.y0)
    for (const w of WARDS) {
      const panels = faceGlassPanels(w)
      const total = panels.reduce((t, r) => t + area(r), 0)
      const ports = DOCKS.filter((d) => d.ward === w)
      const full = (ISLAND.x1 - ISLAND.x0) * (MV.headerY - MV.kick)
      expect(total).toBeCloseTo(full - ports.length * PORT.w * (PORT.y1 - PORT.y0), 9)
      for (const r of panels) {
        expect(r.x1).toBeGreaterThan(r.x0)
        expect(r.y1).toBeGreaterThan(r.y0)
        for (const d of ports) {
          const ox = r.x0 < d.x + PORT.w / 2 - 1e-9 && r.x1 > d.x - PORT.w / 2 + 1e-9
          const oy = r.y0 < PORT.y1 - 1e-9 && r.y1 > PORT.y0 + 1e-9
          expect(ox && oy, `panel ${JSON.stringify(r)} covers the port at ${d.x}`).toBe(false)
        }
      }
      // no two panels overlap
      for (let i = 0; i < panels.length; i++) {
        for (let j = i + 1; j < panels.length; j++) {
          const a = panels[i]
          const b = panels[j]
          const overlap = a.x0 < b.x1 - 1e-9 && a.x1 > b.x0 + 1e-9 && a.y0 < b.y1 - 1e-9 && a.y1 > b.y0 + 1e-9
          expect(overlap).toBe(false)
        }
      }
    }
  })

  it('the stowed tray is flush with the glass; the extended one pokes a little way into the hatch, no further', () => {
    expect(TRAY.stowedBack + TRAY.len).toBeCloseTo(GLASS_OUT, 9)
    const frontExtended = TRAY.stowedBack + TRAY_TRAVEL + TRAY.len
    expect(frontExtended).toBeCloseTo(HATCH.out + TRAY.insert, 9)
    expect(TRAY.insert).toBeGreaterThan(0)
    expect(TRAY.insert).toBeLessThanOrEqual(0.05)
    // the plate crosses the whole gap between the glass and the pod
    expect(TRAY_TRAVEL).toBeCloseTo(HATCH.out + TRAY.insert - GLASS_OUT, 9)
    expect(HATCH.out - GLASS_OUT).toBeGreaterThan(0.3)
    expect(HATCH.out - GLASS_OUT).toBeLessThan(0.7)
  })

  it('the hatch plane is exactly the island-facing side of the pod hanging at the dock', () => {
    expect(DOCK_LANE_OUT).toBe(ROBOT.dockLaneZ)
    expect(HATCH.out).toBeCloseTo(ROBOT.dockLaneZ - ROBOT.podSize.w / 2, 9)
    const p: PathPoint = { x: 0, z: 0, heading: 0 }
    for (const d of DOCKS) {
      const c = CIRCUITS[d.ward]
      pointAt(c, c.docks[d.port], p)
      // the pod docks on the port's x (the circuit's dock stop is sampled every 5 cm)
      expect(Math.abs(p.x - d.x)).toBeLessThan(0.03)
      // its footprint's nearest edge to the island
      const ct = Math.cos(p.heading)
      const st = Math.sin(p.heading)
      let nearest = Infinity
      let xMin = Infinity
      let xMax = -Infinity
      for (const lx of [-ROBOT.podSize.w / 2, ROBOT.podSize.w / 2]) {
        for (const lz of [-ROBOT.podSize.l / 2, ROBOT.podSize.l / 2]) {
          const wx = p.x + lx * ct + lz * st
          const wz = p.z - lx * st + lz * ct
          nearest = Math.min(nearest, Math.abs(wz))
          xMin = Math.min(xMin, wx)
          xMax = Math.max(xMax, wx)
        }
      }
      expect(nearest, `pod at ${d.ward}${d.port}`).toBeCloseTo(HATCH.out, 6)
      // the plate is over the pod's length (and the hatch, 0.3 wide, is centred on the pod)
      expect(d.x).toBeGreaterThan(xMin)
      expect(d.x).toBeLessThan(xMax)
    }
  })

  it('the pack stays within what the robots\' side hatch opens: its height, its width, and the island side of each ward\'s pod', () => {
    const hingeY = POD.pivotY + POD_HATCH.sideHinge.y
    const lo = hingeY - POD_HATCH.reach
    // the plate and the pack fall inside the hatch's height window, and the hatch is centred on the held pack
    expect(TRAY.topY).toBeGreaterThanOrEqual(lo)
    expect(HAND_Y - PACK.y / 2).toBeGreaterThanOrEqual(lo)
    expect(HAND_Y + PACK.y / 2).toBeLessThanOrEqual(hingeY)
    expect(Math.abs((lo + hingeY) / 2 - HAND_Y)).toBeLessThan(0.02)
    expect(PACK.x).toBeLessThanOrEqual(POD_HATCH.w)
    expect(HATCH.centreY).toBe(HAND_Y)
    // the hatch height window is inside the pod's body
    expect(lo).toBeGreaterThanOrEqual(ROBOT.podBottomY)
    expect(hingeY).toBeLessThanOrEqual(ROBOT.podTopY)
    // the hatch is on the pod's local +x side (flipped for ward B), which faces the island on each dock lane
    for (const w of WARDS) {
      const c = CIRCUITS[w]
      const p: PathPoint = { x: 0, z: 0, heading: 0 }
      pointAt(c, c.docks[0], p)
      const side = POD_HATCH.flipForWard(w) ? -1 : 1
      // world direction of the pod's local x axis is (cos h, -sin h)
      const towardZ = side * -Math.sin(p.heading)
      const towardIsland = -FACE_SIGN[w]
      expect(Math.sign(towardZ), `ward ${w}`).toBe(towardIsland)
    }
  })

  it('the dock light sits under the sill, outside the glass on the rail side, clear of the pod', () => {
    const lo = PORT.glow.y - PORT.glow.h / 2
    const hi = PORT.glow.y + PORT.glow.h / 2
    expect(hi).toBeLessThan(PORT.y0 - PORT.frame) // below the sill frame bar
    expect(lo).toBeGreaterThan(ROBOT.podBottomY - 0.5) // still a dock light at the pod's height, not at the floor
    expect(PORT.glow.out - PORT.glow.d / 2).toBeGreaterThanOrEqual(GLASS_OUT - 0.05)
    expect(PORT.glow.out + PORT.glow.d / 2).toBeLessThan(HATCH.out - 0.3)
    expect(PORT.glow.out).toBeGreaterThan(GLASS_OUT)
  })

  it('the cradle runs from behind the stowed plate to the glass frame, under the plate', () => {
    expect(TRAY.cradle.back).toBeLessThanOrEqual(TRAY.stowedBack)
    expect(TRAY.cradle.w).toBeGreaterThan(TRAY.w)
    expect(TRAY.cradle.w / 2).toBeLessThan(MV.finger.open - MV.finger.t / 2 - 0.01) // clear of the open fingers
    const geo = buildCoreStatic()
    const ports = geo.solids.filter((s) => s.id.startsWith('port:'))
    expect(ports).toHaveLength(DOCKS.length)
    for (const s of ports) {
      // the hardware ends at the frame, about the glass plane: far from the pod's side
      expect(Math.max(Math.abs(s.z0), Math.abs(s.z1))).toBeLessThan(HATCH.out - 0.4)
      expect(s.y0).toBeGreaterThan(ROBOT.podBottomY - 0.5)
    }
    for (const g of Object.values(geo.geometries)) g.dispose()
  })
})

describe('the picker reaches the top port', () => {
  it('the port height is reachable: inside the gantry\'s travel, under the header and its top rail', () => {
    const G = PHARMACY.gantry
    expect(PHARMACY.dockPortY).toBeGreaterThanOrEqual(G.yMin)
    expect(PHARMACY.dockPortY).toBeLessThanOrEqual(G.yMax)
    // the carriage body at the port height fits under the mast's top and the upper gantry rail
    expect(PHARMACY.dockPortY + MV.carriage.h / 2).toBeLessThan(MV.headerY - 0.06 - 0.05 / 2)
    // and so does the hand
    expect(HAND_Y + MV.palm.h / 2).toBeLessThan(MV.headerY)
    // the port is the top of the picker's reach, up where the pods hang: above the top bin row's centre
    const topRowY = G.yMin + ((PHARMACY.bins.rows - 0.5) * (G.yMax - G.yMin)) / PHARMACY.bins.rows
    expect(PHARMACY.dockPortY).toBeGreaterThanOrEqual(topRowY - 0.05)
  })

  it('in the real simulation, the carriage stands at the port height over the dock while it drops, and never leaves its travel', () => {
    const sim = new Simulation(7)
    const res = sim.prescribe('A3', [{ medId: 'paracetamol', qty: 1 }, { medId: 'omeprazole', qty: 1 }])
    expect(res.ok).toBe(true)
    const g = sim.meds.dispensers.A.gantry
    // (the hospital also prescribes by itself, so there may be more drops than the two packs ordered here)
    let drops = 0
    let wasDropping = false
    for (let step = 0; step < 60 * 90; step++) {
      sim.step(DT)
      expect(g.y).toBeLessThanOrEqual(PHARMACY.gantry.yMax + 1e-9)
      expect(g.y).toBeGreaterThanOrEqual(PHARMACY.gantry.yMin - 1e-9)
      if (g.state === 'dropping') {
        if (!wasDropping) drops++
        expect(g.y).toBeCloseTo(PHARMACY.dockPortY, 6)
        expect(g.x).toBeCloseTo(PHARMACY.docks.A[g.port].x, 6)
      }
      wasDropping = g.state === 'dropping'
    }
    expect(drops).toBeGreaterThanOrEqual(2)
  })
})

describe('the transfer trays in the real simulation', () => {
  it('a tray is out only while a pod hangs stopped at its port in the loading state, goes out once per pack, and all end stowed', () => {
    const sim = new Simulation(11)
    const items = [{ medId: 'paracetamol', qty: 1 }, { medId: 'omeprazole', qty: 1 }, { medId: 'cetirizine', qty: 1 }]
    expect(sim.prescribe('A3', items).ok).toBe(true)
    expect(sim.prescribe('B2', items.slice(0, 2)).ok).toBe(true)
    const ext = new Array<number>(DOCKS.length).fill(0)
    const wasOut = new Array<boolean>(DOCKS.length).fill(false)
    const trips = new Array<number>(DOCKS.length).fill(0)
    const drops = new Array<number>(DOCKS.length).fill(0)
    const wasDropping = new Array<boolean>(DOCKS.length).fill(false)
    const t: HandTargets = { reach: 0, grip: 0, holding: false, onTray: false, tray: 0, enter: 0 }
    const p: PathPoint = { x: 0, z: 0, heading: 0 }
    let maxExt = 0
    for (let step = 0; step < 60 * 150; step++) {
      sim.step(DT)
      for (const w of WARDS) {
        const gs = sim.meds.dispensers[w].gantry
        handTargets(gs.state, gs.timer, t)
        for (const d of DOCKS) {
          if (d.ward !== w) continue
          const i = dockIndex(w, d.port)
          const dropping = gs.state === 'dropping' && gs.port === d.port
          if (dropping && !wasDropping[i]) drops[i]++
          wasDropping[i] = dropping
          const wanted = dropping ? t.tray : 0
          ext[i] = followTray(ext[i], wanted, DT)
          maxExt = Math.max(maxExt, ext[i])
          if (ext[i] > 0.02) {
            // a pod of this ward hangs here, stopped, loading
            const docked = sim.meds.fleet.drivers.some((dr) => {
              if (dr.pod.ward !== w || dr.pod.speed > 1e-6 || dr.pod.state !== 'loading') return false
              pointAt(CIRCUITS[w], dr.pod.s, p)
              return Math.hypot(p.x - d.x, p.z - d.z) < 0.05
            })
            expect(docked, `tray ${w}${d.port} out at step ${step} with no docked pod`).toBe(true)
          }
          const out = ext[i] > 0.5
          if (out && !wasOut[i]) trips[i]++
          wasOut[i] = out
        }
      }
    }
    expect(maxExt).toBeGreaterThan(0.995)
    // each pack is one trip of the tray at its port, and the two orders made at least five packs
    expect(trips).toEqual(drops)
    expect(drops.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5)
    for (let i = 0; i < DOCKS.length; i++) expect(ext[i], `tray ${i} ends stowed`).toBe(0)
  })
})
