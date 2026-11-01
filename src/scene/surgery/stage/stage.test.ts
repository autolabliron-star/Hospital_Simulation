/**
 * R5 wave 2 (agent H): the stage, the prepped skin, the sterile drapes and the skin marks (stage/), in node without the avatars (stage.clearance.test.ts holds the real
 * bodies): nothing shows at prep 0 and drape 0; the budgets; the plate covers the window and the ports are on it; the marks sit on the plate within 5 mm at every tilt and roll;
 * the sleeves and the curtain cover the legs and the boots; the build rate; a tilt costs only a matrix; the legs' swing; the faces look outward; no red; no new material.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Color, ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import type { CrowdModel, PersonSlot } from '@/scene/actors/crowd/model'
import { setActiveCrowd } from '@/scene/actors/crowd/runtime'
import { MACHINE_BODY } from '@/scene/imaging/machines/machineMaterials'
import { materialSitesIn } from '@/scene/warmup/manifest'
import { PELVIS_ON_TABLE } from '@/sim/procedure/body'
import { LITHOTOMY_LEG } from '@/sim/procedure/body'
import { newTablePose, setTablePose, tableLocalInto, tableMatrixInto } from '@/sim/surgery/tablePose'
import type { PatientMarks, Vec3 } from '@/sim/types'
import { HEEL_REACH } from '../table'
import { arm } from '../testkit'
import { isTierA, isTierB } from '../endo/noBlood'
import { bootAxis, bootPoints, BOOT_DROP } from './boot.testkit'
import { COLOUR, STAGE_HEX } from './colors'
import { LEG_BINS, LEG_D0, LEG_D_END, LEG_STEP } from './envelope'
import { FRONT_D } from './envelope.data'
import { fitIndexOf, selectFit } from './fit'
import { FIT_IDS } from './fit.data'
import { MARK_LIFT, PLATE_LIFT } from './frame'
import { MARK_SIZE, SITE_COUNT } from './marks'
import { MAX_TRIS, MAX_VERTS } from './mesh'
import { PERI_FRONT } from './perineum'
import { onPlate, PLATE, plateH } from './plate'
import { STAGE_MATERIAL } from './material'
import { createStageRuntime, DOCKED_AT, layoutOf, LOOK_EVERY, stepStageRuntime } from './runtime'
import { SHEET_B0, WINDOW } from './sheet'
import { drapeShown, MIN_REBUILD, MIN_REPAINT, newStageMemory, PART, stepStage, STAGE_OMEGA, stageTriangles } from './stage'
import { faces, insideSleeve, partTriangles, partVertexRange, sleeveRings, stageCase, vertexOf } from './stage.meshkit'
import { LAYOUT_POSITION, portSitesInto } from './ports'

const POSITIONS = ['supine', 'lithotomy'] as const
const MARKS: PatientMarks[] = ['none', 'marked', 'ports', 'closed', 'dressed']

describe('the swing of the legs is the stirrups\' own', () => {
  it('STAGE_OMEGA equals OMEGA_BOOT of src/scene/surgery/table.ts (read from the source: the table does not export it)', () => {
    const src = readFileSync(join(process.cwd(), 'src/scene/surgery/table.ts'), 'utf8')
    const m = /const OMEGA_BOOT\s*=\s*([0-9.]+)/.exec(src)
    expect(m, 'table.ts defines OMEGA_BOOT').not.toBeNull()
    expect(STAGE_OMEGA).toBe(Number(m![1]))
  })
})

describe('nothing shows without prep or drape', () => {
  it('prep 0 and drape 0 draw nothing, even with marks set; the sheets wait for the skin; the plate alone has no drape in it', () => {
    for (const position of POSITIONS) {
      const none = stageCase({ position, prep: 0, drape: 0, marks: 'ports' })
      expect(stageTriangles(none.mem), position).toBe(0)
      // the script's drape with no prep under it: nothing yet (the sheets start when the skin is half done)
      const early = stageCase({ position, prep: 0.3, drape: 1, marks: 'none' })
      expect(early.mem.parts[PART.sheet * 2 + 1] - early.mem.parts[PART.sheet * 2], `${position}: the sheet waits`).toBe(0)
      const skin = stageCase({ position, prep: 1, drape: 0, marks: 'none' })
      expect(skin.mem.parts[PART.plate * 2 + 1], position).toBeGreaterThan(skin.mem.parts[PART.plate * 2])
      for (const part of [PART.sheet, PART.screen, PART.sleeveL, PART.sleeveR, PART.perineum]) expect(skin.mem.parts[part * 2 + 1] - skin.mem.parts[part * 2], `${position} part ${part}`).toBe(0)
    }
  })

  it('drapeShown: the sheets start at prep 0.45 and are the script\'s drape once the skin is done (and while the wake-up takes them off)', () => {
    expect(drapeShown(1, 0)).toBe(0)
    expect(drapeShown(1, 0.45)).toBe(0)
    expect(drapeShown(1, 0.9)).toBe(1)
    expect(drapeShown(0.3, 1)).toBeCloseTo(0.3, 12)
    expect(drapeShown(0, 1)).toBe(0)
    expect(drapeShown(1, 0.7)).toBeGreaterThan(0.3)
    expect(drapeShown(1, 0.7)).toBeLessThan(0.7)
  })
})

describe('budgets', () => {
  it('every position, mark and stage of the unfolding stays under 10 000 triangles and 9 000 vertices, in range, finite, with unit normals', () => {
    let worst = 0
    for (const position of POSITIONS) {
      for (const marks of MARKS) {
        for (const drape of [0.1, 0.3, 0.5, 0.8, 1]) {
          for (const docked of [0, 15]) {
            const c = stageCase({ position, marks, drape, docked })
            const m = c.mem.mesh
            const tris = stageTriangles(c.mem)
            worst = Math.max(worst, tris)
            expect(m.overflow, `${position} ${marks} ${drape}`).toBe(false)
            expect(tris, `${position} ${marks} ${drape}`).toBeLessThan(10000)
            expect(m.nv, `${position} ${marks} ${drape}`).toBeLessThan(MAX_VERTS)
            for (let i = 0; i < m.ni; i++) if (m.idx[i] >= m.nv) throw new Error(`index ${i} out of range`)
            for (let i = 0; i < m.nv; i++) {
              for (let k = 0; k < 3; k++) {
                if (!Number.isFinite(m.pos[i * 3 + k]) || !Number.isFinite(m.nrm[i * 3 + k]) || !Number.isFinite(m.col[i * 3 + k])) throw new Error(`vertex ${i} is not finite`)
              }
              const l = Math.hypot(m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2])
              if (Math.abs(l - 1) > 1e-5) throw new Error(`vertex ${i}: normal of length ${l}`)
            }
          }
        }
      }
    }
    // the room: the buffers hold more than the worst case (and the budget says about 10 000)
    expect(MAX_TRIS).toBeGreaterThan(worst)
    expect(MAX_TRIS).toBeLessThanOrEqual(12000)
  })

  it('is ONE mesh on the stage\'s matte cloth, hidden until it has something: one draw call', () => {
    const rt = createStageRuntime()
    expect(rt.mesh.material).toBe(STAGE_MATERIAL)
    expect(rt.mesh.visible).toBe(false)
    expect(rt.geometry.drawRange.count).toBe(0)
    expect(rt.mesh.frustumCulled).toBe(false)
    expect(rt.mesh.castShadow).toBe(false)
    expect(rt.mesh.matrixAutoUpdate).toBe(false)
    // the one material of the stage is built in material.ts and nowhere else (and registered in the warm-up's manifest: materialCoverage.test.ts)
    const dir = join(process.cwd(), 'src/scene/surgery/stage')
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !n.endsWith('.test.ts'))) expect(materialSitesIn(readFileSync(join(dir, f), 'utf8')), f).toBe(f === 'material.ts' ? 1 : 0)
  })
})

describe('the matte cloth is the same shader program as MACHINE_BODY', () => {
  /** The stock standard-material sources as three hands them to onBeforeCompile, then what the material's patches make of them. */
  function compiled(m: typeof MACHINE_BODY): { vertexShader: string; fragmentShader: string } {
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms
    m.onBeforeCompile(shader, {} as WebGLRenderer)
    return { vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader }
  }

  it('matte (roughness 0.9, metalness 0) where MACHINE_BODY is 0.42 and 0.12 (and left as it was); every parameter three keys a program on, the light-volume patch and the patched sources agree', () => {
    expect(STAGE_MATERIAL.roughness).toBe(0.9)
    expect(STAGE_MATERIAL.metalness).toBe(0)
    expect(MACHINE_BODY.roughness).toBe(0.42)
    expect(MACHINE_BODY.metalness).toBe(0.12)
    // the fields of a material three's program cache key reads (WebGLPrograms.getParameters): the same on both, so the same defines
    const keys = ['type', 'vertexColors', 'toneMapped', 'transparent', 'side', 'alphaTest', 'alphaHash', 'alphaToCoverage', 'fog', 'blending', 'premultipliedAlpha', 'dithering', 'wireframe', 'forceSinglePass', 'flatShading', 'opacity', 'depthTest', 'depthWrite', 'envMapIntensity'] as const
    for (const k of keys) expect(STAGE_MATERIAL[k], k).toEqual(MACHINE_BODY[k])
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'aoMap', 'lightMap', 'emissiveMap', 'envMap', 'alphaMap', 'displacementMap'] as const) {
      expect(STAGE_MATERIAL[k] ?? null, k).toBeNull()
      expect(MACHINE_BODY[k] ?? null, k).toBeNull()
    }
    expect(STAGE_MATERIAL.vertexColors).toBe(true)
    // the light-volume patch gives both the palette's key (std + the volume's), and the same patched sources
    expect(STAGE_MATERIAL.customProgramCacheKey()).toBe(MACHINE_BODY.customProgramCacheKey())
    expect(STAGE_MATERIAL.customProgramCacheKey()).toContain('lv0')
    const a = compiled(STAGE_MATERIAL)
    const b = compiled(MACHINE_BODY)
    expect(a.fragmentShader).toBe(b.fragmentShader)
    expect(a.vertexShader).toBe(b.vertexShader)
    expect(a.fragmentShader).toContain('vLvPos')
  })
})

