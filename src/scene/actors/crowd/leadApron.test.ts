/**
 * R5 wave 3 (agent J): the lead apron of the CT suite's staff who stay in the room during a scan (`ATTIRE.lead`, attire.ts, shaders.ts). The procedural body takes the apron's navy in
 * its top and front palette slots (writeAttire); a realistic avatar's SHADER paints the navy over the FRONT of its torso (the apron wraps the front and a little of the sides), the
 * scrubs keeping their colour behind and in the sleeves; the patient's gown wins over it on both; no new draw call and no new shader program (the avatars' one program, only
 * the attire bits and one more varying read in it).
 */
import { DataTexture, FloatType, RGBAFormat, ShaderChunk, Texture, type WebGLProgramParametersWithUniforms } from 'three'
import { describe, expect, it } from 'vitest'
import { ATTIRE } from '@/sim/types'
import { FIXED_COLORS, FX, MAX_PEOPLE, ROW_FLOATS, SLOT, TEX } from './constants'
import { loadBody, readIndex } from './avatars.testkit'
import { GOWN_COLOR, LEAD_COLOR, writeAttire } from './attire'
import { lookFor } from './outfit'
import { P } from './constants'
import { APRON_SLEEVE_FADE, AVATAR_PROGRAM_KEY, SLEEVE_PARTS, createAvatarMaterials } from './shaders'

const tex = new DataTexture(new Float32Array(TEX.width * MAX_PEOPLE * 4), TEX.width, MAX_PEOPLE, RGBAFormat, FloatType)
const INDEX = readIndex()
const std = { v: ShaderChunk.meshphysical_vert, f: ShaderChunk.meshphysical_frag }

function patched(m: { onBeforeCompile: (s: never, r: never) => void }): WebGLProgramParametersWithUniforms {
  const shader = { uniforms: {}, vertexShader: std.v, fragmentShader: std.f } as unknown as WebGLProgramParametersWithUniforms
  m.onBeforeCompile(shader as never, undefined as never)
  return shader
}

const linear = (hex: string): number[] => {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return [f(((n >> 16) & 255) / 255), f(((n >> 8) & 255) / 255), f((n & 255) / 255)]
}

