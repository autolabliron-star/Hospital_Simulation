// The L1 rule: the building's sun shadow is baked once at mount and never rendered again, because the sun's direction never changes
// (only its colour and intensity do, through the daylight driver). These tests read the source to keep that true.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

const rel = (p: string): string => relative(process.cwd(), p)

/** Index just past the `)` that closes the `(` at `open`. */
function closeParen(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return i + 1
  }
  return src.length
}

/** [start, end) of every call of `name(` in `src`. */
function calls(src: string, name: string): [number, number][] {
  const out: [number, number][] = []
  const re = new RegExp(`\\b${name}\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out.push([m.index, closeParen(src, src.indexOf('(', m.index))])
  return out
}

function occurrences(src: string, re: RegExp): number[] {
  const out: number[] = []
  const g = new RegExp(re.source, 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(src))) out.push(m.index)
  return out
}

describe('the baked shadow map', () => {
  const files = sources(SRC)

  it('is asked to re-render (shadowMap.needsUpdate) only inside the mount effect of Lighting.tsx', () => {
    const found: string[] = []
    for (const f of files) if (/shadowMap\.needsUpdate/.test(readFileSync(f, 'utf8'))) found.push(rel(f))
    expect(found).toEqual(['src/scene/Lighting.tsx'])

    const src = readFileSync(join(SRC, 'scene/Lighting.tsx'), 'utf8')
    const uses = occurrences(src, /shadowMap\.needsUpdate/)
    expect(uses.length).toBeGreaterThan(0)
    // the effect that switches autoUpdate off is the mount effect: every re-render request lives in it
    const effect = calls(src, 'useEffect').find(([a, b]) => src.slice(a, b).includes('shadowMap.autoUpdate = false'))
    expect(effect, 'the mount effect that sets shadowMap.autoUpdate = false').toBeDefined()
    for (const at of uses) expect(at > effect![0] && at < effect![1], `shadowMap.needsUpdate at offset ${at} is outside the mount effect`).toBe(true)
    // and it is never turned back on: the map renders only on request, never every frame
    expect(src).not.toMatch(/shadowMap\.autoUpdate\s*=\s*true/)
  })

  it('invalidateShadows() is only called from effects (build time), never from a frame callback, timer or event', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length)).replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length))
      const uses = occurrences(src, /\binvalidateShadows\(\)/).filter((at) => !/export function\s+$/.test(src.slice(Math.max(0, at - 20), at)))
      if (uses.length === 0) continue
      const effects = [...calls(src, 'useEffect'), ...calls(src, 'useLayoutEffect')]
      const frames = [...calls(src, 'useFrame'), ...calls(src, 'setInterval'), ...calls(src, 'requestAnimationFrame'), ...calls(src, 'addEventListener')]
      for (const at of uses) {
        expect(effects.some(([a, b]) => at > a && at < b), `${rel(f)}: invalidateShadows() outside an effect`).toBe(true)
        expect(frames.some(([a, b]) => at > a && at < b), `${rel(f)}: invalidateShadows() inside a frame callback or timer`).toBe(false)
      }
    }
  })

  it('the daylight driver never touches the shadow, the sun position or target, adds a light, or asks a material to recompile', () => {
    const offenders: string[] = []
    const forbidden: [RegExp, string][] = [
      [/\bneedsUpdate\b/, 'needsUpdate'],
      [/\binvalidateShadows\b/, 'invalidateShadows'],
      [/\.shadow\b/, '.shadow'],
      [/\.castShadow\b/, 'castShadow'],
      [/\.position\b/, '.position'],
      [/\b(?:sun|hemi|light)\??\.target\b/, 'the sun target'],
      [/\.defines\b/, 'defines'],
      [/\bnew\s+(Directional|Point|Spot|Hemisphere|Ambient|RectArea)Light\b/, 'a new light'],
      [/<(directional|point|spot|ambient|hemisphere|rectArea)Light\b/, 'a light element'],
    ]
    for (const f of files.filter((p) => rel(p).startsWith('src/scene/daylight/'))) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const [re, what] of forbidden) if (re.test(src)) offenders.push(`${rel(f)}: ${what}`)
    }
    expect(offenders).toEqual([])
  })

  it('the L1 ward layers never ask a material to recompile or touch the lights', () => {
    const offenders: string[] = []
    for (const f of files.filter((p) => rel(p).startsWith('src/scene/meals/'))) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      if (/\b(?:material|mat|\w+Mat|\w+Material)\.needsUpdate\b/.test(src)) offenders.push(`${rel(f)}: material.needsUpdate`)
      if (/\.defines\b/.test(src)) offenders.push(`${rel(f)}: defines`)
      if (/shadowMap|invalidateShadows|lightRig/.test(src)) offenders.push(`${rel(f)}: shadow or light rig`)
    }
    expect(offenders).toEqual([])
  })

  it('only the daylight driver writes the lights, and only the mount-time JSX positions the sun', () => {
    const users = files.filter((f) => /\blightRig\b/.test(readFileSync(f, 'utf8'))).map(rel).sort()
    expect(users).toEqual(['src/scene/Lighting.tsx', 'src/scene/daylight/index.tsx'])
    const lighting = readFileSync(join(SRC, 'scene/Lighting.tsx'), 'utf8')
    // the sun's position is a JSX prop on the one directionalLight, set once; nothing assigns it afterwards
    expect(lighting).not.toMatch(/sun\.position|\.position\.(set|copy)\(/)
    expect(occurrences(lighting, /<directionalLight\b/)).toHaveLength(1)
  })
})