describe('the prepped plate and the window', () => {
  it('the plate covers the window with a margin all round, and the sheet has no face inside the window', () => {
    expect(PLATE.d0).toBeLessThanOrEqual(WINDOW.d0 - 0.025)
    expect(PLATE.d1).toBeGreaterThanOrEqual(WINDOW.d1 + 0.025)
    expect(PLATE.halfX).toBeGreaterThanOrEqual(WINDOW.halfX + 0.025)
    for (const position of POSITIONS) {
      const c = stageCase({ position })
      const pelvisD = PELVIS_ON_TABLE[position]
      let sheet = 0
      for (const f of faces(c, PART.sheet)) {
        sheet++
        const bd = f.c[2] - pelvisD
        const inside = bd > WINDOW.d0 + 1e-6 && bd < WINDOW.d1 - 1e-6 && Math.abs(f.c[0]) < WINDOW.halfX - 1e-6
        if (inside) throw new Error(`${position}: a sheet face in the window at d ${bd.toFixed(3)} x ${f.c[0].toFixed(3)}`)
      }
      expect(sheet).toBeGreaterThan(500)
      // the plate is under the window: faces at every part of it, up
      const plate = faces(c, PART.plate)
      expect(plate.length).toBe((PLATE.rows - 1) * (PLATE.cols - 1) * 2)
      let down = 0
      for (const f of plate) if (f.n[1] <= 0) down++
      expect(down).toBe(0)
      // the window's edge stands about a centimetre proud of the plate (the sheet's lift less the plate's)
      let proud = 0
      for (const f of faces(c, PART.sheet)) {
        const bd = f.c[2] - pelvisD
        if (Math.abs(bd - (WINDOW.d0 - 0.02)) < 0.021 && Math.abs(f.c[0]) < 0.19 && f.n[1] > 0.9) {
          proud = Math.max(proud, f.c[1] - plateH(position === 'lithotomy', bd, f.c[0]))
        }
      }
      expect(proud).toBeGreaterThan(0.005)
    }
  })

  it('every port (the case\'s four and the assistant\'s) is on the plate, for each layout in the position it goes with', () => {
    const sites = new Float64Array(10)
    for (const [layout, position] of [['oblique', 'supine'], ['transverse', 'lithotomy']] as const) {
      portSitesInto(layout, sites)
      expect(position, 'the layout goes with its position').toBe(LAYOUT_POSITION[layout])
      for (let i = 0; i < SITE_COUNT; i++) {
        const bd = sites[i * 2]
        expect(onPlate(bd, sites[i * 2 + 1], 0.02), `${layout} site ${i}: d ${bd.toFixed(3)} x ${sites[i * 2 + 1].toFixed(3)}`).toBe(true)
      }
    // the transverse line is the contract's (places.ts: z 6.07, 0.17 from the table's centre), 0.3 m of the slide down the pelvis from its centre
    portSitesInto('transverse', sites)
    expect(sites[0] + PELVIS_ON_TABLE.lithotomy).toBeCloseTo(0.17, 9)
    }
  })

  it('the tint spreads from the middle: at prep 0.3 the middle is tinted and the corners are not; at 1 everywhere; the colours never leave skin and antiseptic', () => {
    const colourAt = (c: ReturnType<typeof stageCase>, r: number, k: number): number[] => {
      const o = (c.mem.plateV0 + r * PLATE.cols + k) * 3
      return [c.mem.mesh.col[o], c.mem.mesh.col[o + 1], c.mem.mesh.col[o + 2]]
    }
    const mid = Math.floor(PLATE.rows / 2)
    const midC = Math.floor(PLATE.cols / 2)
    const part = stageCase({ prep: 0.3, drape: 0 })
    const full = stageCase({ prep: 1, drape: 0 })
    const A = COLOUR.antiseptic
    const S = COLOUR.skin
    const distA = (c: number[]): number => Math.hypot(c[0] - A.r, c[1] - A.g, c[2] - A.b)
    const distS = (c: number[]): number => Math.hypot(c[0] - S.r, c[1] - S.g, c[2] - S.b)
    expect(distA(colourAt(part, mid, midC))).toBeLessThan(1e-6)
    expect(distS(colourAt(part, 0, 0))).toBeLessThan(1e-6)
    for (const [r, k] of [[0, 0], [0, PLATE.cols - 1], [PLATE.rows - 1, 0], [PLATE.rows - 1, PLATE.cols - 1], [mid, 0], [0, midC]]) expect(distA(colourAt(full, r, k)), `${r},${k}`).toBeLessThan(1e-6)
    // the front only grows
    let last = -1
    for (const prep of [0.05, 0.2, 0.4, 0.6, 0.8, 1]) {
      const c = stageCase({ prep, drape: 0 })
      let tinted = 0
      for (let r = 0; r < PLATE.rows; r++) for (let k = 0; k < PLATE.cols; k++) if (distA(colourAt(c, r, k)) < 0.5 * distS(colourAt(c, r, k)) + 1e-9) tinted++
      expect(tinted, `prep ${prep}`).toBeGreaterThanOrEqual(last)
      last = tinted
    }
  })
})