describe('the lead apron on a realistic avatar', () => {
  const all = INDEX.avatars.map((a) => createAvatarMaterials(tex, new Texture(), a))

  it('the avatars\' one program reads the apron bit (8, with the gown bit clear) and how far a vertex faces the front, and paints the navy over the front of the top garment', () => {
    const s = patched(all[0][0] as never)
    const v = s.vertexShader
    const f = s.fragmentShader
    // z of the attire varying: lead set and gown clear (the gown wins, as in attire.ts); the front: the bind pose faces +Z
    expect(v).toContain('flat varying vec3 vCrowdAttire;')
    expect(v).toContain('((cAttire & 10) == 8) ? 1.0 : 0.0')
    expect(v).toContain('vCrowdApron = smoothstep(-0.3, 0.3, normal.z);')
    expect(f).toContain('flat varying vec3 vCrowdAttire;')
    expect(f).toContain('varying float vCrowdApron;')
    // the apron branch: after the garment tint (inside the non-hair branch), before the gloves, over the top garment's mask and the front
    const gown = f.indexOf('if (vCrowdAttire.y > 0.5) {')
    const apron = f.indexOf('if (vCrowdAttire.z > 0.5) {')
    const gloves = f.indexOf('if (vCrowdAttire.x > 0.5) {')
    expect(gown).toBeGreaterThan(f.indexOf('if (cMask < 0.5) discard;'))
    expect(apron).toBeGreaterThan(gown)
    expect(gloves).toBeGreaterThan(apron)
    expect(f).toContain('cTopMask * vCrowdApron')
    // the colour baked in is the apron's navy (linear)
    const navy = linear(FIXED_COLORS[FX.lead])
    const m = /if \(vCrowdAttire\.z > 0\.5\) \{[\s\S]*?vec3\(([\d.eE+-]+), ([\d.eE+-]+), ([\d.eE+-]+)\) \* cFoldL/.exec(f)
    expect(m).not.toBeNull()
    for (let i = 0; i < 3; i++) expect(parseFloat(m![i + 1]), `channel ${i}`).toBeCloseTo(navy[i], 4)
    // navy: dark and blue-ish, not red
    expect(navy[2]).toBeGreaterThan(navy[0])
  })

  it('no new shader program, no new material, no new draw: every avatar and LOD keeps the one program key (v3), and nothing here builds a mesh', () => {
    const keys = new Set<string>()
    for (const mats of all) for (const m of mats) keys.add(m.customProgramCacheKey())
    expect([...keys]).toEqual([AVATAR_PROGRAM_KEY])
    // the same text for everyone
    const a = patched(all[0][0] as never)
    for (const mats of all) {
      for (const m of mats) {
        const s = patched(m as never)
        expect(s.vertexShader).toBe(a.vertexShader)
        expect(s.fragmentShader).toBe(a.fragmentShader)
      }
    }
  })
})

/** GLSL's smoothstep, as the shader evaluates the apron's weight. */
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

describe('the lead apron is the torso\'s: the scrub sleeves keep their colour (P13)', () => {
  it('the fragment shader fades the apron out with the sleeve weight (the skin weights of the arm parts), by the numbers the test below uses', () => {
    const f = patched(createAvatarMaterials(tex, new Texture(), INDEX.avatars[0])[0] as never).fragmentShader
    const [a, b] = APRON_SLEEVE_FADE
    expect(f).toContain(`cTopMask * vCrowdApron * (1.0 - smoothstep(${a}, ${b}, vCrowdSleeve))`)
    // and the sleeve weight is the arms' (the same parts the gown's sleeves cover)
    expect(SLEEVE_PARTS).toEqual([P.armL, P.foreL, P.armR, P.foreR])
  })

  it('on every avatar\'s own vertices: the apron weight is 0 on the sleeves (their skin weights are the arm parts\') and full over the front of the chest; the front-facing sleeve vertices the old weight (front only) painted are many (a control)', async () => {
    const bad: string[] = []
    let chestFront = 0
    let sleeveFront = 0
    for (const entry of INDEX.avatars) {
      const g = await loadBody(entry, 0)
      const nrm = g.getAttribute('normal')
      const joints = g.getAttribute('aJoints')
      const weights = g.getAttribute('aWeights')
      for (let v = 0; v < nrm.count; v++) {
        let sleeve = 0
        let chest = 0
        for (let k = 0; k < 4; k++) {
          const j = Math.round(joints.getComponent(v, k))
          const w = weights.getComponent(v, k)
          if (SLEEVE_PARTS.includes(j)) sleeve += w
          if (j === P.chest || j === P.pelvis) chest += w
        }
        const front = smooth(-0.3, 0.3, nrm.getComponent(v, 2))
        const weight = front * (1 - smooth(APRON_SLEEVE_FADE[0], APRON_SLEEVE_FADE[1], sleeve))
        if (sleeve >= 0.6) {
          sleeveFront += front > 0.5 ? 1 : 0
          if (weight > 0.02) bad.push(`${entry.id} vertex ${v}: a sleeve vertex (arm weight ${sleeve.toFixed(2)}) has apron weight ${weight.toFixed(2)}`)
        }
        if (chest >= 0.95 && front > 0.99) {
          chestFront++
          if (weight < 0.99) bad.push(`${entry.id} vertex ${v}: the chest's front has apron weight ${weight.toFixed(2)}`)
        }
      }
    }
    expect(bad.slice(0, 8)).toEqual([])
    // the controls: there are many front-facing sleeve vertices (the old weight, the front only, painted every one of them), and many front chest vertices the apron still covers
    expect(sleeveFront).toBeGreaterThan(500)
    expect(chestFront).toBeGreaterThan(1000)
  }, 120000)
})

describe('writeAttire: the palette of a lead apron', () => {
  const look = lookFor({ id: 'staff', role: 'doctor', outfit: 'theatre', variant: 2 })
  const slot = (data: Float32Array, row: number, s: number): number[] => {
    const b = row * ROW_FLOATS + (TEX.palette + s) * 4
    return [data[b], data[b + 1], data[b + 2]]
  }
  const close = (a: number[], b: number[]): void => {
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 5)
  }

  it('the procedural body takes the navy in its top and front slots; an avatar keeps the look\'s colours (its shader paints the apron); the gown wins over the apron for both; the gear bits carry the attire', () => {
    const navy = linear(LEAD_COLOR)
    const gown = linear(GOWN_COLOR)
    const own = (h: string): number[] => linear(h)
    // a procedural person in a lead apron
    const d = new Float32Array(ROW_FLOATS * 4)
    writeAttire(d, 1, look, ATTIRE.lead)
    close(slot(d, 1, SLOT.top), navy)
    close(slot(d, 1, SLOT.front), navy)
    expect(d[1 * ROW_FLOATS + TEX.gear * 4 + 2]).toBe(ATTIRE.lead)
    // the same person as an avatar: their own colours, the bit still there for the shader
    writeAttire(d, 2, look, ATTIRE.lead, true)
    close(slot(d, 2, SLOT.top), own(look.top))
    close(slot(d, 2, SLOT.front), own(look.front))
    expect(d[2 * ROW_FLOATS + TEX.gear * 4 + 2]).toBe(ATTIRE.lead)
    // the gown wins over the lead apron: the gown's colour, whichever body
    for (const avatar of [false, true]) {
      writeAttire(d, 3, look, ATTIRE.lead | ATTIRE.gown, avatar)
      close(slot(d, 3, SLOT.top), gown)
      close(slot(d, 3, SLOT.front), gown)
      expect(d[3 * ROW_FLOATS + TEX.gear * 4 + 2]).toBe(ATTIRE.lead | ATTIRE.gown)
    }
    // the apron comes off: the look's own again
    writeAttire(d, 1, look, 0)
    close(slot(d, 1, SLOT.top), own(look.top))
  })
})