describe('the skin marks', () => {
  const drawn = (c: ReturnType<typeof stageCase>): number => (c.mem.parts[PART.marks * 2 + 1] - c.mem.parts[PART.marks * 2]) / 3

  it('none: nothing; marked: five pen dots; ports: nicks, and stubs until the arm is docked (the assistant\'s always); closed and dressed: five small marks each', () => {
    expect(drawn(stageCase({ marks: 'none' }))).toBe(0)
    expect(drawn(stageCase({ marks: 'marked' }))).toBe(5 * 8)
    // a nick is two triangles, a stub two six-sided prisms with a capped top: 2 x (12 + 6) = 36
    expect(drawn(stageCase({ marks: 'ports', docked: 0 }))).toBe(5 * 38)
    expect(drawn(stageCase({ marks: 'ports', docked: 0b0101 }))).toBe(3 * 38 + 2 * 2)
    expect(drawn(stageCase({ marks: 'ports', docked: 0b1111 }))).toBe(4 * 2 + 38)
    expect(drawn(stageCase({ marks: 'closed' }))).toBe(5 * 2)
    expect(drawn(stageCase({ marks: 'dressed' }))).toBe(5 * 2)
    // the layouts differ: the transverse line is a different set of marks from the oblique one
    expect(drawn(stageCase({ position: 'lithotomy', marks: 'marked' }))).toBe(5 * 8)
    // no marks without the prepped skin, and the cryo suite's needle sites are not drawn here
    expect(drawn(stageCase({ prep: 0, marks: 'ports' }))).toBe(0)
    expect(drawn(stageCase({ marks: 'needles' }))).toBe(0)
  })

  it('a site off the plate is not drawn', () => {
    const c = stageCase({ marks: 'marked' })
    const sites = new Float64Array(10).fill(3)
    c.input.sites = sites
    c.input.dt = 1
    stepStage(c.mem, c.input)
    expect(drawn(c)).toBe(0)
  })

  it('the pen dots are centred on the ports and ride the plate (within 1 mm in the table, 2.5 mm over it)', () => {
    for (const position of POSITIONS) {
      const c = stageCase({ position, marks: 'marked' })
      const pelvisD = PELVIS_ON_TABLE[position]
      const lith = position === 'lithotomy'
      for (let i = 0; i < SITE_COUNT; i++) {
        const v = vertexOf(c.mem, c.mem.marksV0 + i * 9)
        expect(Math.abs(v[2] - (c.sites[i * 2] + pelvisD)), `${position} dot ${i} d`).toBeLessThan(1e-4)
        expect(Math.abs(v[0] - c.sites[i * 2 + 1]), `${position} dot ${i} x`).toBeLessThan(1e-4)
        const over = v[1] - plateH(lith, v[2] - pelvisD, v[0])
        expect(over, `${position} dot ${i}`).toBeGreaterThan(MARK_LIFT - 1e-4)
        expect(over, `${position} dot ${i}`).toBeLessThan(MARK_LIFT + 1e-4)
      }
    }
  })

  it('a tipped table carries the marks: at tilts -30..+20 and rolls +-12 each mark is where the table puts the port, within 5 mm, and on the plate', () => {
    const p = newTablePose()
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    for (const position of POSITIONS) {
      for (const tilt of [-30, -10, 0, 20]) {
        for (const roll of [-12, 0, 12]) {
          const c = stageCase({ position, marks: 'marked', tilt, roll })
          setTablePose(p, tilt, roll)
          const M = c.mem.matrix
          const lith = position === 'lithotomy'
          const pelvisD = PELVIS_ON_TABLE[position]
          for (let i = 0; i < SITE_COUNT; i++) {
            // the mark's centre, in the sim frame through the mesh's matrix
            const o = (c.mem.marksV0 + i * 9) * 3
            const px = c.mem.mesh.pos[o], py = c.mem.mesh.pos[o + 1], pz = c.mem.mesh.pos[o + 2]
            const wx = M[0] * px + M[4] * py + M[8] * pz + M[12]
            const wy = M[1] * px + M[5] * py + M[9] * pz + M[13]
            const wz = M[2] * px + M[6] * py + M[10] * pz + M[14]
            // where the table puts the point of the plate under the port, and the port itself
            const plate = plateH(lith, c.sites[i * 2], c.sites[i * 2 + 1])
            tableLocalInto(p, c.sites[i * 2] + pelvisD, c.sites[i * 2 + 1], plate + MARK_LIFT, out)
            expect(Math.hypot(wx - out.x, wy - out.y, wz - out.z), `${position} tilt ${tilt} roll ${roll} mark ${i}`).toBeLessThan(0.005)
            // and the same point of the plate in the table's own frame is the port's (d, x)
            const lx = M[0] * (wx - M[12]) + M[1] * (wy - M[13]) + M[2] * (wz - M[14])
            const lz = M[8] * (wx - M[12]) + M[9] * (wy - M[13]) + M[10] * (wz - M[14])
            expect(Math.abs(lx - (px)), `${position} tilt ${tilt} roll ${roll} mark ${i} x`).toBeLessThan(0.005)
            expect(Math.abs(lz - (pz)), `${position} tilt ${tilt} roll ${roll} mark ${i} d`).toBeLessThan(0.005)
          }
        }
      }
    }
  })

  it('the nicks, lines and dressings stay a few millimetres over the plate at all four corners; the stubs stand on it', () => {
    for (const marks of ['ports', 'closed', 'dressed'] as const) {
      for (const position of POSITIONS) {
        const c = stageCase({ position, marks, docked: 15 })
        const lith = position === 'lithotomy'
        const pelvisD = PELVIS_ON_TABLE[position]
        const range = partVertexRange(c.mem, PART.marks)!
        for (let v = range[0]; v <= range[1]; v++) {
          const p = vertexOf(c.mem, v)
          const over = p[1] - plateH(lith, p[2] - pelvisD, p[0])
          // a stub's foot sinks 4 mm into the plate and its top stands up to 6.5 cm over (the 12 mm port); everything else is within 4.5 mm
          expect(over, `${marks} ${position} vertex ${v}`).toBeGreaterThan(marks === 'ports' ? -0.006 : 0.002)
          expect(over, `${marks} ${position} vertex ${v}`).toBeLessThan(marks === 'ports' ? 0.07 : 0.0045)
        }
      }
    }
  })

  it('the dots and the 12 mm assistant port are bigger than the arms\' (the assistant\'s is 1.6 times)', () => {
    expect(MARK_SIZE.assistant).toBeGreaterThan(1.5)
    const c = stageCase({ marks: 'dressed' })
    const r = partVertexRange(c.mem, PART.marks)!
    const width = (i: number): number => Math.abs(vertexOf(c.mem, r[0] + i * 4 + 1)[0] - vertexOf(c.mem, r[0] + i * 4)[0])
    expect(width(4)).toBeCloseTo(width(0) * MARK_SIZE.assistant, 6)
  })
})

describe('the lithotomy drapes cover the legs and the boots', () => {
  it('both sleeves reach from the thigh to past the heel; the left one encloses the stirrup\'s boot (the calf, the sole and its walls, the heel board) with room to spare', () => {
    const c = stageCase({ position: 'lithotomy', marks: 'none' })
    const left = partVertexRange(c.mem, PART.sleeveL)
    const right = partVertexRange(c.mem, PART.sleeveR)
    expect(left).not.toBeNull()
    expect(right).not.toBeNull()
    expect(left![1] - left![0]).toBe(right![1] - right![0])
    let tightest = Infinity
    const pts = bootPoints(0.02)
    expect(pts.length).toBeGreaterThan(100)
    for (const [d, x, h] of pts) {
      const by = insideSleeve(c, PART.sleeveL, d, x, h, false)
      expect(by, `ring at ${d.toFixed(2)}`).not.toBeNull()
      tightest = Math.min(tightest, by!)
      expect(by!, `boot point (d ${d.toFixed(2)}, x ${x.toFixed(2)}, h ${h.toFixed(2)})`).toBeGreaterThan(0.008)
    }
    // the sleeve's last ring lies beyond the heel board, its cap beyond that
    const a = bootAxis()
    expect(a.d0 + a.ud * (a.len + 0.09 + 0.025) + 0.05).toBeLessThan(LEG_D_END + 0.0001)
    expect(tightest).toBeGreaterThan(0.008)
  })

  it('BOOT_DROP is the table\'s own (read from table.ts: it does not export it)', () => {
    const src = readFileSync(join(process.cwd(), 'src/scene/surgery/table.ts'), 'utf8')
    const m = /const BOOT_DROP\s*=\s*([0-9.]+)/.exec(src)
    expect(m, 'table.ts defines BOOT_DROP').not.toBeNull()
    expect(BOOT_DROP).toBe(Number(m![1]))
  })

  it('the right sleeve is the left one mirrored', () => {
    const c = stageCase({ position: 'lithotomy', marks: 'none' })
    const l = partVertexRange(c.mem, PART.sleeveL)!
    const r = partVertexRange(c.mem, PART.sleeveR)!
    for (let i = 0; i <= l[1] - l[0]; i++) {
      const a = vertexOf(c.mem, l[0] + i)
      const b = vertexOf(c.mem, r[0] + i)
      expect(b[0]).toBeCloseTo(-a[0], 4)
      expect(b[1]).toBeCloseTo(a[1], 4)
      expect(b[2]).toBeCloseTo(a[2], 4)
    }
  })

  it('the perineal curtain hangs beyond the furthest the pelvis reaches, and the top is level with the abdominal sheet\'s', () => {
    expect(PERI_FRONT).toBeGreaterThan(FRONT_D + 0.04)
    const c = stageCase({ position: 'lithotomy' })
    const r = partVertexRange(c.mem, PART.perineum)!
    let maxD = -Infinity
    let minH = Infinity
    for (let v = r[0]; v <= r[1]; v++) {
      const p = vertexOf(c.mem, v)
      maxD = Math.max(maxD, p[2])
      minH = Math.min(minH, p[1])
    }
    expect(maxD).toBeCloseTo(PERI_FRONT, 6)
    // it hangs to the hem, far under the pad
    expect(minH).toBeLessThan(-0.5)
    // its faces: the top faces up, the curtain faces the feet
    let up = 0
    let feet = 0
    for (const f of faces(c, PART.perineum)) {
      if (f.n[1] > 0.9) up++
      if (f.n[2] > 0.9) feet++
      expect(f.n[1] > -0.2, 'never faces down').toBe(true)
    }
    expect(up).toBeGreaterThan(5)
    expect(feet).toBeGreaterThan(5)
  })

  it('the leg ring stations reach the heel board and the sleeves are closed at both ends', () => {
    expect(LEG_D0).toBeLessThan(PELVIS_ON_TABLE.lithotomy + 0.2)
    expect(LEG_D_END).toBeGreaterThan(PELVIS_ON_TABLE.lithotomy + LITHOTOMY_LEG.ankle.d + HEEL_REACH)
    expect(LEG_STEP).toBeGreaterThan(0)
    const c = stageCase({ position: 'lithotomy' })
    const r = partVertexRange(c.mem, PART.sleeveL)!
    // two centres after the rings: the far cap beyond the last ring, the near cap before the first
    const rings = (r[1] - r[0] + 1 - 2) / LEG_BINS
    expect(Number.isInteger(rings)).toBe(true)
    expect(rings).toBeGreaterThanOrEqual(17)
    const far = vertexOf(c.mem, r[1] - 1)
    const near = vertexOf(c.mem, r[1])
    expect(far[2]).toBeGreaterThan(vertexOf(c.mem, r[1] - 2)[2])
    expect(near[2]).toBeLessThan(vertexOf(c.mem, r[0])[2])
  })
})

describe('the faces look outward', () => {
  it('the sheet\'s top, the plate and the curtain face out; both layers of the screen are drawn (one each way); the sleeves face away from their leg', () => {
    for (const position of POSITIONS) {
      const c = stageCase({ position, marks: 'ports' })
      let top = 0
      for (const f of faces(c, PART.sheet)) {
        if (f.c[1] > 0.1 && Math.abs(f.c[0]) < 0.2) {
          top++
          expect(f.n[1], `${position}: a sheet face over the body at d ${f.c[2].toFixed(2)} faces up`).toBeGreaterThan(0)
        }
        // the hang faces outward
        if (f.c[1] < -0.1 && Math.abs(f.c[0]) > 0.25 && Math.abs(f.n[0]) > 0.5) expect(f.n[0] * f.c[0], `${position}: a hanging face looks away from the table`).toBeGreaterThan(0)
      }
      expect(top).toBeGreaterThan(100)
      let towardHead = 0
      let towardField = 0
      for (const f of faces(c, PART.screen)) {
        if (f.n[2] < -0.5) towardHead++
        if (f.n[2] > 0.5) towardField++
      }
      expect(towardHead).toBeGreaterThan(20)
      expect(towardField).toBe(towardHead)
    }
    // the sleeves face away from their leg, the union's rings (planes of constant d) and a known patient's own (planes perpendicular to the leg)
    for (const fit of [undefined, { id: 'male_adult_12', scale: 1.03 }] as const) {
      const k = stageCase({ position: 'lithotomy', fit })
      for (const part of [PART.sleeveL, PART.sleeveR]) {
        const R = sleeveRings(k, part)!
        let checked = 0
        for (const f of faces(k, part)) {
          // a ring's face: its normal is across the leg; the caps face along it (never along +-x or +-h more than along d)
          const nearest = (() => {
            let best = 0
            let bd = Infinity
            for (let i = 0; i < R.n; i++) {
              const dd = Math.hypot(f.c[0] - R.centre[i * 3], f.c[1] - R.centre[i * 3 + 1], f.c[2] - R.centre[i * 3 + 2])
              if (dd < bd) {
                bd = dd
                best = i
              }
            }
            return best
          })()
          const cx = R.centre[nearest * 3]
          const ch = R.centre[nearest * 3 + 1]
          const cd = R.centre[nearest * 3 + 2]
          const ax = f.c[0] - cx
          const ah = f.c[1] - ch
          const ad = f.c[2] - cd
          const dot = f.n[0] * ax + f.n[1] * ah + f.n[2] * ad
          if (Math.abs(f.n[2]) > 0.9 && (nearest === 0 || nearest === R.n - 1)) continue
          expect(dot, `sleeve ${part} ${fit ? 'fitted' : 'union'} at d ${f.c[2].toFixed(2)}`).toBeGreaterThan(0)
          checked++
        }
        expect(checked).toBeGreaterThan(400)
      }
    }
  })
})

describe('unfolding and taking off', () => {
  const tris = (c: ReturnType<typeof stageCase>, part: number): number => (c.mem.parts[part * 2 + 1] - c.mem.parts[part * 2]) / 3

  it('the sheet grows from the neck toward the feet; the screen rises first; in lithotomy the sleeves come after the sheet and the curtain last; everything is there at 1', () => {
    for (const position of POSITIONS) {
      let last = 0
      for (const drape of [0.1, 0.2, 0.35, 0.5, 0.7, 0.9, 1]) {
        const c = stageCase({ position, drape })
        const n = tris(c, PART.sheet)
        expect(n, `${position} ${drape}`).toBeGreaterThanOrEqual(last)
        last = n
      }
      expect(tris(stageCase({ position, drape: 0.01 }), PART.sheet)).toBe(0)
      expect(tris(stageCase({ position, drape: 0.3 }), PART.screen), `${position}: the screen is up early`).toBeGreaterThan(0)
      expect(tris(stageCase({ position, drape: 1 }), PART.screen)).toBeGreaterThan(tris(stageCase({ position, drape: 0.3 }), PART.screen) - 1)
    }
    expect(tris(stageCase({ position: 'supine', drape: 1 }), PART.sleeveL)).toBe(0)
    expect(tris(stageCase({ position: 'supine', drape: 1 }), PART.perineum)).toBe(0)
    expect(tris(stageCase({ position: 'lithotomy', drape: 0.25 }), PART.sleeveL)).toBe(0)
    expect(tris(stageCase({ position: 'lithotomy', drape: 0.5 }), PART.sleeveL)).toBeGreaterThan(0)
    expect(tris(stageCase({ position: 'lithotomy', drape: 0.5 }), PART.perineum)).toBe(0)
    expect(tris(stageCase({ position: 'lithotomy', drape: 1 }), PART.perineum)).toBeGreaterThan(50)
    expect(tris(stageCase({ position: 'lithotomy', drape: 1 }), PART.sleeveL)).toBeGreaterThan(tris(stageCase({ position: 'lithotomy', drape: 0.5 }), PART.sleeveL))
  })

  it('taking them off is the same sequence backwards: the build at a drape does not depend on the way it was reached', () => {
    const up = stageCase({ position: 'lithotomy', drape: 0.6 })
    const down = stageCase({ position: 'lithotomy', drape: 1 })
    down.patient.drape = 0.6
    down.input.dt = 1
    stepStage(down.mem, down.input)
    expect(down.mem.mesh.ni).toBe(up.mem.mesh.ni)
    expect(down.mem.mesh.nv).toBe(up.mem.mesh.nv)
    for (let i = 0; i < up.mem.mesh.nv * 3; i++) expect(down.mem.mesh.pos[i]).toBe(up.mem.mesh.pos[i])
  })

  it('the wake-up (lithotomy back to supine while draped) takes the leg parts off at once and keeps the abdominal sheet until the drapes are gone', () => {
    const c = stageCase({ position: 'lithotomy', drape: 1, marks: 'closed' })
    expect(tris(c, PART.sleeveL)).toBeGreaterThan(0)
    c.patient.position = 'supine'
    c.patient.drape = 0.95
    c.patient.marks = 'dressed'
    c.input.dt = 1 / 60
    stepStage(c.mem, c.input)
    expect(c.mem.torsoOnly).toBe(true)
    expect(tris(c, PART.sleeveL)).toBe(0)
    expect(tris(c, PART.sleeveR)).toBe(0)
    expect(tris(c, PART.perineum)).toBe(0)
    const sheet = tris(c, PART.sheet)
    expect(sheet).toBeGreaterThan(300)
    // the abdominal sheet ends at the groin, not at the feet (the supine sheet over the legs would pop in over the legs coming down)
    const full = stageCase({ position: 'supine', drape: 1 })
    expect(sheet).toBeLessThan(tris(full, PART.sheet) * 0.7)
    // it comes off with the script's drape, then the flag is cleared
    for (let s = 0; s < 120; s++) {
      c.patient.drape = Math.max(0, 0.95 * (1 - s / 100))
      c.input.dt = 1 / 6
      stepStage(c.mem, c.input)
    }
    expect(tris(c, PART.sheet)).toBe(0)
    expect(c.mem.torsoOnly).toBe(false)
    // the dressings are on the plate, which stays
    expect(tris(c, PART.plate)).toBeGreaterThan(0)
    expect(tris(c, PART.marks)).toBe(5 * 2)
  })

  it('the legs\' swing: the geometry is built for the new position at once and carried back by the stirrups\' follower, so the body and the stage slide together', () => {
    const c = stageCase({ position: 'supine', drape: 0, marks: 'none' })
    expect(c.mem.slide).toBeCloseTo(0, 12)
    c.patient.position = 'lithotomy'
    c.input.dt = 1 / 60
    stepStage(c.mem, c.input)
    // the pelvis is not yet 0.3 m down the table: the mesh is carried back by nearly all of it
    expect(c.mem.slide).toBeLessThan(-0.28)
    expect(c.mem.matrix[14]).toBeCloseTo(c.mem.m[14] + c.mem.m[10] * c.mem.slide, 9)
    let prev = c.mem.slide
    for (let i = 0; i < 300; i++) {
      c.input.dt = 1 / 60
      stepStage(c.mem, c.input)
      expect(c.mem.slide, 'never overshoots, only comes forward').toBeGreaterThanOrEqual(prev - 1e-12)
      expect(c.mem.slide).toBeLessThanOrEqual(1e-9)
      prev = c.mem.slide
    }
    expect(Math.abs(c.mem.slide)).toBeLessThan(0.005)
    // a warm start places the legs where the pose says, with no swing
    const warm = stageCase({ position: 'lithotomy' })
    expect(warm.mem.slide).toBeCloseTo(0, 12)
  })
})

describe('rebuild and repaint rates', () => {
  it('while drape eases over a 16 s step the geometry is rebuilt at most about 8 times a second; the tint repaints without rebuilding; a tilt rebuilds nothing', () => {
    const c = stageCase({ position: 'lithotomy', prep: 1, drape: 0, marks: 'marked' })
    const b0 = c.mem.builds
    // the script's prepAndDrape: prep and drape both 0 -> 1 over 16 s, at 60 frames a second
    const steps = 16 * 60
    c.patient.prep = 0
    c.input.dt = 1 / 60
    stepStage(c.mem, c.input)
    const b1 = c.mem.builds
    for (let i = 1; i <= steps; i++) {
      const k = i / steps
      c.patient.prep = k
      c.patient.drape = k
      c.input.dt = 1 / 60
      stepStage(c.mem, c.input)
    }
    const builds = c.mem.builds - b1
    expect(builds, 'rebuilds over the step').toBeLessThanOrEqual(Math.ceil(16 / MIN_REBUILD) + 4)
    expect(builds, 'it does follow the easing').toBeGreaterThan(8)
    expect(c.mem.repaints, 'repaints over the step').toBeLessThanOrEqual(Math.ceil(16 / MIN_REPAINT) + 2)
    expect(c.mem.repaints).toBeGreaterThan(10)
    expect(b1).toBeGreaterThanOrEqual(b0)
    // a pure tilt: more than a second of tipping rebuilds nothing, and the matrix is the table's
    const before = c.mem.builds
    const p = newTablePose()
    const M = new Float64Array(16)
    for (let i = 0; i < 120; i++) {
      c.patient.headTiltDeg = -25 * (i / 119)
      c.patient.rollDeg = 12 * (i / 119)
      c.input.dt = 1 / 60
      stepStage(c.mem, c.input)
      setTablePose(p, c.patient.headTiltDeg, c.patient.rollDeg)
      tableMatrixInto(p, M)
      for (let k = 0; k < 16; k++) expect(c.mem.matrix[k]).toBeCloseTo(M[k], 12)
    }
    expect(c.mem.builds).toBe(before)
  })

  it('prep alone never rebuilds the geometry (the plate is built once); a mark or an arm docking rebuilds at once', () => {
    const c = stageCase({ prep: 0.02, drape: 0, marks: 'none' })
    const b = c.mem.builds
    for (let i = 1; i <= 600; i++) {
      c.patient.prep = 0.02 + 0.98 * (i / 600)
      c.input.dt = 1 / 60
      stepStage(c.mem, c.input)
    }
    expect(c.mem.builds).toBe(b)
    expect(c.mem.repaints).toBeGreaterThan(10)
    c.patient.marks = 'marked'
    c.input.dt = 1 / 60
    stepStage(c.mem, c.input)
    expect(c.mem.builds).toBe(b + 1)
    c.patient.marks = 'ports'
    stepStage(c.mem, c.input)
    expect(c.mem.builds).toBe(b + 2)
    c.input.docked = 0b0010
    stepStage(c.mem, c.input)
    expect(c.mem.builds).toBe(b + 3)
    stepStage(c.mem, c.input)
    expect(c.mem.builds, 'a quiet frame builds nothing').toBe(b + 3)
  })

  it('a paused frame (dt 0) still builds a case that has changed, and never moves a follower', () => {
    const c = stageCase({ position: 'supine', drape: 0 })
    c.patient.position = 'lithotomy'
    c.input.dt = 0
    const s0 = c.mem.st[0]
    stepStage(c.mem, c.input)
    expect(c.mem.st[0]).toBe(s0)
    expect(c.mem.bLith).toBe(true)
  })
})

describe('nothing red', () => {
  const sRGB = (r: number, g: number, b: number): [number, number, number] => {
    const hex = new Color(r, g, b).getHex()
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
  }

  it('none of the stage\'s colours, nor any blend of the skin and the antiseptic, is a blood tier of the endoscope\'s guard', () => {
    for (const [name, hex] of Object.entries(STAGE_HEX)) {
      const n = new Color(hex).getHex()
      const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      expect(isTierA(rgb[0], rgb[1], rgb[2]), `${name} ${hex} is tier A`).toBe(false)
      expect(isTierB(rgb[0], rgb[1], rgb[2]), `${name} ${hex} is tier B`).toBe(false)
      // and none is a red at all: red never the strongest channel by far
      expect(rgb[1] >= 0.55 * rgb[0] || rgb[2] >= rgb[0] * 0.9, `${name} ${hex} reads red`).toBe(true)
    }
    const A = COLOUR.antiseptic
    const S = COLOUR.skin
    for (let k = 0; k <= 1.0001; k += 0.05) {
      const [r, g, b] = sRGB(S.r + (A.r - S.r) * k, S.g + (A.g - S.g) * k, S.b + (A.b - S.b) * k)
      expect(isTierA(r, g, b) || isTierB(r, g, b), `blend ${k}`).toBe(false)
    }
  })

  it('every vertex colour of every build (prep at 0.1 .. 1, every mark, both positions) passes the same guard', () => {
    let seen = 0
    for (const position of POSITIONS) {
      for (const marks of MARKS) {
        for (const prep of [0.1, 0.5, 1]) {
          const c = stageCase({ position, marks, prep, drape: 1, docked: 0 })
          const m = c.mem.mesh
          for (let i = 0; i < m.nv; i++) {
            const [r, g, b] = sRGB(m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2])
            if (isTierA(r, g, b) || isTierB(r, g, b)) throw new Error(`${position} ${marks} prep ${prep}: vertex ${i} is ${r},${g},${b}`)
            seen++
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(40000)
  })
})

describe('the runtime', () => {
  const arms = (e: number[]) => e.map((engage, i) => arm(i, { engage }))

  it('picks the port layout of each procedure: oblique for the gallbladder, transverse for the pelvic cases', () => {
    expect(layoutOf('or-cholecystectomy')).toBe('oblique')
    expect(layoutOf('or-hysterectomy')).toBe('transverse')
    expect(layoutOf('or-prostatectomy')).toBe('transverse')
    expect(layoutOf(null)).toBe('oblique')
  })

  it('shows the mesh only while it has something, draws exactly what was built, uploads only on change and carries the table\'s matrix', () => {
    const rt = createStageRuntime()
    const c = stageCase({ position: 'supine', prep: 0, drape: 0 })
    const patient = c.patient
    stepStageRuntime(rt, 'or-cholecystectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.mesh.visible).toBe(false)
    expect(rt.geometry.drawRange.count).toBe(0)
    const up0 = rt.uploads
    stepStageRuntime(rt, 'or-cholecystectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.uploads, 'an empty quiet frame uploads nothing').toBe(up0)
    patient.prep = 1
    patient.drape = 1
    patient.marks = 'ports'
    patient.headTiltDeg = 15
    patient.rollDeg = 12
    stepStageRuntime(rt, 'or-cholecystectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.mesh.visible).toBe(true)
    expect(rt.geometry.drawRange.count).toBe(rt.mem.mesh.ni)
    expect(rt.geometry.drawRange.count).toBeGreaterThan(5000)
    expect(rt.uploads).toBe(up0 + 1)
    const p = newTablePose()
    setTablePose(p, 15, 12)
    const M = new Float64Array(16)
    tableMatrixInto(p, M)
    for (let k = 0; k < 16; k++) expect(rt.mesh.matrix.elements[k]).toBeCloseTo(M[k], 12)
    // a quiet frame uploads nothing
    stepStageRuntime(rt, 'or-cholecystectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.uploads).toBe(up0 + 1)
    // a docked arm drops its stub: one rebuild, one upload
    const tris = rt.mem.mesh.ni
    stepStageRuntime(rt, 'or-cholecystectomy', patient, arms([1, 0, 0, 0]), 1 / 60)
    expect(rt.mem.bDocked).toBe(1)
    expect(rt.mem.mesh.ni).toBe(tris - 36 * 3)
    expect(rt.uploads).toBe(up0 + 2)
    // an arm only part way onto its port keeps the stub
    stepStageRuntime(rt, 'or-cholecystectomy', patient, arms([DOCKED_AT, 0, 0, 0]), 1 / 60)
    expect(rt.mem.bDocked).toBe(0)
    // the ports follow the case: the pelvic layout, in lithotomy, puts the marks on its transverse line
    patient.position = 'lithotomy'
    patient.headTiltDeg = -25
    stepStageRuntime(rt, 'or-hysterectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.layout).toBe('transverse')
    expect(Math.abs(rt.sites[0] + PELVIS_ON_TABLE.lithotomy - 0.17)).toBeLessThan(1e-6)
    // between cases the room's view is empty again: nothing is shown
    const empty = stageCase({ prep: 0, drape: 0 }).patient
    for (let i = 0; i < 20; i++) stepStageRuntime(rt, null, empty, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.mesh.visible).toBe(false)
    expect(rt.geometry.drawRange.count).toBe(0)
  })

  it('the memory reports its parts for the next reader: new memories start empty', () => {
    const mem = newStageMemory()
    expect(mem.mesh.ni).toBe(0)
    expect(mem.parts.length).toBe(PART.count * 2)
    expect(SHEET_B0).toBeLessThan(WINDOW.d0)
    expect(PLATE_LIFT).toBeLessThan(0.014)
  })
})

describe('a known patient: the drapes hug the body', () => {
  afterEach(() => {
    setActiveCrowd(null)
    selectFit(-1, 1)
  })

  const arms = (e: number[]) => e.map((engage, i) => arm(i, { engage }))
  /** A stand-in crowd: two people on the books, the second the one on the table (its entity carries the room's patient view). */
  function crowdOf(patient: ReturnType<typeof stageCase>['patient'], id: string, scale: number): PersonSlot {
    const slot = { entity: { patientPose: patient }, avatar: 1, look: { scale } } as unknown as PersonSlot
    const other = { entity: { patientPose: null }, avatar: 0, look: { scale: 1 } } as unknown as PersonSlot
    setActiveCrowd({ people: new Map([['a', other], ['p', slot]]), avatars: [{ id: 'medical_female_03' }, { id }] } as unknown as CrowdModel)
    return slot
  }

  /** The vertical extent (m) of a sleeve's mesh across the knee (d within 1.5 cm of 0.7). */
  function kneeHeight(c: ReturnType<typeof stageCase>): number {
    const t = partTriangles(c.mem, [PART.sleeveL])
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < t.length; i += 3) {
      if (Math.abs(t[i + 2] - 0.7) > 0.015) continue
      lo = Math.min(lo, t[i + 1])
      hi = Math.max(hi, t[i + 1])
    }
    return hi - lo
  }

  it('the fit tables are for the four bodies of the gown wardrobe, at three sizes', async () => {
    const { GOWN } = await import('@/scene/actors/crowd/avatars')
    expect([...FIT_IDS].sort()).toEqual([...GOWN.female, ...GOWN.male].sort())
    for (const id of FIT_IDS) expect(fitIndexOf(id), id).toBeGreaterThanOrEqual(0)
    expect(fitIndexOf('medical_male_05')).toBe(-1)
    expect(fitIndexOf('nobody')).toBe(-1)
  })

  it('the runtime finds the patient in the crowd\'s registry by their patient view, and hands the stage their body and size; a garment body, a gone patient or no crowd falls back to the union', () => {
    const rt = createStageRuntime()
    const c = stageCase({ position: 'lithotomy', prep: 1, drape: 1, marks: 'none' })
    const patient = c.patient
    // no crowd at all
    stepStageRuntime(rt, 'or-hysterectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.input.fitAvatar).toBe(-1)
    expect(rt.mem.bFit).toBe(-1)
    const union = kneeHeight({ ...c, mem: rt.mem })
    // the patient is in the crowd
    const slot = crowdOf(patient, 'male_adult_12', 1.03)
    rt.sinceLook = LOOK_EVERY
    stepStageRuntime(rt, 'or-hysterectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.slot).toBe(slot)
    expect(rt.input.fitAvatar).toBe(fitIndexOf('male_adult_12'))
    expect(rt.input.fitScale).toBe(1.03)
    expect(rt.mem.bFit).toBe(fitIndexOf('male_adult_12') * 1000 + Math.round(1.03 * 200))
    // the sleeves hug: much less than the union's across the knee
    expect(kneeHeight({ ...c, mem: rt.mem })).toBeLessThan(union * 0.8)
    // a quiet frame looks nowhere and rebuilds nothing
    const builds = rt.mem.builds
    stepStageRuntime(rt, 'or-hysterectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.mem.builds).toBe(builds)
    // a body with no fit (a garment avatar): the union
    crowdOf(patient, 'medical_male_05', 1)
    rt.slot = null
    rt.sinceLook = LOOK_EVERY
    stepStageRuntime(rt, 'or-hysterectomy', patient, arms([0, 0, 0, 0]), 1 / 60)
    expect(rt.input.fitAvatar).toBe(-1)
    expect(rt.mem.bFit).toBe(-1)
    // the patient is back in the crowd: found at the next look (not before its time), and their fit again
    const back = crowdOf(patient, 'male_adult_12', 1)
    rt.sinceLook = 0
    ;(rt.slot as unknown as { entity: unknown }).entity = null
    stepStageRuntime(rt, 'or-hysterectomy', patient, arms([0, 0, 0, 0]), LOOK_EVERY / 4)
    expect(rt.input.fitAvatar, 'it does not look again before its time').toBe(-1)
    stepStageRuntime(rt, 'or-hysterectomy', patient, arms([0, 0, 0, 0]), LOOK_EVERY)
    expect(rt.slot).toBe(back)
    expect(rt.input.fitAvatar).toBe(fitIndexOf('male_adult_12'))
  })

  it('the plate follows the patient\'s own skin: a centimetre or so over it, and lower than the union\'s over the thinnest body (the dome, d -0.1 across the middle)', () => {
    selectFit(-1, 1)
    const over = plateH(false, -0.1, 0)
    for (const id of FIT_IDS) {
      for (const scale of [0.94, 1, 1.06]) {
        selectFit(fitIndexOf(id), scale)
        const own = plateH(false, -0.1, 0)
        expect(own, `${id} ${scale}`).toBeLessThanOrEqual(over + 1e-9)
        expect(own, `${id} ${scale}`).toBeGreaterThan(0.18)
      }
    }
    // the thinnest of the four (female_adult_17) is much lower than the union
    selectFit(fitIndexOf('female_adult_17'), 1)
    expect(over - plateH(false, -0.1, 0)).toBeGreaterThan(0.05)
    // between two sizes the plate is never under either of them (it leans to the higher) and equals the table at a size that was measured
    selectFit(fitIndexOf('male_adult_13'), 1)
    const at1 = plateH(false, -0.1, 0.1)
    selectFit(fitIndexOf('male_adult_13'), 1.06)
    const at106 = plateH(false, -0.1, 0.1)
    selectFit(fitIndexOf('male_adult_13'), 1.03)
    const mid = plateH(false, -0.1, 0.1)
    expect(mid).toBeGreaterThanOrEqual((at1 + at106) / 2 - 1e-9)
    expect(mid).toBeLessThanOrEqual(Math.max(at1, at106) + 1e-9)
    // sizes outside the measured ones take the nearest
    selectFit(fitIndexOf('male_adult_13'), 1.3)
    expect(plateH(false, -0.1, 0.1)).toBeCloseTo(at106, 9)
  })

  it('the fitted sleeves enclose the boot of the stirrup with room to spare, for each body at each size', () => {
    for (const id of FIT_IDS) {
      for (const scale of [0.94, 1, 1.06]) {
        const c = stageCase({ position: 'lithotomy', fit: { id, scale } })
        for (const part of [PART.sleeveL, PART.sleeveR]) {
          let tightest = Infinity
          for (const [d, x, h] of bootPoints(0.02)) {
            const by = insideSleeve(c, part, d, part === PART.sleeveL ? x : -x, h, true)
            // (the boot's far corners lie past the last ring's plane, inside the closed end: the closed end is part of the sleeve)
            tightest = Math.min(tightest, by ?? -1)
          }
          expect(tightest, `${id} ${scale} ${part}`).toBeGreaterThan(0.01)
        }
      }
    }
  })
})
